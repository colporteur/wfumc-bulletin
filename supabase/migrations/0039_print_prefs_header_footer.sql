-- =====================================================================
-- Print preferences: full Word header + footer support
--
-- 0038 added a single header_content text field (one line, with
-- {token} substitution). The real Word documents Todd uses have:
--
--   - A multi-line header AND a multi-line footer (both real Word
--     header/footer regions, not body content).
--   - Each region with its own alignment (left/center/right), italic
--     toggle, and font size — typically smaller than the body.
--   - The body starts directly with the first instruction line, with
--     NO title block at the top of page 1 (the title lives only in
--     Word's header).
--   - A {church} token used in the footer ("April 29, 2026 – Wedowee
--     First UMC – Acts 2:42-47"), which needs a per-user default
--     church name to resolve.
--
-- This migration extends the existing print_preferences row to support
-- all of that, additively. Defaults preserve the previous behavior:
--   - footer_content empty, so existing rows keep no footer
--   - title_in_body=true (the previous behavior — title rendered in body)
-- A pastor can flip those via the settings page or the new "sermon
-- manuscript preset" button.
-- =====================================================================

alter table public.print_preferences
  -- Header alignment + styling
  add column if not exists header_alignment text not null default 'center'
    check (header_alignment in ('left', 'center', 'right')),
  add column if not exists header_italic boolean not null default false,
  add column if not exists header_size_pt int not null default 12
    check (header_size_pt between 6 and 24),

  -- Footer (mirrors header)
  add column if not exists footer_content text not null default '',
  add column if not exists footer_alignment text not null default 'center'
    check (footer_alignment in ('left', 'center', 'right')),
  add column if not exists footer_italic boolean not null default false,
  add column if not exists footer_size_pt int not null default 12
    check (footer_size_pt between 6 and 24),

  -- Whether the title is rendered as a heading at the top of the body.
  -- For Todd's style this is FALSE (title lives in the header).
  add column if not exists title_in_body boolean not null default true,

  -- Default church name used to resolve the {church} header/footer
  -- token. Per-sermon overrides happen in the export modal.
  add column if not exists default_church_name text;
