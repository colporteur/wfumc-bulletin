import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../../lib/supabase';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { ROLE_LABELS, rolesForUserManagement } from '../../lib/permissions';

// Pastor-only page for managing staff_profiles. Pastor creates the
// underlying auth user manually in the Supabase dashboard, then comes
// here and links it to a role using the email lookup. Edit role,
// rename, or remove existing profiles inline.
//
// We don't try to create auth users from this page — that requires the
// service-role key + a dedicated edge function, which is more than
// most weeks need. The dashboard path is one click for the pastor and
// avoids credential plumbing.
export default function Users() {
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('staff_profiles')
          .select('user_id, full_name, role, created_at')
          .order('created_at', { ascending: true })
      );
      if (err) throw err;
      setProfiles(data ?? []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  if (loading) return <LoadingSpinner label="Loading users…" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">Users</h1>
          <p className="text-sm text-gray-600 mt-1">
            Staff accounts that can sign in to the church apps. Roles
            decide which sections they can edit.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-primary text-sm whitespace-nowrap"
          >
            + Add user
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <details className="card text-sm text-gray-700">
        <summary className="font-medium cursor-pointer text-umc-900">
          How adding a user works
        </summary>
        <ol className="list-decimal pl-5 mt-3 space-y-2 text-gray-600">
          <li>
            Open Supabase →{' '}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-umc-700 underline"
            >
              Authentication → Users
            </a>{' '}
            and click <strong>"Add user"</strong>. Pick "Create new user", set
            their email, and either set a temporary password or check "Auto
            Confirm User" + send them a magic link from the same screen.
          </li>
          <li>
            Tell the new user their email + temporary password (or wait for
            them to receive the magic link). They should sign in to whichever
            app they need.
          </li>
          <li>
            Come back here, click <strong>+ Add user</strong>, enter their
            email, set their full name and role, and save. They now have
            access to the parts of the apps their role allows.
          </li>
        </ol>
      </details>

      {adding && (
        <AddUserCard
          onCancel={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await reload();
          }}
        />
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2 hidden md:table-cell">
                User ID
              </th>
              <th className="text-right px-3 py-2 w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {profiles.map((p) => (
              <UserRow
                key={p.user_id}
                profile={p}
                isSelf={p.user_id === currentUser?.id}
                onChanged={reload}
                onError={setError}
              />
            ))}
            {profiles.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-sm text-gray-500"
                >
                  No staff profiles yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Need to manage the social media app's channels?{' '}
        <Link to="/admin/settings" className="underline hover:text-gray-700">
          Settings page
        </Link>
        .
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Add-user form
// ---------------------------------------------------------------------
function AddUserCard({ onCancel, onAdded }) {
  const { user: currentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('office_admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // 1. Resolve email → user_id via the RPC we already have (lives in
      //    public schema, security definer, only reads auth.users.id).
      const { data: lookedUpId, error: rpcErr } = await withTimeout(
        supabase.rpc('find_user_id_by_email', { p_email: email.trim() })
      );
      if (rpcErr) throw rpcErr;
      if (!lookedUpId) {
        throw new Error(
          `No auth user found with that email. Create the account in ` +
            `the Supabase dashboard first (Authentication → Users → Add user).`
        );
      }

      // 2. Insert into staff_profiles (role check enforces valid roles).
      const { error: insErr } = await withTimeout(
        supabase
          .from('staff_profiles')
          .insert({
            user_id: lookedUpId,
            full_name: name.trim(),
            role,
          })
      );
      if (insErr) {
        if (
          String(insErr.message || '')
            .toLowerCase()
            .includes('duplicate')
        ) {
          throw new Error(
            'That user already has a staff profile. Edit it in the table below instead.'
          );
        }
        throw insErr;
      }

      await onAdded();
    } catch (e2) {
      setError(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-serif text-lg text-umc-900">Add user</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Email of existing auth user</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="someone@example.com"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {rolesForUserManagement().map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] || r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Full name (shown in headers)</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g., Jane Smith"
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add user'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// One user row (inline edit role, rename, remove)
// ---------------------------------------------------------------------
function UserRow({ profile, isSelf, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.full_name);
  const [role, setRole] = useState(profile.role);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    onError?.(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('staff_profiles')
          .update({ full_name: name.trim(), role })
          .eq('user_id', profile.user_id)
      );
      if (err) throw err;
      setEditing(false);
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Remove "${profile.full_name}" (${profile.role})? They keep their auth ` +
          `account, but lose access to the apps.${
            isSelf ? '\n\n⚠️ This is YOUR account — you will lose admin access immediately.' : ''
          }`
      )
    ) {
      return;
    }
    setBusy(true);
    onError?.(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('staff_profiles')
          .delete()
          .eq('user_id', profile.user_id)
      );
      if (err) throw err;
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <tr className="bg-umc-50/30">
        <td className="px-3 py-2">
          <input
            type="text"
            className="input text-sm py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </td>
        <td className="px-3 py-2">
          <select
            className="input text-sm py-1"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {rolesForUserManagement().map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] || r}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 hidden md:table-cell">
          <code className="text-[10px] text-gray-500">
            {profile.user_id.slice(0, 8)}…
          </code>
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim()}
            className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 mr-2"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(profile.full_name);
              setRole(profile.role);
            }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Cancel
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-medium text-umc-900">{profile.full_name}</span>
        {isSelf && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-umc-700">
            you
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-gray-700">
        {ROLE_LABELS[profile.role] || profile.role}
      </td>
      <td className="px-3 py-2 hidden md:table-cell">
        <code className="text-[10px] text-gray-500">
          {profile.user_id.slice(0, 8)}…
        </code>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50 mr-2"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs text-red-600 hover:text-red-800 underline disabled:opacity-50"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
