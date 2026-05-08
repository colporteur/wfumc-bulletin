-- =====================================================================
-- workspace_slides.marker_description
--
-- The descriptor that comes after the dash in an inline manuscript
-- marker (`<SLIDE - DESCRIPTION>` or `<SLIDE #N - DESCRIPTION>`)
-- captured as a separate field on the slide. The pastor may use it
-- to populate the slide title, the slide body, or both — depending
-- on what the marker text best fits — without forcing the value into
-- one place or the other at create time.
--
-- For slides created from a manuscript marker (Force Manuscript→Panel
-- or Create from markers), this column gets the original descriptor
-- text. For slides created manually from the panel, it stays NULL.
-- =====================================================================

alter table public.workspace_slides
  add column if not exists marker_description text;
