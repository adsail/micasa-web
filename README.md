# micasa-web

A self-hostable web UI for [`micasa`](https://github.com/cpcloud/micasa), the terminal home-maintenance tracker. Point it at an existing `micasa` SQLite database and get a browsable, **editable** web app for your house: projects, quotes, maintenance schedules, incidents, appliances, vendors, and documents.

> micasa-web is a faithful window onto `micasa`. It reads and writes the same SQLite database using the exact same data model and semantics (soft-deletes, deletion records, delete guards, `*_cents` money, incident resolve = date_resolved + soft-delete). It never invents fields or diverges from `micasa` behavior.

## Features

- **All entities**: House profile, Projects (kanban), Quotes, Maintenance, Incidents, Appliances, Vendors, Documents.
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
| `OPEX_ENABLED` | `false` | Enables the optional Home OpEx tab + `/api/opex/*`. |

## Compatibility

Built against `micasa` **v1.52.0**. Because the app mirrors `micasa`s schema exactly, a mismatched `micasa` version can drift; the backend logs a warning on startup if the schema it sees doesnt match what it expects.

## License

MIT
