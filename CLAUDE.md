# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Development (Express + Vite middleware on a single port, default 3000)
npm run dev

# Production build (Vite → dist/)
npm run build

# Type-check (lint)
npm run lint
```

The `dev` script is `tsx server.ts` — **no watch mode**. Backend changes (anything in `server.ts`) require a manual restart. Frontend changes hot-reload via Vite.

## Environment Variables

`.env` keys read at runtime:

```
DATABASE_URL=postgresql://...           # Neon/Postgres connection (SSL auto-enabled for non-localhost)
JWT_SECRET=...                          # required — server throws on boot if missing
ZHIPU_API_KEY=...                       # Z.AI key (format: {32hex}.{16alphanum})
API_KEY_N8N=...                         # x-api-key header for ingest/compute routes
N8N_BASE_URL=https://...                # n8n instance, used by /api/n8n/trigger/:workflowName
N8N_RESET_WEBHOOK_URL=...               # specific webhook for /api/opportunities/reset
```

The frontend never receives any AI key — all LLM calls go through backend routes. Do not re-introduce `define: { 'process.env.X' }` in `vite.config.ts` for secrets.

## Architecture

SEO Business Intelligence SaaS. Single-process Node app (Express + Vite middleware) with a Postgres backend and an alternative Python pipeline.

- **`server.ts`** — Single Express entry point. In dev, embeds Vite as middleware on the same port. In production, serves built `dist/`. **All API routes live here.** Schema is auto-created by `initDb()` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
- **`src/`** — React + TypeScript SPA (Vite + Tailwind CSS v4). Pages under `src/pages/` rendered inside an authenticated `Layout`. Auth state lives in `App.tsx`, restored from `localStorage` on load.
- **`main.py`** — Python/SQLAlchemy parallel pipeline (offline use). **Not the running server.** Same DB schema. Mirrors the NLP qualify and clustering logic if you need to run them outside the Node server.
- **PostgreSQL** — `server.ts` uses raw SQL via `pg` Pool. `main.py` uses SQLAlchemy ORM.

### Data Flow

External data arrives via **n8n** workflows (auth: `x-api-key` header):
1. n8n → `POST /api/ingest/gsc`  — daily GSC rows
2. n8n → `POST /api/ingest/serp` — SERP scrape rows (volume, competition, PAA, AI overview)
3. n8n → `POST /api/compute/kpis` — recomputes `scores_daily` for the project

The frontend can re-trigger workflows through `POST /api/n8n/trigger/:workflowName`. The backend uses `/webhook/` (not `/webhook-test/`) — the workflow must be ACTIVE in n8n.

### KPI Computation (PDF-aligned, GSC-first)

All KPIs in `scores_daily` are computable from GSC alone; SERP enriches optionally. Formulas follow `Referentiel_KPIs_SEO_GSC.pdf`:

- **`opportunity_score`** = `impressions × max(0, 0.11 − ctr_actuel)` → absolute click gain potential. **Not normalized 0-1.** A score of 200 means "+200 clicks/month potential."
- **`quick_win_score`** = `impressions × (1/position) × (16 − position)` for positions 5–15, else 0
- **`priority_score`** = `log10(impressions) × max(0, 0.11 − ctr) × proximity_factor` where proximity = 1 if pos≤15, 0.3 if pos≤30, 0 otherwise
- **`ctr_gap`** = `observed_ctr − expected_ctr` (negative = snippet underperforming). Expected CTR table is AWR/Sistrix: P1=0.28, P2=0.15, P3=0.11, P4=0.08, P5=0.07, P6=0.05, P7=0.04, P8-10=0.03
- **`performance_drift`** = position change over a 28-day window comparing weighted avg position (`Σ(pos × imp) / Σ(imp)`) of recent vs prior 28 days. Positive = worsening.
- **`competition_score`** = estimated from GSC position, enriched with SERP competition/PAA/AI overview signals when available

Dashboard aggregate metrics use **weighted** formulas, not arithmetic means:
- `avg_ctr` = `SUM(clicks) / SUM(impressions)`  (not `AVG(ctr)`)
- `avg_position` = `SUM(position × impressions) / SUM(impressions)`

Alert thresholds in `/api/dashboard`: `performance_drift >= 5` → strong drop, `>= 2` → to watch, `opportunity_score >= 200` → opportunity.

### NLP Keyword Classification Pipeline

`POST /api/nlp/qualify` runs a two-stage pipeline (results upserted into `nlp_keyword_enrichment`):
1. **Local rule-based** classification (instant, always runs) — transactional/navigational/informational signals + branded matching against `projects.branded_keywords`
2. **Z.AI LLM** enrichment — only for keywords classified as `confidence: "low"` in step 1

The LLM-only frontend buttons (Dashboard interpretation, Seasonal suggestions) call backend routes — see *AI provider* below.

### AI provider — Z.AI (OpenAI-compatible)

The codebase **does not use Google Gemini.** All LLM calls go through the OpenAI SDK pointed at Z.AI:

```ts
const zhipu = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY,
  baseURL: "https://api.z.ai/api/paas/v4/",
});
// model: "glm-5.1"
```

All AI is backend-proxied (no API key in the browser). Routes:
- `POST /api/nlp/qualify` — keyword classification (used by Opportunities qualify modal)
- `POST /api/projects/:id/cluster` — semantic clusters (Dashboard)
- `GET  /api/projects/:id/action-plan` — 5-point action plan (Dashboard)
- `POST /api/ai/dashboard-interpretation` — French SEO analysis paragraph (Dashboard)
- `POST /api/ai/seasonal-suggestions` — calendar-aware SEO opportunities

`src/services/geminiService.ts` is a misnomer kept for compatibility — it now only forwards to backend routes. The file name does not imply Gemini is in use.

JSON-shaped responses use `response_format: { type: "json_object" }`. Z.AI returns 429 *Insufficient balance* when the account has no credits — that error means "fund the Z.AI account," not "code is broken."

### Authentication

- **User routes**: JWT via `Authorization: Bearer <token>`. `authenticate` middleware attaches `req.user.id`.
- **Ingest/compute routes**: `x-api-key` header. `checkApiKey` middleware compares against `API_KEY_N8N`.
- Default seeded user: `admin@example.com` / `password123` (created on `initDb()` if missing).
- Frontend stores token in `localStorage`; `App.tsx` restores it on mount.

### Tracking flow (Opportunities → Suivi)

`keywords.is_tracked` is a boolean column toggled by user action:
- `POST /api/keywords/:id/track` — set TRUE (called from Opportunities "Suivre" button)
- `POST /api/keywords/:id/untrack` — set FALSE
- `GET /api/keywords/tracked` — joins fresh `gsc_daily` + `scores_daily` + `nlp_keyword_enrichment` to return current values, not the (often stale) base columns on `keywords`. The Tracking page reads this.

### Database Tables

| Table | Purpose |
|---|---|
| `users` | Auth |
| `projects` | SEO projects (one user → many projects). Stores `branded_keywords` for NLP. |
| `keywords` | Master keyword list. Holds `is_tracked` flag. Position/CTR/etc. on this table are stale snapshots — prefer joins onto `gsc_daily`/`scores_daily` for current values. |
| `gsc_daily` | Google Search Console data (keyword, page, date) |
| `serp_daily` | SERP scrape data (position, volume, CPC, PAA, AI overview) |
| `scores_daily` | Computed KPIs per keyword/date — read this for current opportunity/quick-win/priority scores |
| `nlp_keyword_enrichment` | NLP classification results (intent, branded_status, action_hint, etc.) |
| `keyword_clusters` | Z.AI-generated semantic clusters |
| `events` | Content calendar events |

### Frontend Pages

Pages under `src/pages/` rendered inside `Layout`:
- **Hub** (`/`) — landing hub
- **Dashboard** (`/dashboard`) — KPI cards (weighted CTR/position), traffic chart, branded pie, AI interpretation, action plan, semantic clusters, alerts
- **Opportunities** (`/opportunities`) — keyword opportunities sorted by `opportunity_score`. Columns: Position, Impressions, CTR Gap, Intention, Marque, Gain potentiel (clicks). Scatter X=Position (reversed), Y=opportunity score, bubble=impressions. "Suivre" button toggles `is_tracked`.
- **Tracking** (`/tracking`) — only `is_tracked = TRUE` keywords. Shows fresh GSC/scores data + 7-day position evolution.
- **Calendar** (`/calendar`) — content planning
- **Projects** (`/projects`) — project CRUD
- **Settings** (`/settings`) — branded keywords, alerts, profile

### Debug Endpoint

`GET /api/debug/data-check?projectId=<id>&date=<YYYY-MM-DD>` — returns table counts, join match rates between `gsc_daily`/`serp_daily`/`scores_daily`, and a diagnosis list. First stop when keywords show but KPIs don't.
