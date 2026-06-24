// =====================================================================
// plaud-webhook — Supabase Edge Function
//
// Receives webhooks from Zapier when Plaud finishes processing a new
// transcription. Inserts a `daily_captures` row and fires-and-forgets
// a call to `daily-capture-extract` so Claude segmentation runs in the
// background. The webhook returns 200 within ~1 second so Zapier
// never times out, regardless of how long Claude takes to run.
//
// Auth:
//   - Request must carry header `X-Webhook-Secret: <secret>` matching
//     the function's WEBHOOK_SHARED_SECRET environment variable.
//   - The capture is inserted under DAILY_CAPTURE_OWNER_USER_ID (env)
//     — this is the pastor's auth.uid(). Single-tenant by design;
//     each pastor who wants the integration deploys their own
//     webhook URL with their own secret + user id.
//
// Request body (JSON, all fields optional except transcript):
//   {
//     "transcript":   string  REQUIRED — the full transcript text
//     "title":        string  — Plaud recording title
//     "recorded_at":  string  — ISO date or YYYY-MM-DD
//     "summary":      string  — Plaud's AI summary (stored in notes)
//     "audio_url":    string  — link back to the audio (stored in notes)
//     "plaud_id":     string  — Plaud's recording id (stored in notes)
//   }
//
// Response (JSON):
//   200  { ok: true, capture_id: "uuid" }
//   400  { error: "..." }
//   401  { error: "Invalid webhook secret" }
//   500  { error: "..." }
//
// Deploy with:
//   supabase functions deploy plaud-webhook --no-verify-jwt
//
// Required env vars (set via Supabase dashboard or `supabase secrets set`):
//   WEBHOOK_SHARED_SECRET     — random string Zapier sends in header
//   DAILY_CAPTURE_OWNER_USER_ID — pastor's auth.uid()
//   SUPABASE_URL              — auto-populated by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-populated by Supabase
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // --- auth: shared secret header ----------------------------------
  const expectedSecret = Deno.env.get('WEBHOOK_SHARED_SECRET');
  if (!expectedSecret) {
    return json(
      { error: 'Server not configured: WEBHOOK_SHARED_SECRET is unset' },
      500
    );
  }
  const presentedSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('X-Webhook-Secret') ||
    '';
  if (presentedSecret !== expectedSecret) {
    return json({ error: 'Invalid webhook secret' }, 401);
  }

  // --- owner: pastor's user id from env ----------------------------
  const ownerUserId = Deno.env.get('DAILY_CAPTURE_OWNER_USER_ID');
  if (!ownerUserId) {
    return json(
      { error: 'Server not configured: DAILY_CAPTURE_OWNER_USER_ID is unset' },
      500
    );
  }

  // --- parse body ---------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON' }, 400);
  }
  const transcript = String(body.transcript ?? '').trim();
  if (!transcript) {
    return json(
      { error: 'Missing required "transcript" field (or empty)' },
      400
    );
  }
  const title = stringOrNull(body.title);
  const summary = stringOrNull(body.summary);
  const audioUrl = stringOrNull(body.audio_url);
  const plaudId = stringOrNull(body.plaud_id);
  const recordedAt = isoDateOrNull(body.recorded_at);

  // Pack the non-transcript metadata into the notes field so we can
  // surface it on the review screen without a schema change.
  const notesParts: string[] = [];
  if (summary) notesParts.push(`Plaud summary:\n${summary}`);
  if (audioUrl) notesParts.push(`Audio: ${audioUrl}`);
  if (plaudId) notesParts.push(`Plaud ID: ${plaudId}`);
  const notes = notesParts.length > 0 ? notesParts.join('\n\n') : null;

  // --- insert capture (service role bypasses RLS) -------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      { error: 'Server not configured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' },
      500
    );
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inserted, error: insertError } = await admin
    .from('daily_captures')
    .insert({
      owner_user_id: ownerUserId,
      source_kind: 'webhook',
      source_filename: title ? `${title}.txt` : null,
      title: title,
      captured_at: recordedAt,
      notes,
      raw_text: transcript,
      extraction_status: 'pending',
    })
    .select('id')
    .single();
  if (insertError) {
    return json(
      { error: `Insert failed: ${insertError.message}` },
      500
    );
  }
  const captureId = inserted?.id;

  // --- fire-and-forget extraction ----------------------------------
  // We don't await this — Claude extraction can take 30s-2min for long
  // transcripts and we want Zapier to see a fast 200. EdgeRuntime.waitUntil
  // keeps the function alive past the response so the fetch can complete.
  try {
    const extractUrl = `${supabaseUrl}/functions/v1/daily-capture-extract`;
    const extractPromise = fetch(extractUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': expectedSecret,
      },
      body: JSON.stringify({ capture_id: captureId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error(
            'daily-capture-extract returned',
            res.status,
            await res.text()
          );
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('daily-capture-extract fetch failed:', err);
      });
    // @ts-ignore — EdgeRuntime is provided by Supabase's Deno runtime.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(extractPromise);
    }
  } catch (e) {
    // Don't fail the webhook if scheduling the background call breaks;
    // the capture is still in the DB and a manual "retry extract" from
    // the app will pick it up.
    // eslint-disable-next-line no-console
    console.error('Failed to schedule extract:', e);
  }

  return json({ ok: true, capture_id: captureId }, 200);
});

// --- helpers --------------------------------------------------------

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function isoDateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // Accept either "YYYY-MM-DD" or full ISO ("2026-06-01T14:30:00Z").
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
