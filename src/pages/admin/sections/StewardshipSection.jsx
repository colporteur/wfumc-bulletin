import { useEffect, useState } from 'react';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

// Convert "" / null / undefined to null; "12.5" to 12.5 number
function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function fmtNum(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

export default function StewardshipSection({ bulletin }) {
  const bulletinId = bulletin?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Configurations (church-wide)
  const [funds, setFunds] = useState([]);
  const [attendanceCats, setAttendanceCats] = useState([]);
  const [roles, setRoles] = useState([]);

  // Per-bulletin entries (keyed by lookup so we can update individual cells)
  // stewardshipEntries: { [`${fund_id}:${period}`]: row }
  const [stewardshipEntries, setStewardshipEntries] = useState({});
  // attendanceEntries: { [category_id]: row }
  const [attendanceEntries, setAttendanceEntries] = useState({});
  // leadingAssignments: { [role_id]: row }
  const [leadingAssignments, setLeadingAssignments] = useState({});
  // greetersUshers: single row (or null)
  const [greetersUshers, setGreetersUshers] = useState(null);

  const load = async () => {
    if (!bulletinId) return;
    setLoading(true);
    setError(null);
    try {
      const [
        fundsRes,
        attCatsRes,
        rolesRes,
        stewRes,
        attEntRes,
        leadRes,
        greetRes,
      ] = await Promise.all([
        withTimeout(
          supabase
            .from('stewardship_funds')
            .select('*')
            .eq('is_active', true)
            .order('position', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('attendance_categories')
            .select('*')
            .eq('is_active', true)
            .order('position', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('leading_worship_roles')
            .select('*')
            .eq('is_active', true)
            .order('position', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('stewardship_entries')
            .select('*')
            .eq('bulletin_id', bulletinId)
        ),
        withTimeout(
          supabase
            .from('attendance_entries')
            .select('*')
            .eq('bulletin_id', bulletinId)
        ),
        withTimeout(
          supabase
            .from('leading_worship_assignments')
            .select('*')
            .eq('bulletin_id', bulletinId)
        ),
        withTimeout(
          supabase
            .from('greeters_ushers')
            .select('*')
            .eq('bulletin_id', bulletinId)
            .maybeSingle()
        ),
      ]);
      const errs = [
        fundsRes.error,
        attCatsRes.error,
        rolesRes.error,
        stewRes.error,
        attEntRes.error,
        leadRes.error,
        greetRes.error,
      ].filter(Boolean);
      if (errs.length) throw errs[0];

      setFunds(fundsRes.data ?? []);
      setAttendanceCats(attCatsRes.data ?? []);
      setRoles(rolesRes.data ?? []);

      const stewMap = {};
      for (const e of stewRes.data ?? []) {
        stewMap[`${e.fund_id}:${e.period}`] = e;
      }
      setStewardshipEntries(stewMap);

      const attMap = {};
      for (const e of attEntRes.data ?? []) {
        attMap[e.category_id] = e;
      }
      setAttendanceEntries(attMap);

      const leadMap = {};
      for (const a of leadRes.data ?? []) {
        leadMap[a.role_id] = a;
      }
      setLeadingAssignments(leadMap);

      setGreetersUshers(greetRes.data ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulletinId]);

  // ---- Save helpers ----
  const saveStewardship = async (fund_id, period, patch) => {
    setError(null);
    const key = `${fund_id}:${period}`;
    const existing = stewardshipEntries[key] ?? {};
    const merged = {
      ...existing,
      bulletin_id: bulletinId,
      fund_id,
      period,
      ...patch,
    };
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('stewardship_entries')
          .upsert(merged, { onConflict: 'bulletin_id,fund_id,period' })
          .select()
          .single()
      );
      if (err) throw err;
      setStewardshipEntries((prev) => ({ ...prev, [key]: data }));
    } catch (e) {
      setError(e.message);
    }
  };

  const saveAttendance = async (category_id, count_text) => {
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('attendance_entries')
          .upsert(
            { bulletin_id: bulletinId, category_id, count_text: count_text || null },
            { onConflict: 'bulletin_id,category_id' }
          )
          .select()
          .single()
      );
      if (err) throw err;
      setAttendanceEntries((prev) => ({ ...prev, [category_id]: data }));
    } catch (e) {
      setError(e.message);
    }
  };

  const saveLeadingAssignment = async (role_id, person_override) => {
    setError(null);
    if (!person_override || !person_override.trim()) {
      // Delete the override → fall back to default_person
      try {
        const { error: err } = await withTimeout(
          supabase
            .from('leading_worship_assignments')
            .delete()
            .eq('bulletin_id', bulletinId)
            .eq('role_id', role_id)
        );
        if (err) throw err;
        setLeadingAssignments((prev) => {
          const next = { ...prev };
          delete next[role_id];
          return next;
        });
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('leading_worship_assignments')
          .upsert(
            {
              bulletin_id: bulletinId,
              role_id,
              person_override: person_override.trim(),
            },
            { onConflict: 'bulletin_id,role_id' }
          )
          .select()
          .single()
      );
      if (err) throw err;
      setLeadingAssignments((prev) => ({ ...prev, [role_id]: data }));
    } catch (e) {
      setError(e.message);
    }
  };

  const saveGreetersUshers = async (text) => {
    setError(null);
    const trimmed = (text ?? '').trim();
    try {
      if (greetersUshers) {
        if (!trimmed) {
          // delete the row
          const { error: err } = await withTimeout(
            supabase.from('greeters_ushers').delete().eq('id', greetersUshers.id)
          );
          if (err) throw err;
          setGreetersUshers(null);
          return;
        }
        const { data, error: err } = await withTimeout(
          supabase
            .from('greeters_ushers')
            .update({ names_text: trimmed })
            .eq('id', greetersUshers.id)
            .select()
            .single()
        );
        if (err) throw err;
        setGreetersUshers(data);
      } else {
        if (!trimmed) return;
        const { data, error: err } = await withTimeout(
          supabase
            .from('greeters_ushers')
            .insert({ bulletin_id: bulletinId, names_text: trimmed })
            .select()
            .single()
        );
        if (err) throw err;
        setGreetersUshers(data);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <LoadingSpinner />;

  const generalFund = funds.find((f) => f.category === 'general');
  const otherFunds = funds.filter((f) => f.category !== 'general');

  const stewVal = (fund_id, period, field) =>
    fmtNum(stewardshipEntries[`${fund_id}:${period}`]?.[field]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Stewardship &amp; Attendance</h2>
        <p className="text-sm text-gray-600 mt-1">
          Per-bulletin financials, attendance counts, and the people leading
          this Sunday's service. Changes save when you click out of a field.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* GENERAL FUND */}
      {generalFund && (
        <div className="card overflow-x-auto">
          <h3 className="font-serif text-lg text-umc-900">
            {generalFund.name}
          </h3>
          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="text-left py-1 pr-4">&nbsp;</th>
                <th className="text-left py-1 pr-4">MTD</th>
                <th className="text-left py-1">YTD</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'received', label: 'Received' },
                { key: 'expenses', label: 'Expenses' },
                { key: 'needed_to_meet_budget', label: 'Needed to meet budget' },
                { key: 'paid', label: 'Paid' },
              ].map(({ key, label }) => (
                <tr key={key} className="border-t border-gray-100">
                  <td className="py-2 pr-4 text-gray-700">{label}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      step="0.01"
                      className="input w-32"
                      defaultValue={stewVal(generalFund.id, 'mtd', key)}
                      onBlur={(e) =>
                        saveStewardship(generalFund.id, 'mtd', {
                          [key]: parseNum(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      step="0.01"
                      className="input w-32"
                      defaultValue={stewVal(generalFund.id, 'ytd', key)}
                      onBlur={(e) =>
                        saveStewardship(generalFund.id, 'ytd', {
                          [key]: parseNum(e.target.value),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* OTHER FUNDS */}
      {otherFunds.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="font-serif text-lg text-umc-900">Other funds</h3>
          <p className="text-xs text-gray-500 mt-1">Received only.</p>
          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="text-left py-1 pr-4">Fund</th>
                <th className="text-left py-1 pr-4">MTD</th>
                <th className="text-left py-1">YTD</th>
              </tr>
            </thead>
            <tbody>
              {otherFunds.map((f) => (
                <tr key={f.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4 text-gray-700">{f.name}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      step="0.01"
                      className="input w-32"
                      defaultValue={stewVal(f.id, 'mtd', 'received')}
                      onBlur={(e) =>
                        saveStewardship(f.id, 'mtd', {
                          received: parseNum(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      step="0.01"
                      className="input w-32"
                      defaultValue={stewVal(f.id, 'ytd', 'received')}
                      onBlur={(e) =>
                        saveStewardship(f.id, 'ytd', {
                          received: parseNum(e.target.value),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ATTENDANCE */}
      <div className="card overflow-x-auto">
        <h3 className="font-serif text-lg text-umc-900">Attendance</h3>
        <p className="text-xs text-gray-500 mt-1">
          Counts can be numbers, "X" / "—" for not held, or any short text.
        </p>
        <table className="mt-3 min-w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left py-1 pr-4">Category</th>
              <th className="text-left py-1">Count</th>
            </tr>
          </thead>
          <tbody>
            {attendanceCats.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2 pr-4 text-gray-700">{c.name}</td>
                <td className="py-2">
                  <input
                    type="text"
                    className="input w-24"
                    defaultValue={attendanceEntries[c.id]?.count_text ?? ''}
                    onBlur={(e) => saveAttendance(c.id, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* LEADING WORSHIP */}
      <div className="card">
        <h3 className="font-serif text-lg text-umc-900">Leading worship</h3>
        <p className="text-xs text-gray-500 mt-1">
          Defaults shown in placeholders. Type a name to override for this
          Sunday only; leave blank to use the default.
        </p>
        <div className="mt-3 space-y-3">
          {roles.map((r) => (
            <div key={r.id} className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-36">
                {r.role_label}
              </label>
              <input
                type="text"
                className="input flex-1"
                placeholder={r.default_person ?? '—'}
                defaultValue={leadingAssignments[r.id]?.person_override ?? ''}
                onBlur={(e) => saveLeadingAssignment(r.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* GREETERS / USHERS */}
      <div className="card">
        <h3 className="font-serif text-lg text-umc-900">Greeters &amp; Ushers</h3>
        <p className="text-xs text-gray-500 mt-1">
          Freeform — comma-separated names, or however you'd like to format it.
        </p>
        <textarea
          className="input mt-3 min-h-[80px]"
          placeholder="e.g., Wayne Turner, Joe Burns"
          defaultValue={greetersUshers?.names_text ?? ''}
          onBlur={(e) => saveGreetersUshers(e.target.value)}
        />
      </div>
    </div>
  );
}
