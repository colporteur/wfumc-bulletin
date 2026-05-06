-- =====================================================================
-- Public read for sermon_slide_images
--
-- Mirrors the existing sermons "Sermon read access" policy: anonymous
-- worshippers (including not-signed-in visitors) can see slide images
-- for sermons that are either:
--
--   - linked to a published bulletin (so the slides appear inline
--     when worshippers view the bulletin), or
--   - tagged as preached at our church via preachings.is_at_our_church
--     (so they appear in the public WFUMC sermon archive too).
--
-- The original owner-only SELECT policy stays in place. Postgres RLS
-- combines policies with OR semantics on SELECT, so the owner still
-- has full access AND the public path is added.
-- =====================================================================

create policy "Slide images read for public sermons"
  on public.sermon_slide_images for select
  using (
    exists (
      select 1
      from public.liturgy_items li
      join public.bulletins b on b.id = li.bulletin_id
      where li.sermon_id = sermon_slide_images.sermon_id
        and b.status = 'published'
    )
    or exists (
      select 1
      from public.preachings p
      where p.sermon_id = sermon_slide_images.sermon_id
        and p.is_at_our_church = true
    )
  );
