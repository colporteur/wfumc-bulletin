// =====================================================================
// claude-proxy — Supabase Edge Function
//
// Proxies requests from the admin UI to api.anthropic.com.
// The Anthropic API key never leaves the server.
//
// Auth flow:
//   1. The admin UI sends a request with the user's Supabase JWT
//      in the `Authorization: Bearer <jwt>` header.
//   2. This function verifies the user is authenticated AND has a
//      staff_profile (any role).
//   3. It reads the Anthropic API key from public.church_settings.
//   4. It forwards the request body to Anthropic and returns the response.
//
// Request body shape:
//   {
//     "messages": [{ "role": "user", "content": "..." }],
//     "system": "optional system prompt",
//     "max_tokens": 1024,
//     "model": "claude-sonnet-4-6"   // optional override
//   }
//
// Deploy with:
//   supabase functions deploy claude-proxy
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ClaudeRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
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

  // Verify the user with the anon client (using their JWT)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Verify the user is a staff member
  const { data: staffProfile } = await userClient
    .from('staff_profiles')
    .select('role')
    .eq('user_id', userData.user.id)
    .single();

  if (!staffProfile) {
    return jsonResponse({ error: 'Staff access required' }, 403);
  }

  // 2. Read the Anthropic API key with the service-role client (bypasses RLS).
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: settings, error: settingsError } = await adminClient
    .from('church_settings')
    .select('anthropic_api_key')
    .eq('id', 1)
    .single();

  if (settingsError || !settings?.anthropic_api_key) {
    return jsonResponse(
      { error: 'No Anthropic API key configured. Set one in Settings.' },
      400
    );
  }

  // 3. Parse the request body
  let body: ClaudeRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'messages[] is required' }, 400);
  }

  // 4. Forward to Anthropic
  const anthropicBody: Record<string, unknown> = {
    model: body.model ?? DEFAULT_MODEL,
    max_tokens: body.max_tokens ?? 1024,
    messages: body.messages,
  };
  if (body.system) {
    anthropicBody.system = body.system;
  }

  const anthropicRes = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.anthropic_api_key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(anthropicBody),
  });

  const responseText = await anthropicRes.text();
  return new Response(responseText, {
    status: anthropicRes.status,
    headers: {
      ...corsHeaders,
      'content-type': anthropicRes.headers.get('content-type') ?? 'application/json',
    },
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
