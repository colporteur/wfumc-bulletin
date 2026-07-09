-- =====================================================================
-- Phase B — multi-provider routing support
--
-- 1. church_settings gains two more server-side keys:
--      openrouter_api_key — the universal fallback: any model the
--                           pastor has no native key for routes
--                           through OpenRouter's OpenAI-compatible API.
--      meta_api_key       — native key for Meta Model API (Muse Spark
--                           lives there and is NOT on OpenRouter; Meta
--                           is keeping it off third-party gateways).
--    SAFETY: church_settings_public is an explicit column list
--    (0001), so these columns are automatically excluded from the
--    anon-readable view — same posture as anthropic_api_key. Keys are
--    only ever read server-side by the claude-proxy Edge Function.
--
-- 2. ai_models gains openrouter_model_id — the OpenRouter slug for a
--    model (e.g., 'google/gemini-3.1-pro'), used when the fallback
--    route is taken. Null means "model_id works on the native API
--    only" (or, for provider='openrouter' rows, model_id IS the slug).
--
-- Routing rule (implemented in claude-proxy):
--   anthropic rows            → native Anthropic (as always)
--   other rows w/ native key  → that provider's OpenAI-compatible API
--   otherwise                 → OpenRouter with the pastor's OR key
--   no covering key           → clear error naming the missing key
-- =====================================================================

alter table public.church_settings
  add column if not exists openrouter_api_key text,
  add column if not exists meta_api_key text;

alter table public.ai_models
  add column if not exists openrouter_model_id text;
