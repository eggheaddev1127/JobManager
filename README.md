# Job Manager (MVP)

A small web app to manage profiles, running jobs (with monthly income), and interview pipelines.

## Stack

- **Backend:** Node + Express + better-sqlite3 (SQLite file at `server/data/job-manager.db`)
- **Frontend:** Vite + React + TypeScript + Tailwind
- **Persistence:** local SQLite file, auto-created and seeded on first run

## Setup

Requires **Node.js 18+** (recommend 20 LTS).

From `d:/Projects/job-manager`:

```powershell
npm run install:all
```

That installs root, `server/`, and `client/` deps.

> If `better-sqlite3` fails to build on Windows, install the windows-build-tools or make sure you have a recent VS Build Tools / Python. On Node 20+ a prebuilt binary is usually available.

## Run (dev)

```powershell
npm run dev
```

This starts:
- API at `http://localhost:4000`
- Web app at `http://localhost:5173` (proxies `/api/*` to the API)

Open http://localhost:5173 in your browser. The app boots into the Running Jobs page.

## Run (Docker)

Requires Docker (Docker Desktop on macOS/Windows). From the repo root:

```bash
docker compose up --build        # build images and run in the foreground
docker compose up -d --build     # ... or detached (background)
docker compose down              # stop and remove the containers
docker compose logs -f           # follow logs
```

This starts two containers:
- `jobmanager-server` — the Express API (run via `tsx`), internal port 4000
- `jobmanager-web` — the built React app served by nginx, published on
  `http://localhost:5173`, reverse-proxying `/api/*` to the server

The SQLite database is persisted to `server/data/` on the host (a bind mount),
so data survives `docker compose down`. Set a real `SESSION_SECRET` in a `.env`
file (see `.env.example`) before exposing this publicly.

## Features

### 1. Profiles
- Columns: No., Name, Gmail, LinkedIn URL, Full Address, GV (Google Voice), GitHub, Race, GV 2
- Full CRUD: add, edit, delete profiles

### 2. Running Jobs
- Columns: Profile, Company, Role, Source (LinkedIn / Job Apply / Agency / Referral / Direct / Other), Salary/mo, Caller payout, Dev payout, Net, Status (active / paused / ended)
- Top summary cards: active job count, monthly income, total caller payout, total dev payout, monthly net
- Status filter pills

### 3. Interviews
- Columns: Date, Slot, Profile, Company, Step, Progress, Pipeline status, Meeting / JD / Recording links, Notes
- Stats: total, passed, failed, waiting, not started, pipelines, live pipelines
- **Pipeline filter:** "Only **passed** in **live pipelines**"
  - A *pipeline* = `(Profile, Company)`
  - A pipeline goes *failed* the moment any row in it has Progress = "Failed"
  - When the filter is on: shows only rows with Progress = "Passed" that belong to pipelines that have **not** failed
  - So if you passed Intro + HM at Company X then failed Tech at Company X, none of those Company X rows show up
- Additional filters: by profile, free-text search across company / profile / step / notes

## Project layout

```
job-manager/
├── package.json            # root scripts (concurrently)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/               # SQLite db lives here (gitignored)
│   └── src/
│       ├── index.ts        # Express bootstrap
│       ├── db.ts           # SQLite + schema
│       ├── seed.ts         # initial sample data (your interview rows)
│       └── routes/
│           ├── profiles.ts
│           ├── jobs.ts
│           └── interviews.ts
└── client/
    ├── package.json
    ├── vite.config.ts      # /api proxy to :4000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts
        ├── types.ts
        ├── index.css
        └── pages/
            ├── ProfilesPage.tsx
            ├── JobsPage.tsx
            └── InterviewsPage.tsx
```

## Resetting the database

Delete `server/data/job-manager.db` (and any `-wal` / `-shm` files) and restart the server — schema + seed will recreate from scratch.

## Notes / next steps

- The `Per4mer` seed job for Chris Schwab is a guess based on the interview note "Weekly updates". Tweak its salary / payouts on the Running Jobs page.
- Profile fields like Gmail / LinkedIn URL / address / GV / GitHub / Race for the three seed profiles are blank — fill them in on the Profiles page.
- All data is local to your machine in the SQLite file. To share or back up, copy `server/data/job-manager.db`.
