# Build status — WFUMC Bulletin

_Last updated: 2026-04-22_

This doc captures where the build stands so you can pick up cleanly when you're back.

---

## What's done (the scaffold)

Everything below is committed in this folder. Nothing has been installed or deployed yet — that's your next step.

**Front end (React + Vite + Tailwind PWA)**
- `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html` with `noindex` meta + GitHub Pages SPA redirect decoder
- `public/404.html` (SPA redirect encoder), `public/robots.txt` (Disallow all), `public/icons/README.md` (placeholder for the PWA icons you'll generate)
- `src/main.jsx`, `src/App.jsx`, `src/index.css` (Tailwind + UMC color palette)
- Auth: `src/contexts/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`
- Layouts: `src/components/WorshipperLayout.jsx`, `src/components/AdminLayout.jsx`, `src/components/LoadingSpinner.jsx`
- Worshipper pages: `Home.jsx` (placeholder), `InstallHelp.jsx`, `NotFound.jsx`
- Admin pages: `Login.jsx`, `Dashboard.jsx`, `Settings.jsx` (full field-driven form), `BulletinList.jsx` (full), `BulletinEdit.jsx` (stub with publish/archive working — section editors are the next build phase)
- `src/lib/supabase.js` exports both the Supabase client and a `callClaude(body)` helper that calls the Edge Function

**Back end (Supabase)**
- `supabase/migrations/0001_initial_schema.sql` — every table, every RLS policy, default seed data (prayer categories, stewardship funds, attendance categories, leading-worship roles incl. Kathy, Karen, Steve, you), the `church_settings_public` view that exposes everything _except_ the Anthropic API key to anonymous visitors. **Bug found and fixed today**: the `is_staff()` / `is_pastor()` helper functions were defined before the `staff_profiles` table they reference. Since `language sql` functions are validated at CREATE time, the migration would have failed on first run. Now reordered so the table comes first, then the helpers, then the policies that use them.
- `supabase/functions/claude-proxy/index.ts` — Deno Edge Function that validates the user's JWT, confirms they have a staff profile, then forwards to `api.anthropic.com/v1/messages` using your stored API key. Default model is `claude-sonnet-4-6`.

**Deploy**
- `.github/workflows/deploy.yml` — auto-deploys to GitHub Pages on push to `main`. Sets `VITE_BASE_PATH` from the repo name automatically. Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repo secrets.

**Setup docs**
- `README.md` — top-level overview
- `docs/SETUP.md` — step-by-step (Supabase project, run migration, deploy edge function, create your staff profile, set GitHub secrets, push to deploy)
- `wfumc-bulletin-spec.md` — full v0.2 spec (this is your source of truth for what's scoped)

---

## What to do when you're back (in order)

1. **Read `docs/SETUP.md`** end-to-end before clicking anything. It walks you through:
   - Creating the Supabase project
   - Pasting `0001_initial_schema.sql` into the SQL editor and running it
   - Deploying the `claude-proxy` Edge Function
   - Inserting your own row in `staff_profiles` with `role = 'pastor'`
   - Putting your Anthropic API key into `church_settings.anthropic_api_key`
2. **Run locally first** — `npm install`, copy `.env.example` to `.env.local`, fill in the two `VITE_SUPABASE_*` values, then `npm run dev`. Confirm `/admin/login` works with the user you created.
3. **Push to GitHub** — create the repo, set the two secrets in `Settings → Secrets and variables → Actions`, push to `main`. Watch the Action deploy. The site will be at `https://<your-user>.github.io/<repo-name>/`.
4. **Generate PWA icons** — replace `public/icons/README.md` with `icon-192.png`, `icon-512.png`, and a maskable variant. Easiest is [maskable.app](https://maskable.app) or any favicon generator.
5. **Test "Add to Home Screen"** on your iPhone — that's the install path for worshippers. Capture a screenshot for `InstallHelp.jsx` later.
6. **Tell me to pick up** — the next build phase is the section editors inside `BulletinEdit.jsx` (currently shows placeholder cards for Cover, Welcome/Calendar, Prayer Requests, Order of Worship, Stewardship, Community, Announcements & Other). Each one becomes a sub-route or modal with its own form. The data model is fully in place — this is pure UI work.

---

## What's deferred (not in the scaffold yet)

These are in the spec but not yet built — flagged here so we don't lose them:

- Section editors (the seven cards in `BulletinEdit.jsx`)
- Worshipper-facing bulletin paging UI (`/b/:date` route)
- Prayer-request submission form on the worshipper side
- Check-in form
- QR code generator
- Print stylesheet
- Watch Live button (Sunday-only logic)
- Sermon manuscript upload (UI; the DB columns exist)
- Google Calendar import

---

## Known gotchas

- **Sandbox couldn't run `npm install`** during this build (no registry access from here). That's fine — you'll run it on your laptop. Nothing is broken; the dependency list is just unverified locally until you do.
- **PWA icons are placeholders.** The `vite-plugin-pwa` build will warn about missing files until you generate them. The site still works; just the install icon will look generic.
- **The migration is idempotent only on a fresh database.** If you run it twice, the `insert into church_settings (id) values (1)` and the seed inserts will fail on the second run. For now, only run it once on a fresh Supabase project.
