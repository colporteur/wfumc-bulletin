# WFUMC App Suite — Handoff Summary

For Pastor Todd Noren-Hentz at Wedowee First United Methodist Church.

This is a handoff doc for picking up the WFUMC project in a fresh Cowork thread. It covers what exists, where everything lives, the shared infrastructure, and what was most recently being worked on.

---

## The seven apps

All apps are React 18 + Vite + Tailwind PWAs deployed to GitHub Pages. They share a single Supabase project (Postgres + Auth + Storage + Edge Functions) and a single Anthropic API key (proxied through one Edge Function).

| # | App | Folder | Domain |
|---|-----|--------|--------|
| 1 | Bulletin App | `WFUMC Bulletin App` | Worship-bulletin builder + worshipper-facing display, prayer requests, check-ins, response prompts |
| 2 | Sermon App | `WFUMC Sermons App` | Sermon archive, manuscript workspace (chat-revise loop with Claude), resources library, liturgies library, slide-deck builder |
| 3 | Social App | `WFUMC Social App` | Social media post drafting from bulletin highlights, response-prompt submissions, announcements/events |
| 4 | Worship Planning App | `WFUMC Worship Planning App` | 12-week forecast, season themes, week groupings, worship elements, intelligence panel surfacing matching sermons/resources |
| 5 | Pastoral Records App | `WFUMC Pastoral Records App` | Parishioner database, family links, interactions, transcripts (Plaud-fed), core issues, end-of-life (eulogy drafting), clergy-record imports |
| 6 | Daily Capture App | `WFUMC Daily Capture App` | Voice memo capture → Plaud → Zapier webhook → Supabase → Claude extraction → typed segments (tasks, sermon ideas, prayer requests, etc.) |
| 7 | Lesson Maker App | `WFUMC Lesson Maker App` | Bible study / Sunday school lesson drafting with chat-revise workspace, group + queue management, bulk-import from .docx/.pdf |

---

## Working folders (mount these in the new Cowork session)

```
/sessions/happy-hopeful-pascal/mnt/WFUMC Bulletin App
/sessions/happy-hopeful-pascal/mnt/WFUMC Sermons App
/sessions/happy-hopeful-pascal/mnt/WFUMC Social App
/sessions/happy-hopeful-pascal/mnt/WFUMC Worship Planning App
/sessions/happy-hopeful-pascal/mnt/WFUMC Pastoral Records App
/sessions/happy-hopeful-pascal/mnt/WFUMC Daily Capture App
/sessions/happy-hopeful-pascal/mnt/WFUMC Lesson Maker App
```

The Bulletin App folder is the "central" one — all Supabase migrations, Edge Functions, and Babel-parser used for parse-checks live there.

---

## Shared infrastructure

**Supabase project:** ref `datkqtnredzlwttlxuie`. All apps connect to the same Postgres DB and use the same `auth.users` table. Row-level security scopes most tables to `owner_user_id = auth.uid()`.

**All migrations live at:** `WFUMC Bulletin App/supabase/migrations/*.sql`. Latest is `0061_resources_exegesis_type.sql`. New migrations should follow the numbered naming convention and be applied via `supabase db push` from the Bulletin App folder.

**All Edge Functions live at:** `WFUMC Bulletin App/supabase/functions/`. Key ones:
- `claude-proxy` — Anthropic API proxy (every app calls this; never hard-code Anthropic keys in the client)
- `url-fetch` — server-side page fetcher for the Resource Extract URL mode
- `plaud-webhook` — Zapier endpoint that ingests Plaud transcripts into Daily Capture
- `daily-capture-extract` — server-side mirror of the chunked Claude extraction (fired by the webhook via `EdgeRuntime.waitUntil`)

Deploy functions via `supabase functions deploy <name>` from the Bulletin App folder.

**Anthropic key:** held server-side in `claude-proxy`'s env. Never exposed to clients.

**Plaud webhook secret:** held server-side, checked via `X-Webhook-Secret` header. Setup guide is at `WFUMC Bulletin App/PLAUD_ZAPIER_SETUP.md`.

---

## Tech stack (consistent across all apps)

- React 18 + Vite
- Tailwind CSS (custom `umc-*` color palette)
- React Router v6
- Supabase JS client (Auth via email/password)
- Vite-PWA (workbox precaching; Daily Capture uses injectManifest for Web Share Target)
- `docx` library for Word output
- `mammoth` for Word reading
- `pdfjs-dist` 4.7.76 (lazy-loaded) for PDF parsing
- `papaparse`, `xlsx` (SheetJS) for spreadsheet I/O where needed
- Anthropic Claude API via `claude-proxy` Edge Function

Each app has its own `package.json`, `.github/workflows/deploy.yml`, and PWA manifest. All deploy automatically on push to `main` via GitHub Actions → GitHub Pages.

---

## Repo locations on user's machine

The repos are git-managed; each app folder is its own repo with its own `main` branch. The user pushes to GitHub manually with normal `git add / commit / push` from inside each app folder.

To push a change in app X: `cd "WFUMC X App" && git add <files> && git commit -m "…" && git push`

---

## How Claude calls work in the codebase

Every app has a `src/lib/claude.js` with helper functions that wrap `callClaude({ system, messages, max_tokens, ... })`, which POSTs to the shared `claude-proxy` Edge Function. Responses come back as Anthropic's standard format; helpers parse them (often as JSON arrays via `parseJsonArrayLoose` / `parseJsonArrayRobust`).

When adding a new Claude helper:
1. Define a system prompt + user message in `src/lib/claude.js`
2. Call `callClaude` with sensible `max_tokens` (4096 for typical extraction, 16384 for slides/diff)
3. Parse the response — for JSON output, use `parseJsonArrayRobust` since Claude sometimes truncates
4. Return a typed object the UI can render

---

## Parse-check pattern (the standard "did I break anything" smoke test)

```bash
node -e "
const p = require('/sessions/happy-hopeful-pascal/mnt/WFUMC Bulletin App/node_modules/@babel/parser');
const fs = require('fs');
for (const f of [
  '/path/to/file1.jsx',
  '/path/to/file2.js',
]) {
  try {
    p.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    console.log('OK', f.split('/').slice(-2).join('/'));
  } catch (e) { console.log('FAIL', f, e.message); }
}
"
```

Always run this after editing .jsx/.js files. The Bulletin App's `node_modules/@babel/parser` is the canonical install used by all apps for verification.

---

## Recent work (June 2026)

**Most recent thread of work was on the Sermon App's resource extraction + workspace layout.**

### Just-shipped changes (unpushed at handoff time)

These are local-only edits the user still needs to commit + push:

1. **`WFUMC Sermons App/src/components/WorkspaceExtractResources.jsx`** — Manuscript-relevance filter improvements:
   - Builds context from `sermon.scripture_reference + sermon.title + manuscript body`
   - Checkbox disabled only when there's NO usable signal at all
   - Inline label shows what's being filtered on, e.g. `(Matthew 9:9-13 + body)`
   - On empty result with filter on, shows a **"Retry without filter"** button for instant A/B test

2. **`WFUMC Sermons App/src/lib/claude.js`** — Loosened the relevance-filter prompt in `extractResourcesFromSource`:
   - Dropped over-strict "SKIP it" language
   - Added explicit instruction: commentaries on the sermon's scripture passage SHOULD be included
   - "When in doubt, include rather than skip"

3. **`WFUMC Sermons App/src/components/Layout.jsx`** + **`src/pages/SermonWorkspace.jsx`** — Full-width workspace layout:
   - Layout switches to `max-w-screen-2xl` for `/workspace` routes only (other pages stay narrow)
   - Workspace grid changed from `lg:grid-cols-2` (50/50) to `lg:grid-cols-5` with chat=2 cols, manuscript=3 cols
   - Manuscript textarea bumped to `text-base` at `lg:` breakpoint
   - Page-level `max-w-7xl` cap removed

User push command (Sermons App folder):
```
git add src/components/WorkspaceExtractResources.jsx src/components/Layout.jsx src/lib/claude.js src/pages/SermonWorkspace.jsx
git commit -m "Workspace: full-width + better relevance filter"
git push
```

### Earlier in this thread (now shipped)

- **Synoptic-parallels expansion** for Resources scripture search (Aland data, 117 pericopes) with a "Match Synoptic Parallels" checkbox on `/resources`
- **Verse-level scripture overlap** parser fix for comma-separated ranges like "Matthew 9:9-13, 18-26"
- **PDF page-range** support in Resource Extract (page calibration preview pane shows "PDF page 4: …" labels)
- **'Exegesis'** added as new resource type (migration 0061)
- **WorkspaceExtractResources modal** — extract-from-source UX inside the sermon workspace with per-row "attach to sermon vs archive only" toggle
- **Plaud → Zapier → Supabase pipeline** for Daily Capture (migrations 0060 + plaud-webhook + daily-capture-extract Edge Functions). Verified end-to-end with capture_id `2849f3a5-…`
- **Lesson Maker phases A through F+** — complete app from migration through bulk-import-from-PDF
- **Print-prefs / pastor liturgy export** in Sermon App (docx with proper Word page-number field tokens)
- **Sermon Workspace** — chat-revise loop, paragraph numbering, slide-deck builder with bidirectional manuscript marker sync, Albertus Medium font output, Word + PowerPoint export
- **Pastoral Records** phases A through F — including clergy-record/obituary import with Claude vision, family extraction, document sharing, derived-anniversaries display
- **Daily Capture chunked extraction** for long transcripts

---

## Pending tasks at handoff

There's exactly one un-actioned task from way back:

- **#299** — Rename "Create all / Skip all" to "Check all / Uncheck all" in the manuscript-extract candidates UI on Sermon Detail. Low priority.

All other tasks (#1 through #415) are completed.

---

## Things worth knowing about the user

- **Pastor Todd Noren-Hentz** preaches RCL (Revised Common Lectionary). Claude helpers prefer RCL passages when suggesting.
- He uses a **Plaud** voice recorder + **Zapier** to pipe transcripts into the Daily Capture App
- He prefers **prose answers, not bullet lists**, unless a list is genuinely the right format
- His preferred PowerPoint font is **Albertus Medium**, 54pt, no bullets, left-aligned with em-dash attributions right-aligned
- He's on **PowerShell 5.1** (not 7), so commands need to account for older PS syntax — e.g. `RandomNumberGenerator::GetBytes` requires `New-Object byte[]` first
- He's the only "pastor" role; there are also `staff`, `social_media`, `worship_team` roles with section-level permissions enforced in `lib/permissions.js`
- He has **two preaching locations**: Wedowee FUMC (main) and historically Grace + Epworth (imported from a master XLSX)

---

## File-handling conventions

- **Outputs the user should see** go in their mounted folders (e.g. `WFUMC Bulletin App/`), not in `/sessions/...` scratch space
- When referencing files to the user, call them by folder name ("the Sermons App folder") — never expose `/sessions/...` paths
- When sharing files, use `computer://` URLs in the response so the user can click to open them

---

## Quick-start for a new session

1. Mount all seven WFUMC folders in Cowork
2. Read this file first
3. If the user asks about anything app-specific, the source of truth is the actual code in that app's folder
4. For new features that touch the database, add a migration in `WFUMC Bulletin App/supabase/migrations/` (next number is `0062_`)
5. Always parse-check edited .jsx/.js files before declaring "done" (script above)
6. Don't create commits unless the user explicitly asks
