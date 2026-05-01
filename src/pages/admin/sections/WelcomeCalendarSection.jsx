import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../../../lib/supabase';
import LoadingSpinner from '../../../components/LoadingSpinner.jsx';

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function plusDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTime(hhmmss) {
  if (!hhmmss) return '';
  // hhmmss may be "HH:MM:SS" or "HH:MM"
  const [hh, mm] = hhmmss.split(':');
  const hour = parseInt(hh, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mm} ${ampm}`;
}

export default function WelcomeCalendarSection({ bulletin, refresh }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Welcome blurb (church-wide default + per-bulletin override)
  const [welcomeBlurb, setWelcomeBlurb] = useState('');
  const [bulletinBlurb, setBulletinBlurb] = useState(
    bulletin?.welcome_blurb ?? ''
  );
  const [savingBlurb, setSavingBlurb] = useState(false);

  useEffect(() => {
    setBulletinBlurb(bulletin?.welcome_blurb ?? '');
  }, [bulletin?.welcome_blurb]);

  const saveBulletinBlurb = async (text) => {
    if (!bulletin?.id) return;
    setSavingBlurb(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('bulletins')
          .update({ welcome_blurb: text.trim() || null })
          .eq('id', bulletin.id)
      );
      if (err) throw err;
      if (refresh) await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingBlurb(false);
    }
  };

  // Calendar events
  const [events, setEvents] = useState([]);
  const [newEvent, setNewEvent] = useState({
    event_date: '',
    event_time: '',
    title: '',
    location: '',
    notes: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);

  // Each Week schedule
  const [weekly, setWeekly] = useState([]);
  const [newWeekly, setNewWeekly] = useState({
    day_of_week: 0,
    start_time: '',
    title: '',
    location: '',
  });
  const [savingWeekly, setSavingWeekly] = useState(false);

  // Birthdays
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const [birthdays, setBirthdays] = useState([]);
  const [birthdayMonth, setBirthdayMonth] = useState(currentMonth);
  const [newBirthday, setNewBirthday] = useState({
    full_name: '',
    month: currentMonth,
    day: 1,
  });
  const [savingBirthday, setSavingBirthday] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, evts, wk, bdays] = await Promise.all([
        withTimeout(
          supabase
            .from('church_settings_public')
            .select('welcome_blurb')
            .eq('id', 1)
            .maybeSingle()
        ),
        withTimeout(
          supabase
            .from('calendar_events')
            .select('*')
            .gte('event_date', todayISO())
            .lte('event_date', plusDaysISO(14))
            .order('event_date', { ascending: true })
            .order('event_time', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('weekly_schedule_items')
            .select('*')
            .eq('is_active', true)
            .order('day_of_week', { ascending: true })
            .order('position', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('birthdays')
            .select('*')
            .eq('month', birthdayMonth)
            .order('day', { ascending: true })
        ),
      ]);
      if (settings.error) throw settings.error;
      if (evts.error) throw evts.error;
      if (wk.error) throw wk.error;
      if (bdays.error) throw bdays.error;
      setWelcomeBlurb(settings.data?.welcome_blurb ?? '');
      setEvents(evts.data ?? []);
      setWeekly(wk.data ?? []);
      setBirthdays(bdays.data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthdayMonth]);

  // ---- Calendar events ----
  const addEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title.trim() || !newEvent.event_date) {
      setError('Event title and date are required.');
      return;
    }
    setSavingEvent(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('calendar_events').insert({
          event_date: newEvent.event_date,
          event_time: newEvent.event_time || null,
          title: newEvent.title.trim(),
          location: newEvent.location.trim() || null,
          notes: newEvent.notes.trim() || null,
          source: 'manual',
          is_published: true,
        })
      );
      if (err) throw err;
      setNewEvent({
        event_date: '',
        event_time: '',
        title: '',
        location: '',
        notes: '',
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingEvent(false);
    }
  };

  const removeEvent = async (id) => {
    if (!window.confirm('Remove this event?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('calendar_events').delete().eq('id', id)
      );
      if (err) throw err;
      setEvents((es) => es.filter((e) => e.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  // ---- Weekly schedule ----
  const addWeekly = async (e) => {
    e.preventDefault();
    if (!newWeekly.title.trim()) {
      setError('Title is required.');
      return;
    }
    setSavingWeekly(true);
    setError(null);
    try {
      const samePosition = weekly.filter(
        (w) => w.day_of_week === Number(newWeekly.day_of_week)
      ).length;
      const { error: err } = await withTimeout(
        supabase.from('weekly_schedule_items').insert({
          day_of_week: Number(newWeekly.day_of_week),
          start_time: newWeekly.start_time || null,
          title: newWeekly.title.trim(),
          location: newWeekly.location.trim() || null,
          position: samePosition,
        })
      );
      if (err) throw err;
      setNewWeekly({ day_of_week: 0, start_time: '', title: '', location: '' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingWeekly(false);
    }
  };

  const removeWeekly = async (id) => {
    if (!window.confirm('Remove this weekly item?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('weekly_schedule_items').delete().eq('id', id)
      );
      if (err) throw err;
      setWeekly((ws) => ws.filter((w) => w.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  // ---- Birthdays ----
  const addBirthday = async (e) => {
    e.preventDefault();
    if (!newBirthday.full_name.trim()) {
      setError('Name is required.');
      return;
    }
    setSavingBirthday(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('birthdays').insert({
          full_name: newBirthday.full_name.trim(),
          month: Number(newBirthday.month),
          day: Number(newBirthday.day),
        })
      );
      if (err) throw err;
      setNewBirthday({
        full_name: '',
        month: birthdayMonth,
        day: 1,
      });
      // If they added one for the currently-displayed month, reload
      if (Number(newBirthday.month) === birthdayMonth) {
        await load();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingBirthday(false);
    }
  };

  const removeBirthday = async (id) => {
    if (!window.confirm('Remove this birthday?')) return;
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('birthdays').delete().eq('id', id)
      );
      if (err) throw err;
      setBirthdays((bs) => bs.filter((b) => b.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <LoadingSpinner />;

  // Group weekly items by day
  const weeklyByDay = DAYS.map((dayName, idx) => ({
    dayName,
    dayIdx: idx,
    items: weekly.filter((w) => w.day_of_week === idx),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl text-umc-900">Welcome &amp; Calendar</h2>
        <p className="text-sm text-gray-600 mt-1">
          Welcome blurb, the next two weeks of calendar events, the recurring
          weekly schedule, and birthdays for the displayed month.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* WELCOME BLURB */}
      <div className="card space-y-3">
        <h3 className="font-serif text-lg text-umc-900">Welcome blurb</h3>

        <div>
          <label className="label">This bulletin's welcome (optional)</label>
          <textarea
            className="input min-h-[120px]"
            value={bulletinBlurb}
            onChange={(e) => setBulletinBlurb(e.target.value)}
            onBlur={(e) => saveBulletinBlurb(e.target.value)}
            placeholder="Leave blank to use the church-wide default below. Override here for special Sundays (Easter, Christmas Eve, etc.)."
          />
          {savingBlurb && (
            <p className="text-xs text-gray-500 mt-1">Saving…</p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
            Church-wide default
          </p>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {welcomeBlurb || (
              <span className="italic text-gray-400">
                No church-wide welcome blurb set. Add one in{' '}
                <Link to="/admin/settings" className="text-umc-700 underline">
                  Settings
                </Link>
                .
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Worshippers see whichever you've set above, falling back to
            this default when the override is empty.{' '}
            <Link to="/admin/settings" className="text-umc-700 underline">
              Edit the default →
            </Link>
          </p>
        </div>
      </div>

      {/* CALENDAR EVENTS */}
      <div className="card">
        <h3 className="font-serif text-lg text-umc-900">Upcoming events</h3>
        <p className="text-xs text-gray-500 mt-1">
          Next 14 days. (Past events are hidden automatically.)
        </p>

        {events.length === 0 ? (
          <p className="text-sm text-gray-400 italic mt-3">
            No upcoming events in the next two weeks.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex justify-between items-start gap-3 text-sm"
              >
                <div className="flex-1">
                  <div className="text-gray-700">
                    <span className="font-medium">{fmtDate(e.event_date)}</span>
                    {e.event_time && (
                      <span className="text-gray-500 ml-2">
                        {fmtTime(e.event_time)}
                      </span>
                    )}
                  </div>
                  <div className="text-gray-800">{e.title}</div>
                  {e.location && (
                    <div className="text-xs text-gray-500">{e.location}</div>
                  )}
                  {e.notes && (
                    <div className="text-xs text-gray-500 italic mt-0.5">
                      {e.notes}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeEvent(e.id)}
                  className="text-xs text-red-600 hover:text-red-800 hover:underline whitespace-nowrap"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={addEvent}
          className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <label className="label">Title</label>
            <input
              type="text"
              className="input"
              value={newEvent.title}
              onChange={(e) =>
                setNewEvent({ ...newEvent, title: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={newEvent.event_date}
              onChange={(e) =>
                setNewEvent({ ...newEvent, event_date: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label className="label">Time (optional)</label>
            <input
              type="time"
              className="input"
              value={newEvent.event_time}
              onChange={(e) =>
                setNewEvent({ ...newEvent, event_time: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <label className="label">Location (optional)</label>
            <input
              type="text"
              className="input"
              value={newEvent.location}
              onChange={(e) =>
                setNewEvent({ ...newEvent, location: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <label className="label">Notes (optional)</label>
            <input
              type="text"
              className="input"
              value={newEvent.notes}
              onChange={(e) =>
                setNewEvent({ ...newEvent, notes: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={savingEvent}
              className="btn-secondary disabled:opacity-50"
            >
              {savingEvent ? 'Adding…' : '+ Add event'}
            </button>
          </div>
        </form>
      </div>

      {/* EACH WEEK */}
      <div className="card">
        <h3 className="font-serif text-lg text-umc-900">Each Week</h3>
        <p className="text-xs text-gray-500 mt-1">
          Recurring weekly schedule (e.g., choir practice, Bible study).
        </p>

        <div className="mt-4 space-y-4">
          {weeklyByDay.map(({ dayName, items }) => (
            <div key={dayName}>
              <div className="text-sm font-medium text-gray-700">{dayName}</div>
              {items.length === 0 ? (
                <div className="text-xs text-gray-400 italic ml-3">
                  — nothing —
                </div>
              ) : (
                <ul className="ml-3 space-y-1">
                  {items.map((w) => (
                    <li
                      key={w.id}
                      className="flex justify-between items-center text-sm"
                    >
                      <span>
                        {w.start_time && (
                          <span className="text-gray-500 mr-2">
                            {fmtTime(w.start_time)}
                          </span>
                        )}
                        <span className="text-gray-800">{w.title}</span>
                        {w.location && (
                          <span className="text-xs text-gray-500 ml-2">
                            ({w.location})
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWeekly(w.id)}
                        className="text-xs text-red-600 hover:text-red-800 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <form
          onSubmit={addWeekly}
          className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <label className="label">Title</label>
            <input
              type="text"
              className="input"
              value={newWeekly.title}
              onChange={(e) =>
                setNewWeekly({ ...newWeekly, title: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label className="label">Day</label>
            <select
              className="input"
              value={newWeekly.day_of_week}
              onChange={(e) =>
                setNewWeekly({ ...newWeekly, day_of_week: e.target.value })
              }
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Time (optional)</label>
            <input
              type="time"
              className="input"
              value={newWeekly.start_time}
              onChange={(e) =>
                setNewWeekly({ ...newWeekly, start_time: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <label className="label">Location (optional)</label>
            <input
              type="text"
              className="input"
              value={newWeekly.location}
              onChange={(e) =>
                setNewWeekly({ ...newWeekly, location: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={savingWeekly}
              className="btn-secondary disabled:opacity-50"
            >
              {savingWeekly ? 'Adding…' : '+ Add weekly item'}
            </button>
          </div>
        </form>
      </div>

      {/* BIRTHDAYS */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif text-lg text-umc-900">Birthdays</h3>
          <select
            className="text-sm border border-gray-300 rounded px-2 py-1"
            value={birthdayMonth}
            onChange={(e) => setBirthdayMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {birthdays.length === 0 ? (
          <p className="text-sm text-gray-400 italic mt-3">
            No birthdays in {MONTHS[birthdayMonth - 1]}.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {birthdays.map((b) => (
              <li
                key={b.id}
                className="flex justify-between items-center text-sm"
              >
                <span>
                  <span className="text-gray-500 mr-2">{b.day}</span>
                  <span className="text-gray-800">{b.full_name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeBirthday(b.id)}
                  className="text-xs text-red-600 hover:text-red-800 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={addBirthday}
          className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={newBirthday.full_name}
              onChange={(e) =>
                setNewBirthday({ ...newBirthday, full_name: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label className="label">Month</label>
            <select
              className="input"
              value={newBirthday.month}
              onChange={(e) =>
                setNewBirthday({ ...newBirthday, month: e.target.value })
              }
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Day</label>
            <input
              type="number"
              min="1"
              max="31"
              className="input"
              value={newBirthday.day}
              onChange={(e) =>
                setNewBirthday({ ...newBirthday, day: e.target.value })
              }
              required
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={savingBirthday}
              className="btn-secondary disabled:opacity-50"
            >
              {savingBirthday ? 'Adding…' : '+ Add birthday'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
