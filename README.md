# micasa-web

A self-hostable web UI for [`micasa`](https://github.com/cpcloud/micasa), the terminal home-maintenance tracker. Point it at an existing `micasa` SQLite database and get a browsable, **editable** web app for your house: projects, quotes, maintenance schedules, incidents, appliances, vendors, and documents.

> micasa-web is a faithful window onto `micasa`. It reads and writes the same SQLite database using the exact same data model and semantics (soft-deletes, deletion records, delete guards, `*_cents` money, incident resolve = date_resolved + soft-delete). It never invents fields or diverges from `micasa` behavior.

## Features

- **All entities**: House profile, Projects (kanban), Quotes, Maintenance, Incidents, Appliances, Vendors, Documents.
- **Programs + budget tracker** (web-only): group existing `micasa` projects into a larger effort (e.g. an office reno made of tile, paint, window treatments) and roll up budget / quotes / actuals. Does **not** change the `micasa` schema — programs live in a separate sqlite DB.
- **Full CRUD** with `micasa`-exact rules: soft-delete + `deletion_records`, delete guards (e.g. cant delete a vendor with active quotes/incidents), auto-backup of the DB before every write.
- **Overdue maintenance** notifications: a header bell + count badge opens a drawer of overdue items.
- **Light / dark themes**, responsive (mobile hamburger nav, desktop tab bar).
- **Optional Home OpEx module** (off by default): pulls home-operating spend from a personal-finance source into a burn-rate dashboard (Sankey + trend). Fully separate from `micasa` data. See `docs/opex.md`.

## Stack

- **Backend**: FastAPI + uvicorn. Reads are opened strictly read-only (`mode=ro` + `PRAGMA query_only`); only mutations open a writable connection, and every mutation is preceded by an auto-backup.
- **Frontend**: React + Vite + Tailwind, served same-origin by the backend.
- **Deploy**: Docker + docker-compose.

## Quick start

```bash
git clone https://github.com/adsail/micasa-web.git
cd micasa-web

# point it at your micasa DB directory (must contain micasa.db)
export MICASA_DATA_DIR=/path/to/your/micasa

docker compose up -d --build
```

Then open http://localhost:8282.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `MICASA_DATA_DIR` | `/home/pi/micasa` | Host dir bind-mounted to `/data`; must contain `micasa.db`. Backups are written to `<dir>/backups`. |
| `PORT` | `8282` | Host port. |
| `OPEX_ENABLED` | `false` | Enables the optional Home OpEx tab + `/api/opex/*`. When off, `/api/opex/*` return **404** and the tab is hidden; `/api/health` reports `opex_enabled` so the frontend knows whether to show it. |
| `PROGRAMS_ENABLED` | `true` | Enables the Programs tab + `/api/programs/*`. Defaults on when `PROGRAMS_DB_PATH` is set (including the built-in default). Set `false` to hide the tab. If the programs DB cannot be created, `/api/health` reports `programs_enabled: false` and the tab is hidden. |
| `PROGRAMS_DB_PATH` | `/data/programs/programs.db` | Path **inside the container** to the programs sqlite file (not `micasa.db`). |
| `PROGRAMS_DATA_DIR` | `/home/pi/programs` | Host dir bind-mounted read-write to `/data/programs`. |

## Programs (web-only budget rollup)

`micasa` has no parent/child project model. Programs are a **web-only** grouping of existing project IDs stored in a separate sqlite DB (`programs` + `program_projects`). Soft-deleted `micasa` projects are excluded from rollups; abandoned and completed projects still count (they are real costs).

Money fields on list/detail:

| Field | Meaning |
|---|---|
| `budget_cents` | Sum of live child `projects.budget_cents` (nulls ignored) |
| `quoted_cents` | Sum of all non-deleted `quotes.total_cents` for those projects (`accepted_quote_cents` is the same for now) |
| `actual_cents` | Sum of live child `projects.actual_cents` (nulls ignored) |
| `spend_cents` / `projected_cents` | Per project: `max(quoted, paid)` where paid is `actual_cents` or 0; then summed. This is paid plus any unpaid quote, not COALESCE(actual, quoted). |
| `remaining_vs_budget_cents` | `budget_cents - spend_cents` when a child budget exists; otherwise null |
| `variance_vs_budget_cents` | `spend_cents - budget_cents` (positive means over). Null when no child set a budget. |
| `variance_vs_budget_pct` | Variance as a percent of budget. Null when budget is missing or 0. |
| `budget_status` | `on_track` / `at_risk` (projected at least 90% of budget) / `over_budget` / `no_budget` |

Create a program after deploy via the **Programs** tab, or with curl (use your own project IDs from `GET /api/projects` — do not hardcode someone else's):

```bash
# list live projects to pick IDs
curl -s http://localhost:8282/api/projects | python3 -m json.tool

curl -s -X POST http://localhost:8282/api/programs \
  -H 'Content-Type: application/json' \
  -d '{"name":"Office Reno","description":"Tile, paint, window treatments","project_ids":[12,15,18]}'
```

Other endpoints: `GET /api/programs`, `GET /api/programs/{id}`, `PUT /api/programs/{id}`, `DELETE /api/programs/{id}` (soft-delete), `POST /api/programs/{id}/projects` (`{"project_id": 12}`), `DELETE /api/programs/{id}/projects/{project_id}` (unlink). When Programs is disabled or the DB is unusable these return **404**, matching the optional-module degrade path; `/api/health` includes `programs_enabled`.

## Compatibility

Built against `micasa` **v1.52.0**. Because the app mirrors `micasa`s schema exactly, a mismatched `micasa` version can drift; the backend logs a warning on startup if the schema it sees doesnt match what it expects.

## License

MIT
