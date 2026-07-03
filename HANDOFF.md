# WFUMC App Suite — Handoff Document

> **Purpose:** Give a new Claude thread everything it needs to immediately be useful
> to Todd (Pastor Todd Noren-Hentz) on the WFUMC (Wedowee First United Methodist
> Church) technology stack. This document is the **first thing to read** when you
> pick up a new session on this project. Read it front-to-back before touching any
> code or asking clarifying questions.

Last updated: session ending on migration `0067_admin_note_sunday_hint.sql`.

---

## 1. Who you're working with

- **User:** Todd Noren-Hentz, pastor at Wedowee First United Methodist Church
  (WFUMC) in Wedowee, AL. Email: `colporteurbooks@gmail.com`.
- **Todd's workflow:** He runs the pastoral, sermon, admin, and lesson-planning
  side of the church himself. He works on Windows (PowerShell terminal), uses
  Plaud Note (audio recorder) heavily, and has built up a large corpus of
  sermon material (~20 years of manuscripts) and pastoral records over decades.
- **Communication style:** Practical, direct, appreciates concise reports and
  well-designed data models. He likes discussion + confirmation before big
  changes. He's comfortable with technical language but usually wants the
  business-value explanation first.
- **Font preference:** **Albertus Medium** everywhere — Word docs, PowerPoint
  slides. When users see mixed fonts, they will complain. See §6.

---

## 2. The eight apps (all in Todd's mounted folders)

Each app is a separate Vite + React + Tailwind PWA that deploys to GitHub Pages
via GitHub Actions. All share one Supabase project (see §3).

| # | App                             | Folder                                                              | Purpose                                                                              |
|---|---------------------------------|---------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| 1 | **Bulletin App**                | `/sessions/happy-hopeful-pascal/mnt/WFUMC Bulletin App`             | Sunday bulletin editor + worshipper display. **Hosts all Supabase migrations & Edge Functions.** |
| 2 | **Sermons App** (Sermon Archive)| `/sessions/happy-hopeful-pascal/mnt/WFUMC Sermons App`              | Sermon manuscript library, workspace, resources, liturgies, slides.                  |
| 3 | **Social App**                  | `/sessions/happy-hopeful-pascal/mnt/WFUMC Social App`               | Social-media post drafting fed by sermons, submissions, and admin sources.           |
| 4 | **Worship Planning App**        | `/sessions/happy-hopeful-pascal/mnt/WFUMC Worship Planning App`     | 12-week worship forecast — themes, voting, sermon planning, admin items.             |
| 5 | **Pastoral Records App**        | `/sessions/happy-hopeful-pascal/mnt/WFUMC Pastoral Records App`     | Parishioner directory + interactions, notes, family, end-of-life, documents.         |
| 6 | **Daily Capture App**           | `/sessions/happy-hopeful-pascal/mnt/WFUMC Daily Capture App`        | Plaud → Zapier → segmented Claude → four downstream apps (triage inbox).             |
| 7 | **Lesson Maker App**            | `/sessions/happy-hopeful-pascal/mnt/WFUMC Lesson Maker App`         | Bible-study lesson editor with per-person groups + queues.                           |
| 8 | **SS (Sunday School)**          | `/sessions/happy-hopeful-pascal/mnt/WFUMC SS`                       | Todd's specific Sunday School class — flexible sections, back page, public views.    |

**Todd's Windows paths look like** `C:\Users\noren\Google Drive\WFUMC Bulletin App`
(and equivalents for each app). Don't expose sandbox paths (`/sessions/...`) to
Todd — say "the Bulletin App folder" or "the folder you selected" instead.

---

## 3. Shared Supabase project

All eight apps share **one** Supabase project (Todd's personal one, linked from
the Bulletin App folder). Consequences:

- **Migrations live in one folder only:** `WFUMC Bulletin App/supabase/migrations/`.
  Every schema change for every app goes there. Numbered sequentially. Latest is
  `0067_admin_note_sunday_hint.sql`. Next migration should be `0068_...`.
- **Edge Functions live in one folder only:** `WFUMC Bulletin App/supabase/functions/`.
  Currently deployed:
  - `claude-proxy` — proxies Anthropic API calls, pulls API key from
    `public.church_settings` server-side so the key never reaches the browser.
    Every app that talks to Claude routes through it.
  - `url-fetch` — server-side page fetcher for the Resources Extract flow.
  - `plaud-webhook` — Zapier POSTs Plaud transcripts here; inserts a
    `daily_captures` row and fires the extract function.
  - `daily-capture-extract` — chunks long transcripts, calls Claude per chunk,
    inserts segments into `daily_capture_segments`.
- **RLS is the security boundary.** Most tables are `owner_user_id = auth.uid()`
  scoped. Exceptions: `worship_plans` (staff-shared — anyone on the church
  team edits collaboratively), historical sermon data (readable by everyone
  because it's the shared archive).
- **Roles:** `pastor`, `music_director`, `pianist`, `secretary`, `treasurer`,
  `staff`, `social_media`, `worship_team`, `office_admin`. Permissions live in
  each app's `lib/permissions.js`. Todd is `pastor` and sees everything.

### 3a. `supabase db push` gets out of sync — recurring problem

Twice this session (migrations 0066 and 0067), `supabase db push` from the
Bulletin App folder tried to replay from migration `0001_initial_schema.sql`
and failed with `relation "staff_profiles" already exists`. Both times the
resolution was:

1. Paste the migration SQL directly into Supabase Studio SQL Editor and Run.
2. `supabase migration list` afterward showed the remote history did include
   0001–0066 (before) or 0001–0067 (after) — so the local push was reconciling
   fine on its own or Todd repaired it manually.

**When this happens again:** don't panic. Offer the SQL-Editor paste path
first (fastest), then suggest running `supabase migration list` to diagnose.
Repair with `supabase migration repair --status applied <version>` only after
seeing the list output.

### 3b. Anthropic model conventions

- **Default model everywhere:** `claude-sonnet-4-6`. Do not add a new model
  without asking Todd.
- **Override option:** the Sermons App workspace lets Todd flip to
  `claude-opus-4-8` for manuscript work only, on a per-call basis. This was
  added because Todd wanted the extra headroom for sermon writing. (Note: the
  Opus model string was extrapolated from the naming pattern; if Anthropic
  ships a different identifier, it's a one-line fix in the model picker.)
- Claude runs through the `claude-proxy` Edge Function, which pulls the key
  from `public.church_settings` (single-row config table).

---

## 4. How the apps interact — the mental model

```
                 ┌─────────────────────────────────────────────┐
                 │              PLAUD RECORDER (Todd)          │
                 └────────────────────┬────────────────────────┘
                                      │  Zapier webhook (audio → transcript)
                                      ▼
                 ┌─────────────────────────────────────────────┐
                 │   plaud-webhook Edge Fn → daily-capture-extract
                 │   → creates daily_captures + daily_capture_segments
                 └────────────────────┬────────────────────────┘
                                      │
                                      ▼
                 ┌─────────────────────────────────────────────┐
                 │           WFUMC Daily Capture App           │
                 │  Pastor reviews each Claude-segmented chunk │
                 │  and routes it to ONE OR MORE of:           │
                 └───┬──────────────┬────────────┬───────────┬─┘
                     │              │            │           │
       pastoral_     pastoral_    sermon    worship_admin
       interaction   note        resource   note   (Phase 1)
                     │              │            │           │
                     ▼              ▼            ▼           ▼
         ┌──────────────────┐  ┌────────┐  ┌──────────┐  ┌──────────────┐
         │ Pastoral Records │  │ (same) │  │ Sermons  │  │ Worship      │
         │   pastoral_      │  │        │  │ App      │  │ Planning     │
         │   interactions   │  │        │  │ resources│  │ admin_items  │
         │   pastoral_notes │  │        │  │          │  │              │
         └──────────────────┘  └────────┘  └──────────┘  └──────────────┘
                                                              │
                                                              ▼
                                            attaches to worship_plans (Sundays)
                                            → renders on WeekCard Forecast panel
```

Other cross-app data flows worth knowing:

- **Bulletin → Sermon Archive:** when a bulletin sets a sermon, a `preachings`
  row is auto-created and the Sermon Archive can search it.
- **Sermons ↔ Resources:** every sermon links to its used resources; the
  workspace can auto-suggest resources by verse-level scripture overlap.
- **Worship Planning → Bulletin:** the "Sync to bulletin" button on a WeekCard
  pushes the plan's scripture / theme / sermon topic into the matching Sunday
  bulletin (creating the bulletin if it doesn't exist).
- **Worship Planning → Sermons:** the IntelligencePanel matches upcoming
  scripture against the sermon archive so Todd can reuse a base sermon.
- **Sunday School (SS) app** is separate — it manages ONE class (Todd's) with
  its own topics/lessons/roster/attendance/rotation tables (`ss_*`).
- **Lesson Maker app** is more general — reusable lessons for any bible study
  group, with a queue system and per-group "used by" tracking.

---

## 5. Big themes we've built this session

The session ran long — this is a summary of the major initiatives:

### 5a. Sermon Workspace enhancements
- Full-width layout on wide screens.
- Manuscript-relevance filter loosening + Retry-without-filter escape hatch.
- Extract Resources modal wired into the workspace (URL/PDF/paste sources,
  page-range parsing, preview pane, filter-by-manuscript tickbox).
- Model picker: default Sonnet 4.6, Opus 4.8 override for manuscript work.

### 5b. Liturgy drafting subsystem (Sermons App)
Migrations 0062. Full CRUD workspace with:
- 6 default elements per new liturgy: `call_to_worship`, `offering_statement`,
  `prelude`, `announcements`, `childrens_moment`, `congregational_prayer`.
  **Announcements is a first-class element** (was previously hidden behind a
  checkbox; that was removed).
- Draft/Brainstorm modals with per-element Claude instructions
  (`liturgy_element_instructions`).
- Duplicate-liturgy (copy whole liturgy into a new draft).
- Insert-Scripture-Sentence with proper handling of composite refs like
  "Matthew 11:16-19; 25-30" (chunks inherit book+chapter).
- Word doc export.

### 5c. Sunday School app — built from scratch this session
Migrations 0063–0065. Complete standalone app for Todd's Sunday School class.
- Flexible sections (JSONB array of `{header, body}`) with runtime
  auto-migration from the old 3-field model.
- Public views (`/public/lesson/:topicId`, roster, past, active, anonymous
  suggest).
- Bulk-import via docx/PDF parser + Claude topic matcher.
- Word doc export (per-person handout + back page).
- **Albertus Medium set on every TextRun** in both exporters (belt-and-
  suspenders because the docx library's `styles.default` doesn't fully
  override HeadingLevel themes).
- **Print Back Page button** on the LessonWorkspace (parallels the same on
  Dashboard).

### 5d. Admin Items — the "third bucket" (three phases, three apps)
This was the largest single initiative. Split into three phases and touches
Daily Capture, Bulletin (schema+Edge Fn), and Worship Planning.

- **Phase 1** (migration 0066): schema — `worship_admin_items` +
  `worship_admin_item_weeks` join table (multi-attach to Sundays, owner-scoped
  RLS). Daily Capture UI: fourth destination checkbox `worship_admin_note`,
  Claude prompt teaches when to classify as such.
- **Phase 2:** Worship Planning app gets `/admin-items` inbox (Inbox / Upcoming
  / All tabs), attach-to-Sundays multi-select picker, manual add form, and a
  WeekCard admin-items panel with quick Resolve/Detach.
- **Phase 3** (migration 0067): Claude populates
  `suggested_sunday_hint` on admin-note segments (only when the segment names
  a specific date/event/liturgical Sunday). The Worship Planning attach picker
  highlights matching plans, sorts them to the top with a ✨ marker, and
  offers "Select suggested Sunday(s)" to pre-fill checkboxes — but NEVER
  auto-attaches. Todd stays in the loop (his explicit ask).
  - The hint matcher (`matchPlansToHint` in
    `Worship Planning App/src/lib/adminItems.js`) covers liturgical aliases
    (Palm Sunday, Advent, etc.), date parses (`Dec 15`, `2026-07-14`, `7/14`),
    and keyword fallback (VBS, potluck).
  - Also fixed the Edge Function's whitelist that was missing
    `worship_admin_note` from Phase 1.

### 5e. Small quality-of-life wins
- Explainer chips next to Pastoral Interaction / Pastoral Note / Sermon
  Resource / Admin Item checkboxes on the Daily Capture review card.
- Migration 0061: added `exegesis` to `resources.resource_type` CHECK.
- Migration 0065: SS lessons flexible sections column.

---

## 6. Style conventions — read carefully

### 6a. Fonts
- **Albertus Medium** is Todd's font of choice for all Word docs and PowerPoint
  slides. Set it document-default AND explicitly on every TextRun — the docx
  library's default-run doesn't cover HeadingLevel paragraphs, so belt-and-
  suspenders is required. See `WFUMC SS/src/lib/exportBackPageDocx.js` as the
  reference implementation.
- PowerPoint slide convention: no bullets on content slides, 54pt Albertus
  Medium, left-aligned, em-dash attributions right-aligned.

### 6b. Commit + deploy flow
Todd wants explicit deploy commands he can paste. Standard template:

```powershell
cd "C:\Users\noren\Google Drive\WFUMC <App> App"
git add <specific paths, never git add -A>
git commit -m "<short imperative summary>"
git push
```

For migrations, add a `supabase db push` (or SQL-Editor fallback — see §3a).
For Edge Functions, add `supabase functions deploy <name> --no-verify-jwt`.

### 6c. Never commit changes for Todd
Todd hasn't asked for the assistant to commit or push directly. **We write
code, tell him what to git-add and push, and he runs it.** He'll paste error
output back if something breaks.

### 6d. Parse-check every touched .jsx / .js file
Before wrapping up any change set, run this from the affected app folder:

```bash
node -e "
const parser = require('@babel/parser');
const fs = require('fs');
const files = [ /* list */ ];
for (const f of files) {
  try {
    parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    console.log(f + ': OK');
  } catch (e) {
    console.error(f + ': FAIL — ' + e.message);
    process.exitCode = 1;
  }
}
"
```

Every app has `@babel/parser` in node_modules. **Don't use esbuild** — Todd's
node_modules were installed on Windows and the esbuild binary won't run on
Linux; you'll get a platform-mismatch error.

### 6e. Response formatting
- Todd appreciates brevity in status/completion messages. Long philosophical
  preamble is unwelcome.
- End changes with a clear file list + copy-pasteable deploy commands.
- Use light markdown (headers + short bullets). No emoji unless one is already
  present in the code being touched (📄, 📅, ✨, ▶, ✓, 📋 are all in use).

### 6f. When to ask vs. decide
- **Ask first** for feature design decisions (data model, UX flow, phasing).
- **Decide sensibly** for tactical implementation choices (which file, how to
  structure a helper, which library exports). Note the decision in a comment
  so Todd sees it.
- If a feature spans multiple phases, propose the phases and let Todd approve
  the pace ("start Phase 1 or wait?"). Do not sneak-ship a "just one more small
  thing" into a phase.

---

## 7. Recurring quirks + gotchas

- **`supabase db push` state mismatch** (see §3a). Happens roughly every 5-10
  migrations. Fastest recovery: paste the SQL into Studio SQL Editor.
- **esbuild platform mismatch** (see §6d). Use `@babel/parser` for parse-checks.
- **docx library heading fonts** — `HeadingLevel.HEADING_2` (and other heading
  levels) do NOT inherit `styles.default.document.run.font`. Always set `font`
  explicitly on TextRuns inside heading paragraphs, or the header will render
  in Calibri Light while the body renders in Albertus Medium.
- **The Chrome Extension** — there's a separate scaffold under
  `WFUMC Sermons App/chrome-extension/` for the Sermon Highlight Capture flow.
  Not likely to come up but exists.
- **`worship_plans` is staff-shared, not owner-scoped.** When designing
  features that join to it, remember the join row's own owner_user_id can't
  reflect worship_plans' owner (there isn't one). We handle this by
  denormalizing owner onto the join row (see
  `worship_admin_item_weeks` in migration 0066).
- **Migration timestamps use serial 4-digit prefixes** (`0001_`, `0067_`), NOT
  Supabase's default `YYYYMMDDHHMMSS_`. Keep that convention.
- **Two `sections` concepts collide:** SS lessons use JSONB
  `sections: [{header, body}]`. Sermon liturgies use `sermon_liturgy_sections`
  (relational rows). Don't confuse them.
- **When the user's tab looks like a scroll-back mystery** (e.g. the Supabase
  migration listing shows migrations we didn't expect to be pending): the
  displayed list may be the tail of a longer output. Ask for `supabase
  migration list` before drawing conclusions.

---

## 8. Open / pending items

Nothing critical is unfinished. Two soft items on the backlog:

1. **Migration-history repair** — worth cleaning up so `supabase db push` works
   normally again instead of falling back to SQL-Editor paste each time. Wait
   for Todd to have a spare minute; low priority.
2. **Chrome extension** — scaffolded but not tested end-to-end. Todd hasn't
   asked to revisit.
3. **Old task #299** ("Rename Create all / Skip all to Check all / Uncheck all")
   is pending in TASKS.md. Todd has not asked about it recently — check with
   him if it comes up naturally.

---

## 9. File / directory quick reference

Common files to look at when picking up a new session:

### Shared / Bulletin App hub
- `supabase/migrations/` — all schema.
- `supabase/functions/claude-proxy/index.ts` — Claude routing.
- `supabase/functions/daily-capture-extract/index.ts` — mirror of the Daily
  Capture app's Claude prompt (keep them in sync).
- `src/lib/permissions.js` — role → capability mapping.

### Sermons App
- `src/pages/SermonWorkspace.jsx` — the big writing surface.
- `src/pages/LiturgyDetail.jsx` — liturgy element CRUD.
- `src/lib/worshipElements.js` — canonical element vocabulary.
- `src/components/InsertScriptureSentencePanel.jsx` — has the composite-ref
  parser (`expandRefChunks`).
- `src/lib/exportLiturgyDocx.js`.

### Worship Planning App
- `src/pages/Forecast.jsx` — 12-week WeekCard grid.
- `src/components/WeekCard.jsx` — individual Sunday card.
- `src/pages/AdminItems.jsx` + `src/components/AdminItemsPanel.jsx` — the
  admin-items inbox and per-WeekCard panel.
- `src/lib/adminItems.js` — CRUD + `matchPlansToHint()` hint matcher.

### Daily Capture App
- `src/lib/claude.js` — segmentation prompt (mirrored in Edge Function).
- `src/lib/captures.js` — CRUD + chunked extraction orchestrator.
- `src/lib/destinations.js` — the four downstream writers.
- `src/pages/CaptureReview.jsx` — review card UI.

### Pastoral Records App
- `src/pages/PersonDetail.jsx` — collapsible-section wrapper for everything on
  one person.
- `src/lib/recordImports.js` — clergy record + obituary ingest.
- `src/lib/familyExtraction.js` — infer new family members from anchor.

### SS App
- `src/pages/LessonWorkspace.jsx` — the SS lesson editor (has 📄 Print to Word
  + 📋 Print Back Page).
- `src/lib/exportLessonDocx.js`, `src/lib/exportBackPageDocx.js`.
- `src/lib/lessons.js` — `lessonSectionsOf()` legacy-to-sections helper.

### Lesson Maker App
- `src/pages/LessonWorkspace.jsx` — a similar surface but not identical to
  SS's; the Lesson Maker version has ResourcePicker + ScriptureSuggester + a
  chat-revise loop.
- `src/pages/BulkImport.jsx` — docx/PDF parser + Claude matcher.

---

## 10. If Todd asks something you can't fully answer

- **Sermon manuscripts pre-2015 are patchy** — some are in ENEX exports from
  Evernote, some in DOCX, some scanned. Todd is slowly getting them all
  imported. If he asks about coverage, defer to what `sermons` +
  `sermon_revisions` show.
- **Don't rebuild what already exists.** If Todd asks for a feature that
  sounds familiar, grep the codebase before drafting new code. The 460+
  completed tasks in TASKS.md include a LOT of ground.
- **When in doubt about a schema field**, look at the migration that added it.
  Migrations are the source of truth.

---

## 11. First actions when picking up a new session

1. Read this document (you're doing that).
2. Read Todd's initial message — it will usually name a specific app.
3. `Glob` or `Grep` the relevant app folder to orient.
4. Ask ONE clarifying question if the ask is ambiguous (Todd prefers action
   over meetings-about-meetings).
5. Propose the change set + phasing before starting.
6. Ship, parse-check, deploy commands.

---

Good luck. Todd is a genuinely good person to work for — he pays attention,
gives good feedback, and treats the assistant like a real collaborator. Be
worthy of that.
