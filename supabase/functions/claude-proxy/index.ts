// =====================================================================
// claude-proxy — Supabase Edge Function (Phase B: provider-aware)
//
// One proxy for every AI call in the WFUMC suite. Apps always speak
// the Anthropic Messages shape; this function routes each request to
// the right provider and translates both directions when the target
// speaks the OpenAI dialect. API keys never leave the server.
//
// Routing (the pastor's preference rule):
//   1. Model not in the ai_models registry, or provider='anthropic'
//      → native Anthropic (back-compat: unknown models behave exactly
//        as before Phase B).
//   2. Non-Anthropic provider with a native key configured (e.g.,
//      meta + meta_api_key → https://api.meta.ai/v1)
//      → that provider's OpenAI-compatible endpoint.
//   3. Otherwise, openrouter_api_key configured
//      → OpenRouter (openrouter.ai), using the row's
//        openrouter_model_id (falls back to model_id).
//   4. No covering key → 400 with a message naming the missing key.
//
// Auth flow: unchanged — caller's Supabase JWT verified, keys read via
// service-role from public.church_settings.
//
// Request body shape (unchanged):
//   {
//     "messages": [{ "role": "user", "content": string | Block[] }],
//     "system": "optional system prompt",
//     "max_tokens": 1024,
//     "model": "claude-sonnet-4-6"   // optional override
//   }
// Content blocks: Anthropic-style text + base64 image blocks. For
// OpenAI-dialect targets, image blocks become data-URL image_url
// parts; responses are translated back into the Anthropic shape
// ({ content: [{ type: 'text', text }], ... }) so no app changes.
//
// Deploy with:
//   supabase functions deploy claude-proxy --no-verify-jwt
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

// Native OpenAI-compatible endpoints for providers the pastor may hold
// a direct key for. Adding a provider later = one entry here + a key
// column in church_settings (+ the select below).
const NATIVE_OPENAI_ENDPOINTS: Record<string, string> = {
  meta: 'https://api.meta.ai/v1/chat/completions',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// deno-lint-ignore no-explicit-any
type Json = any;

interface ProxyRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: Json }>;
  system?: string;
  max_tokens?: number;
  model?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // 1. Authenticate the requester via their Supabase JWT.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server misconfiguration' }, 500);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // 2. Read provider keys (service-role; bypasses RLS; never leaves
  //    the server).
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: settings, error: settingsError } = await adminClient
    .from('church_settings')
    .select('anthropic_api_key, openrouter_api_key, meta_api_key')
    .eq('id', 1)
    .single();

  if (settingsError || !settings) {
    return jsonResponse({ error: 'Could not read church settings.' }, 500);
  }

  // 3. Parse the request body.
  let body: ProxyRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'messages[] is required' }, 400);
  }

  const requestedModel = body.model ?? DEFAULT_MODEL;

  // 4. Registry lookup. Match on model_id or openrouter_model_id so
  //    apps can send whichever string the registry row exposes.
  //    Unknown models fall through to native Anthropic — identical to
  //    pre-Phase-B behavior, so nothing existing can break.
  const { data: regRow } = await adminClient
    .from('ai_models')
    .select('provider, model_id, openrouter_model_id, enabled')
    .or(`model_id.eq.${requestedModel},openrouter_model_id.eq.${requestedModel}`)
    .maybeSingle();

  if (regRow && regRow.enabled === false) {
    return jsonResponse(
      { error: `Model "${requestedModel}" is disabled in the AI Models registry.` },
      400
    );
  }

  const provider = regRow?.provider ?? 'anthropic';

  // 5. Route.
  if (provider === 'anthropic') {
    if (!settings.anthropic_api_key) {
      return jsonResponse(
        { error: 'No Anthropic API key configured. Set one in Settings.' },
        400
      );
    }
    return callAnthropic(settings.anthropic_api_key, requestedModel, body);
  }

  // Non-Anthropic: prefer the provider's native key…
  const nativeEndpoint = NATIVE_OPENAI_ENDPOINTS[provider];
  const nativeKey = provider === 'meta' ? settings.meta_api_key : null;
  if (nativeEndpoint && nativeKey) {
    return callOpenAICompatible(
      nativeEndpoint,
      nativeKey,
      regRow?.model_id ?? requestedModel,
      body,
      {}
    );
  }

  // …fall back to OpenRouter.
  if (settings.openrouter_api_key) {
    const orModel =
      regRow?.openrouter_model_id ?? regRow?.model_id ?? requestedModel;
    return callOpenAICompatible(
      OPENROUTER_URL,
      settings.openrouter_api_key,
      orModel,
      body,
      {
        // OpenRouter attribution headers (optional but polite).
        'HTTP-Referer': 'https://wfumc-apps.local',
        'X-Title': 'WFUMC App Suite',
      }
    );
  }

  return jsonResponse(
    {
      error:
        `Model "${requestedModel}" (provider: ${provider}) has no usable key. ` +
        `Add a native ${provider} key or an OpenRouter key in Settings.`,
    },
    400
  );
});

// ---------------------------------------------------------------------
// Native Anthropic path — unchanged behavior.
// ---------------------------------------------------------------------

async function callAnthropic(
  apiKey: string,
  model: string,
  body: ProxyRequestBody
): Promise<Response> {
  const anthropicBody: Record<string, unknown> = {
    model,
    max_tokens: body.max_tokens ?? 1024,
    messages: body.messages,
  };
  if (body.system) {
    anthropicBody.system = body.system;
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(anthropicBody),
  });

  const responseText = await res.text();
  return new Response(responseText, {
    status: res.status,
    headers: {
      ...corsHeaders,
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  });
}

// ---------------------------------------------------------------------
// OpenAI-dialect path (OpenRouter, Meta Model API, future vendors).
// Translates Anthropic-shaped requests out and OpenAI-shaped
// responses back, so callers never know the difference.
// ---------------------------------------------------------------------

function toOpenAIContent(content: Json): Json {
  // String content passes straight through.
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  // Anthropic block array → OpenAI part array.
  return content.map((block: Json) => {
    if (block?.type === 'text') {
      return { type: 'text', text: block.text ?? '' };
    }
    if (block?.type === 'image' && block?.source?.type === 'base64') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      };
    }
    // Unknown block type — degrade to its text, if any.
    return { type: 'text', text: block?.text ?? '' };
  });
}

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  body: ProxyRequestBody,
  extraHeaders: Record<string, string>
): Promise<Response> {
  const messages: Json[] = [];
  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }
  for (const m of body.messages) {
    messages.push({ role: m.role, content: toOpenAIContent(m.content) });
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: body.max_tokens ?? 1024,
    }),
  });

  const raw = await res.text();

  if (!res.ok) {
    // Normalize the error shape to Anthropic-ish so the apps' error
    // translators recognize it: { error: { message } }.
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error?.message || parsed?.message || raw.slice(0, 500);
    } catch {
      message = raw.slice(0, 500);
    }
    return jsonResponse({ error: { type: 'provider_error', message } }, res.status);
  }

  let parsed: Json;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse(
      { error: { type: 'provider_error', message: 'Provider returned non-JSON.' } },
      502
    );
  }

  const choice = parsed?.choices?.[0];
  const text: string = choice?.message?.content ?? '';

  // Translate to the Anthropic Messages response shape the apps parse.
  const anthropicShaped = {
    id: parsed?.id ?? 'openai-compat',
    type: 'message',
    role: 'assistant',
    model: parsed?.model ?? model,
    content: [{ type: 'text', text }],
    stop_reason:
      choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: parsed?.usage?.prompt_tokens ?? 0,
      output_tokens: parsed?.usage?.completion_tokens ?? 0,
    },
  };

  return jsonResponse(anthropicShaped, 200);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
