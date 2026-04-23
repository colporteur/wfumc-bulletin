# Setup Guide — for Pastor Todd

This walks through the one-time setup. Most of it is clicking through web UIs to create accounts/projects, with a few terminal commands. Should take about 30–45 minutes the first time.

## What you'll need

- A computer with **Node.js 18+** installed (check with `node -v`). Node 20 LTS is preferred but 18.x works.
- A **GitHub** account (you have one from Fiesta Collector)
- A free **Supabase** account ([supabase.com](https://supabase.com))
- An **Anthropic** API key for the Claude-assist features (can be added later in Settings)

---

## Step 1 — Create the GitHub repository

1. Go to https://github.com/new
2. Repository name: `wfumc-bulletin` (or any name you like — remember it)
3. Set it **Public**. (GitHub Pages requires a public repo on free accounts. The repo only contains source code — no secrets, no church data — so this is safe. Real secrets live in Supabase and in GitHub Actions Secrets, not in the code.)
4. Don't initialize with a README (we have one).
5. Click **Create repository**.

Don't push anything yet — we'll do that after Step 3.

---

## Step 2 — Create the Supabase project

1. Go to https://supabase.com and sign in.
2. Click **New project**.
3. Name: `wfumc-bulletin`
4. Generate a strong database password — **save it somewhere safe**.
5. Region: choose the US region closest to Alabama (`East US (Ohio)` is a good default).
6. Plan: **Free** tier is fine for now.
7. Click **Create new project**. Wait ~2 minutes for it to provision.

When it's ready, grab two values from **Project Settings → API**:

- **Project URL** (looks like `https://xxxxx.supabase.co`)
- **`anon` public API key** (a long JWT-looking string)

Keep these handy — you'll paste them into `.env.local` in Step 4.

---

## Step 3 — Run the database migration

1. In the Supabase dashboard, open the **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open the file `supabase/migrations/0001_initial_schema.sql` from this project, copy the entire contents, paste into the Supabase SQL editor.
4. Click **Run**.

You should see "Success. No rows returned." This creates all the tables, indexes, and Row Level Security policies for the bulletin app.

---

## Step 4 — Local development

Open a terminal in this project folder and run:

```bash
npm install
cp .env.example .env.local
```

Then open `.env.local` in a text editor and fill in:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

(Use the values from Step 2.)

Then:

```bash
npm run dev
```

Open http://localhost:5173 — you should see the worshipper home page.

To check the admin login, go to http://localhost:5173/admin/login.

---

## Step 5 — Create your first staff user

You need at least one staff account to log in. The easiest way:

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
2. Email: your email address. Password: choose one.
3. Toggle **Auto-confirm user** so you don't need email verification.
4. Click **Create user**.

Now go back to http://localhost:5173/admin/login and log in with that email + password. You should land on the admin dashboard.

To grant yourself the `pastor` role (full access including Settings and API key):

1. Back in Supabase, go to **SQL Editor → New query**.
2. Run:
   ```sql
   INSERT INTO staff_profiles (user_id, full_name, role)
   VALUES (
     (SELECT id FROM auth.users WHERE email = 'your.email@example.com'),
     'Todd Noren-Hentz',
     'pastor'
   );
   ```
   (Replace the email with the one you just created.)

Reload the admin page; you should now see the Settings link.

---

## Step 6 — Deploy to GitHub Pages

1. Push the project to GitHub:

   ```bash
   git init
   git add .
   git commit -m "Initial scaffold"
   git branch -M main
   git remote add origin https://github.com/<your-username>/wfumc-bulletin.git
   git push -u origin main
   ```

2. In the GitHub repo, go to **Settings → Pages**.
3. Under **Source**, select **GitHub Actions**.
4. The deploy workflow (`.github/workflows/deploy.yml`) will run automatically on every push to `main` and publish to `https://<your-username>.github.io/wfumc-bulletin/`.

5. Add the Supabase secrets to GitHub so the build can use them:
   - In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Add `VITE_SUPABASE_URL` with your Supabase project URL.
   - Add `VITE_SUPABASE_ANON_KEY` with your anon key.

6. Push any change (or re-run the workflow from the **Actions** tab) to trigger a deploy.

---

## Step 7 — Deploy the Claude proxy Edge Function (optional, for AI assist)

Skip this until you actually want to use the Claude-assist features.

```bash
# Install the Supabase CLI if you don't have it
npm install -g supabase

# Login
supabase login

# Link to your project (project ref is in the Supabase dashboard URL)
supabase link --project-ref <your-project-ref>

# Deploy the function
supabase functions deploy claude-proxy
```

Then in the app's Settings page, paste your Anthropic API key. It's stored encrypted server-side.

---

## What works in the v0.1 scaffold

- ✅ Worshipper home page (placeholder content)
- ✅ Admin login + protected routes
- ✅ Admin dashboard
- ✅ Settings page (church profile, license numbers, API key)
- ✅ Bulletin list (create/list)
- ✅ PWA manifest + installable on iPhone/Android
- ✅ noindex / robots.txt to discourage search indexing
- ✅ GitHub Pages auto-deploy

## What's coming next

Per the [build plan](../wfumc-bulletin-spec.md#17-build-plan-proposed-sequence), next sessions will add:

- Bulletin section editors (cover, prayer requests, calendar, etc.)
- Liturgy editor (the centerpiece) with drag-reorder, expand-on-tap, hymn auto-fill via Claude
- Worshipper-facing bulletin view
- Check-in flow
- Print stylesheet + QR code

---

## Troubleshooting

**`npm install` fails** — make sure you have Node 18+ (`node -v`). If you have an older version, install from https://nodejs.org. Node 20 LTS is the safest choice.

**Login spins forever** — check that the Supabase URL and anon key in `.env.local` are correct, and that you ran the SQL migration in Step 3.

**Admin pages 404 after deploy** — GitHub Pages needs the `404.html` redirect trick for SPA routing. It's included in `public/` and should work automatically. If it doesn't, double-check that `vite.config.js` has the right `base` for your repo name.

**Settings page doesn't show** — you need to run the SQL in Step 5 to give your user the `pastor` role.
