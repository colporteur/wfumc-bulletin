-- =====================================================================
-- resources: add 'exegesis' to the resource_type CHECK
--
-- Lets the pastor catalog direct biblical commentary / interpretation /
-- scholarship as its own type, distinct from a story or illustration.
-- Exegesis entries typically come out of PDFs of commentaries (the page
-- range feature this batch ships alongside makes those imports fast),
-- and are most useful for sermon prep when the pastor is doing close
-- work on a passage.
--
-- Convention everywhere else: when filtering or styling, exegesis gets
-- a cyan badge (distinct from quote-purple and note-gray) so it reads
-- as scholarly without competing with the warmth of story / illustration.
-- =====================================================================

alter table public.resources
  drop constraint if exists resources_resource_type_check;

alter table public.resources
  add constraint resources_resource_type_check
  check (resource_type in (
    'story', 'quote', 'illustration', 'joke', 'note', 'photo', 'exegesis'
  ));
