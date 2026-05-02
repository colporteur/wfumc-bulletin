import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill in the values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // We don't use OAuth redirect flows.
    storageKey: 'wfumc-bulletin-auth',
    // Override the default navigator.locks-based mutex with a no-op.
    // The default can deadlock — once stuck, every Supabase call hangs forever
    // until the user manually clears localStorage. Since this app is used by
    // one or two staff at a time (typically in a single tab), we don't need
    // cross-tab token-refresh coordination.
    lock: (_name, _acquireTimeout, fn) => fn(),
  },
});

/**
 * Wraps a Supabase query builder (or any promise) with a hard timeout so the
 * UI never hangs indefinitely. If the promise doesn't settle within `ms`
 * milliseconds, this rejects with a TimeoutError — callers see a normal error
 * they can show to the user instead of a spinner that never stops.
 *
 * Usage:
 *   const { data, error } = await withTimeout(
 *     supabase.from('church_settings').update(draft).eq('id', 1).select().single()
 *   );
 */
export function withTimeout(promise, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Request timed out after ${Math.round(ms / 1000)}s. ` +
            `Check your connection and try again. If this keeps happening, ` +
            `clear localStorage (DevTools → Application → Local Storage) and sign in again.`
        )
      );
    }, ms);
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

/**
 * Calls the claude-proxy Edge Function. Requires an authenticated staff session.
 *
 * @param {Object} body - { messages: [...], system?, max_tokens?, model? }
 * @returns {Promise<Object>} the Anthropic response JSON
 */
export async function callClaude(body, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not signed in');
  }
  // Wrap fetch in a manual timeout — long Claude jobs (vision, big
  // imports) can take 60-120s, longer than typical default timeouts.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(
        `Claude took longer than ${Math.round(timeoutMs / 1000)}s to respond. ` +
          `For long inputs this can happen — try again, or split into smaller pieces.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude proxy error ${res.status}: ${errBody}`);
  }
  return res.json();
}
