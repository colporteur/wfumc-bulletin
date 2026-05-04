// =====================================================================
// url-fetch — Supabase Edge Function
//
// Browsers can't fetch arbitrary external URLs because of CORS, so
// we proxy through this Edge Function. Used by the Sermons app's
// /resources/extract page to pull article / blog text from a URL the
// pastor pastes in.
//
// Auth flow:
//   - Same as claude-proxy: requires a Supabase JWT in
//     `Authorization: Bearer ...`. Authenticated user is enough.
//
// Request body:
//   { "url": "https://example.com/article" }
//
// Response body:
//   { "text": "...plain text...", "title": "...", "finalUrl": "..." }
//
// Limits:
//   - Caps response to 5 MB raw / 200k chars of text
//   - 30s fetch timeout
//   - Refuses non-http(s) URLs and obvious local/private IPs
//
// Deploy with:
//   supabase functions deploy url-fetch
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB raw response cap
const MAX_TEXT_CHARS = 200_000; // ~50k tokens — generous for Claude
const FETCH_TIMEOUT_MS = 30_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // 1. Authenticate
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Server misconfiguration' }, 500);
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // 2. Parse body
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const url = (body?.url || '').trim();
  if (!url) {
    return jsonResponse({ error: 'url is required' }, 400);
  }

  // 3. Validate URL — reject non-http(s) and obvious local/private hosts
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return jsonResponse({ error: 'Invalid URL' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonResponse({ error: 'Only http(s) URLs are allowed' }, 400);
  }
  if (isLikelyLocalHost(parsed.hostname)) {
    return jsonResponse({ error: 'Local / private hosts are not allowed' }, 400);
  }

  // 4. Fetch with timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        // Some sites refuse blank UAs; identify ourselves civilly.
        'User-Agent': 'WFUMC-ResourceCapture/0.1 (+wfumc.org)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return jsonResponse(
      { error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      502
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    return jsonResponse(
      { error: `Page returned HTTP ${res.status}` },
      res.status >= 500 ? 502 : res.status
    );
  }

  // 5. Stream-read with byte cap
  const reader = res.body?.getReader();
  if (!reader) {
    return jsonResponse({ error: 'Empty response' }, 502);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return jsonResponse(
          { error: `Page too large (>${MAX_BYTES} bytes)` },
          413
        );
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }

  // 6. Decode (best-effort UTF-8) and convert HTML → text
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const html = decoder.decode(buf);
  const { text, title } = htmlToText(html);

  const trimmedText =
    text.length > MAX_TEXT_CHARS
      ? text.slice(0, MAX_TEXT_CHARS) + '\n…[truncated]'
      : text;

  return jsonResponse({
    text: trimmedText,
    title,
    finalUrl: res.url || parsed.toString(),
  });
});

// ---- helpers ----

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function isLikelyLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.localhost')) return true;
  // RFC1918 private IPv4 ranges
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // Link-local
  if (/^169\.254\./.test(h)) return true;
  // IPv6 unique-local
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  return false;
}

// Best-effort HTML → text. Strips scripts/styles/nav/aside/header/footer/
// forms then collapses whitespace. Not a Readability.js replacement, but
// sufficient for the "give Claude something to mine" use case.
function htmlToText(html: string): { text: string; title: string } {
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = decodeEntities(titleMatch[1].trim()).slice(0, 300);
  }

  let body = html;
  // Drop <script>, <style>, <noscript>, <svg> blocks entirely
  body = body.replace(
    /<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' '
  );
  // Drop common boilerplate containers
  body = body.replace(
    /<(nav|aside|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' '
  );
  // Strip remaining tags
  body = body.replace(/<[^>]+>/g, ' ');
  // Decode entities
  body = decodeEntities(body);
  // Collapse whitespace
  body = body
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: body, title };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
}
