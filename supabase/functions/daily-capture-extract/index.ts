// =====================================================================
// daily-capture-extract — Supabase Edge Function
//
// Triggered by plaud-webhook (fire-and-forget) after a capture is
// inserted. Splits the transcript into chunks, calls Anthropic per
// chunk, inserts the resulting segments into daily_capture_segments,
// and marks the capture as 'extracted'.
//
// This is a server-side mirror of `extractAllSegmentsForCapture` from
// the Daily Capture app. The React app's version still works for any
// capture the user creates by hand; this exists so webhook captures
// also get extracted without the pastor opening the app.
//
// Auth: requires the same WEBHOOK_SHARED_SECRET header as plaud-webhook.
// This is an internal endpoint not called from the browser.
//
// Request body (JSON):
//   { "capture_id": "uuid" }
//
// Response:
//   200  { ok: true, segments: <count>, chunks: <count>, partial: bool }
//   400  { error: "..." }
//   401  { error: "Invalid webhook secret" }
//   404  { error: "Capture not found" }
//   500  { error: "..." }
//
// Deploy with:
//   supabase functions deploy daily-capture-extract --no-verify-jwt
// =====================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_WORDS_PER_CHUNK = 2500;

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

  // --- auth -------------------------------------------------------
  const expectedSecret = Deno.env.get('WEBHOOK_SHARED_SECRET');
  if (!expectedSecret) {
    return json(
      { error: 'Server not configured: WEBHOOK_SHARED_SECRET is unset' },
      500
    );
  }
  const presented =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('X-Webhook-Secret') ||
    '';
  if (presented !== expectedSecret) {
    return json({ error: 'Invalid webhook secret' }, 401);
  }

  // --- parse body --------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be valid JSON' }, 400);
  }
  const captureId = String(body.capture_id ?? '').trim();
  if (!captureId) {
    return json({ error: 'Missing capture_id' }, 400);
  }

  // --- supabase + anthropic clients -------------------------------
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

  // Anthropic key comes from public.church_settings (same single-row
  // pattern claude-proxy uses).
  const anthropicKey = await loadAnthropicKey(admin);
  if (!anthropicKey) {
    return json(
      { error: 'No Anthropic API key in public.church_settings' },
      500
    );
  }

  // --- load the capture -------------------------------------------
  const { data: capture, error: capErr } = await admin
    .from('daily_captures')
    .select('id, owner_user_id, raw_text, extraction_status')
    .eq('id', captureId)
    .maybeSingle();
  if (capErr) return json({ error: capErr.message }, 500);
  if (!capture) return json({ error: 'Capture not found' }, 404);
  if (capture.extraction_status === 'extracted') {
    // Idempotent: don't re-extract if already done.
    return json({ ok: true, alreadyExtracted: true }, 200);
  }

  // --- chunk + extract --------------------------------------------
  const chunks = splitTranscriptIntoChunks(capture.raw_text || '', MAX_WORDS_PER_CHUNK);
  if (chunks.length === 0) {
    await admin
      .from('daily_captures')
      .update({
        extraction_status: 'pending',
        extraction_error: 'Empty transcript — nothing to extract.',
      })
      .eq('id', captureId);
    return json({ error: 'Empty transcript' }, 400);
  }

  let totalSegments = 0;
  let firstError: string | null = null;
  let succeededAny = false;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const segments = await callClaudeForSegments(
        anthropicKey,
        chunks[i],
        chunks.length > 1 ? `Part ${i + 1} of ${chunks.length}.` : ''
      );
      if (segments.length > 0) {
        const rows = segments.map((s, j) => ({
          capture_id: captureId,
          owner_user_id: capture.owner_user_id,
          excerpt: s.excerpt,
          description: s.description || null,
          proposed_destinations: s.proposed_destinations,
          mentioned_names: s.mentioned_names,
          rationale: s.rationale || null,
          sort_order: totalSegments + j,
        }));
        const { error: insErr } = await admin
          .from('daily_capture_segments')
          .insert(rows);
        if (insErr) throw new Error(insErr.message);
        totalSegments += segments.length;
      }
      succeededAny = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!firstError) firstError = msg;
      // Keep going — partial extraction is still useful.
    }
  }

  // --- update capture status --------------------------------------
  if (!succeededAny) {
    await admin
      .from('daily_captures')
      .update({
        extraction_status: 'pending',
        extraction_error: firstError || 'Unknown extraction failure',
      })
      .eq('id', captureId);
    return json(
      { error: `Extraction failed: ${firstError}` },
      500
    );
  }

  const partial = firstError !== null && totalSegments > 0;
  await admin
    .from('daily_captures')
    .update({
      extraction_status: 'extracted',
      extracted_at: new Date().toISOString(),
      extraction_error: partial
        ? `Partial: ${firstError}`
        : null,
    })
    .eq('id', captureId);

  return json(
    {
      ok: true,
      segments: totalSegments,
      chunks: chunks.length,
      partial,
    },
    200
  );
});

// =====================================================================
// Helpers — ported from the Daily Capture app's lib/claude.js +
// lib/captures.js so this function can run standalone.
// =====================================================================

async function loadAnthropicKey(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from('church_settings')
    .select('anthropic_api_key')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load anthropic_api_key:', error);
    return null;
  }
  return (data?.anthropic_api_key as string | null) || null;
}

interface ExtractedSegment {
  excerpt: string;
  description: string;
  proposed_destinations: string[];
  mentioned_names: string[];
  rationale: string;
}

async function callClaudeForSegments(
  apiKey: string,
  chunkText: string,
  contextHint: string
): Promise<ExtractedSegment[]> {
  const system = SYSTEM_PROMPT;
  const userMsg =
    (contextHint ? `Context: ${contextHint}\n\n` : '') +
    'Transcript:\n' +
    chunkText;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      system,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 12000,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 400)}`);
  }
  const result = await res.json();
  const text = firstText(result);
  const parsed = parseClaudeJson(text);
  if (!parsed || !Array.isArray(parsed.segments)) {
    throw new Error('Claude did not return a segments[] array.');
  }
  const VALID = new Set(['pastoral_interaction', 'pastoral_note', 'sermon_resource']);
  return parsed.segments
    .filter(
      (s: unknown) =>
        s &&
        typeof s === 'object' &&
        typeof (s as { excerpt?: unknown }).excerpt === 'string'
    )
    .map((s: Record<string, unknown>) => ({
      excerpt: String(s.excerpt || '').trim(),
      description:
        typeof s.description === 'string' ? s.description.trim() : '',
      proposed_destinations: Array.isArray(s.proposed_destinations)
        ? Array.from(
            new Set(
              (s.proposed_destinations as unknown[])
                .map((d) => (typeof d === 'string' ? d.trim() : ''))
                .filter((d) => VALID.has(d))
            )
          )
        : [],
      mentioned_names: Array.isArray(s.mentioned_names)
        ? (s.mentioned_names as unknown[])
            .map((n) => (typeof n === 'string' ? n.trim() : ''))
            .filter(Boolean)
        : [],
      rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
    }))
    .filter((s: ExtractedSegment) => s.excerpt.length > 0);
}

function firstText(result: { content?: Array<{ type?: string; text?: string }> }): string {
  const block = result?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

function parseClaudeJson(text: string): { segments?: unknown[] } | null {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// --- chunker (port of splitTranscriptIntoChunks) ---------------------

function splitTranscriptIntoChunks(text: string, maxWords: number): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  if (countWords(raw) <= maxWords) return [raw];
  const units = splitIntoUnits(raw, maxWords);
  const chunks: string[] = [];
  let current = '';
  let currentWords = 0;
  for (const u of units) {
    const uWords = countWords(u);
    if (currentWords > 0 && currentWords + uWords > maxWords) {
      chunks.push(current);
      current = u;
      currentWords = uWords;
    } else {
      current = current ? current + '\n\n' + u : u;
      currentWords += uWords;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitIntoUnits(text: string, maxWords: number): string[] {
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (countWords(p) <= maxWords) {
      out.push(p);
      continue;
    }
    // Paragraph too big → try single newlines.
    const lines = p.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let buf = '';
    let bufWords = 0;
    for (const line of lines) {
      const lw = countWords(line);
      if (lw > maxWords) {
        if (buf) {
          out.push(buf);
          buf = '';
          bufWords = 0;
        }
        const sentences = line
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
        let sbuf = '';
        let sbufWords = 0;
        for (const s of sentences) {
          const sw = countWords(s);
          if (sw > maxWords) {
            if (sbuf) {
              out.push(sbuf);
              sbuf = '';
              sbufWords = 0;
            }
            const words = s.split(/\s+/);
            for (let i = 0; i < words.length; i += maxWords) {
              out.push(words.slice(i, i + maxWords).join(' '));
            }
            continue;
          }
          if (sbufWords + sw > maxWords && sbuf) {
            out.push(sbuf);
            sbuf = s;
            sbufWords = sw;
          } else {
            sbuf = sbuf ? sbuf + ' ' + s : s;
            sbufWords += sw;
          }
        }
        if (sbuf) out.push(sbuf);
      } else if (bufWords + lw > maxWords && buf) {
        out.push(buf);
        buf = line;
        bufWords = lw;
      } else {
        buf = buf ? buf + '\n' + line : line;
        bufWords += lw;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function countWords(s: string): number {
  const t = (s || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// --- helpers --------------------------------------------------------

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// =====================================================================
// System prompt — kept verbatim with the React app's prompt so behavior
// is consistent whether extraction runs server-side (this function) or
// client-side (the Daily Capture app's extractAllSegmentsForCapture).
// =====================================================================

const SCHEMA_DESCRIPTION =
  'Return JSON in this exact shape (no other text, no code fences):\n' +
  '{\n' +
  '  "segments": [\n' +
  '    {\n' +
  '      "excerpt": string (verbatim slice of the transcript, ' +
  "preserving the pastor's own wording),\n" +
  '      "description": string (one short sentence summarising what\n' +
  "          this segment is about, written in the pastor's\n" +
  '          voice — e.g. "Visited Mrs. Johnson; she was worried\n' +
  "          about her grandson's job\"),\n" +
  '      "proposed_destinations": array of one or more strings from:\n' +
  '          "pastoral_interaction", "pastoral_note", "sermon_resource",\n' +
  '      "mentioned_names": array of strings (people referenced by\n' +
  '          name — full names if used, otherwise as said),\n' +
  '      "rationale": string (one short sentence explaining why you\n' +
  '          classified it this way; cite a phrase from the segment\n' +
  '          if helpful)\n' +
  '    },\n' +
  '    ...\n' +
  '  ]\n' +
  '}\n';

const DESTINATION_RULES =
  'How to choose destinations:\n' +
  '- pastoral_interaction: a meaningful encounter with a parishioner\n' +
  '  (visit, conversation, phone call, observation of them during an\n' +
  '  event). Includes the substance of what was discussed.\n' +
  '- pastoral_note: a small observation worth remembering across\n' +
  '  visits — preferences, family details, a recurring concern, a\n' +
  '  detail the pastor would want to recall in three months. Shorter\n' +
  '  than an interaction.\n' +
  '- sermon_resource: an anecdote, story, quote, observation, or\n' +
  '  real-life parallel that could be drawn on in a future sermon.\n' +
  '  This is the only destination that has nothing to do with a\n' +
  '  specific parishioner — it lives in the sermon resource library.\n' +
  '\n' +
  'A single segment MAY have multiple destinations. For example, the\n' +
  'pastor recounting a visit where the parishioner shared a story that\n' +
  'could illustrate prodigal-son themes — that\'s both a\n' +
  'pastoral_interaction (about that visit) AND a sermon_resource\n' +
  '(the story itself).\n' +
  '\n' +
  'Segment boundaries: each segment should be ONE topical unit —\n' +
  'one conversation, one anecdote, one observation. Skip recording\n' +
  'fumbles, navigation chatter ("turn left here"), and meaningless\n' +
  'small talk. If a stretch has no pastoral or illustration value,\n' +
  'omit it entirely rather than emit a segment.\n' +
  '\n' +
  "Excerpt rules: preserve the pastor's own words. Light cleanup of\n" +
  'transcription artifacts ("um", "uh", repeated false starts) is\n' +
  'fine, but do not paraphrase. The pastor needs the segment to\n' +
  'read like what they actually said. Keep excerpts under ~400\n' +
  'words; if a topical unit is longer, summarise the middle inside\n' +
  '[brackets] but keep the opening + closing verbatim.\n';

const SYSTEM_PROMPT =
  'You are helping a United Methodist pastor triage a daily audio\n' +
  'transcript (typically from a Plaud Note recorder) into structured\n' +
  'records. You will split it into pastorally-meaningful segments\n' +
  'and propose which downstream table each one should land in.\n' +
  '\n' +
  SCHEMA_DESCRIPTION +
  '\n' +
  DESTINATION_RULES +
  '\n\n' +
  'Output JSON only. No preamble. No code fences. If the transcript\n' +
  'contains nothing pastorally meaningful, return { "segments": [] }.';
