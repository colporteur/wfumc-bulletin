# Wedowee First UMC — Electronic Bulletin

A Progressive Web App for the Sunday bulletin at Wedowee First United Methodist Church.

**Status:** Initial scaffold (v0.1). Auth, settings, and bulletin shell working. Section editors arriving in subsequent sessions.

## Quick start (after first-time setup)

```bash
npm install
cp .env.example .env.local
# fill in Supabase URL + anon key in .env.local
npm run dev
```

Open http://localhost:5173.

## First-time setup

See [`docs/SETUP.md`](docs/SETUP.md) for the full walkthrough — creating the Supabase project, running the SQL migration, configuring GitHub Pages, etc.

## Project structure

```
wfumc-bulletin/
├── docs/SETUP.md              ← start here on first run
├── public/                    ← static assets (manifest, robots.txt, icons)
├── src/
│   ├── lib/supabase.js        ← Supabase client
│   ├── contexts/AuthContext   ← staff auth state
│   ├── components/            ← shared UI
│   └── pages/
│       ├── Home.jsx           ← worshipper view
│       └── admin/             ← staff admin pages
├── supabase/
│   ├── migrations/0001_*.sql  ← run this in the Supabase SQL editor
│   └── functions/claude-proxy ← Edge Function for Claude API calls
└── .github/workflows/deploy.yml
```

## Tech stack

- React 18 + Vite + Tailwind CSS
- React Router v6
- Supabase (Postgres + Auth + Storage + Edge Functions)
- Vite PWA plugin
- Deployed via GitHub Pages
