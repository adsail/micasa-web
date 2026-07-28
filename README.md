# micasa-web

A self-hostable web UI for [`micasa`](https://github.com/cpcloud/micasa), the terminal home-maintenance tracker. Point it at an existing `micasa` SQLite database and get a browsable, **editable** web app for your house: projects, quotes, maintenance schedules, incidents, appliances, vendors, and documents.

> micasa-web is a faithful window onto `micasa`. It reads and writes the same SQLite database using the exact same data model and semantics (soft-deletes, deletion records, delete guards, `*_cents` money, incident resolve = date_resolved + soft-delete). It never invents fields or diverges from `micasa` behavior.

## Features

- **All entities**: House profile, Projects (kanban), Quotes, Maintenance, Incidents, Appliances, Vendors, Documents.
- **Full CRUD** with `micasa`-exact rules: soft-delete + `deletion_records`, delete guards (e.g. cant delete a vendor with active quotes/incidents), auto-backup of the DB before every write.
- **Overdue maintenance** notifications: a header bell + count badge opens a drawer of overdue items.
- **Light / dark themes**, responsive (mobile hamburger nav, desktop tab bar).
- **Optional single-account login** (off by default) for exposing the app beyond your LAN: bcrypt password, signed `HttpOnly` session cookie, CSRF protection, login rate limiting. See [Exposing to the internet / Authentication](#exposing-to-the-internet--authentication).
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
| `AUTH_ENABLED` | `false` | Enables the single-account login. Off = no auth at all (see below). |
| `AUTH_USERNAME` | `admin` | The one account's username. |
| `AUTH_PASSWORD_HASH` | — | **Required** when `AUTH_ENABLED=true`. bcrypt hash of the password; plaintext is never accepted. |
| `AUTH_SECRET` | — | **Required** when `AUTH_ENABLED=true`. Session-cookie signing key, ≥ 32 chars. |
| `AUTH_SESSION_DAYS` | `7` | Session lifetime in days. |
| `AUTH_COOKIE_SECURE` | `true` | Marks cookies `Secure` (HTTPS only). Set `false` **only** for local non-TLS testing. |

## Exposing to the internet / Authentication

By default there is **no authentication** — the app is meant for a trusted LAN,
and with `AUTH_ENABLED=false` nothing about it changes: no login screen, no
cookies, no CSRF checks, every route open exactly as before.

Set `AUTH_ENABLED=true` to put a single-account login in front of everything.
It is deliberately minimal: one username, one bcrypt-hashed password, a signed
session cookie, no user database.

### 1. Generate the credentials

```bash
# bcrypt hash of your password (prompts twice, never echoes or stores it)
docker compose run --rm --no-deps micasa-web python -m app.hashpw

# or, with bcrypt installed locally:
python -c "import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass().encode(), bcrypt.gensalt()).decode())"

# session signing secret (>= 32 chars)
openssl rand -hex 32
```

### 2. Enable it

Put the values in an untracked `.env` next to `docker-compose.yml` (it is
git-ignored) or export them in your shell — **never commit a real hash or
secret**:

```bash
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH='$2b$12$....'   # single quotes: the hash contains $
AUTH_SECRET=<openssl rand -hex 32 output>
```

Then `docker compose up -d --build`. If `AUTH_ENABLED=true` and either
`AUTH_PASSWORD_HASH` or a ≥ 32-character `AUTH_SECRET` is missing, **the app
refuses to start** with an explanatory error rather than coming up unprotected.

### 3. Terminate TLS in front of it

Session cookies are marked `Secure`, so **the app must sit behind HTTPS when it
is reachable from the internet** — over plain HTTP the browser will drop the
cookie and login will appear to do nothing. `deploy/Caddyfile` is a ready-made
example; a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
or nginx/Traefik with your own certificate works equally well. Bind the
container to `127.0.0.1` and let the proxy be the only thing listening publicly.

> Never expose the app with `AUTH_ENABLED=false` (no auth at all) or with
> `AUTH_COOKIE_SECURE=false` (session cookie sent in the clear). Both are for a
> private LAN and local testing respectively.

### What the login protects

- **Everything under `/api/*`** — reads included — except `/api/auth/login`,
  `/api/auth/me` and `/api/health`. Unauthenticated requests get a `401`.
- **Password storage**: bcrypt only, verified with `bcrypt.checkpw`; the
  username is compared in constant time and failures return a single generic
  "invalid username or password" for both fields.
- **Session cookie**: `HttpOnly`, `SameSite=Strict`, `Secure` (configurable),
  signed and timestamped with `itsdangerous` and expiring after
  `AUTH_SESSION_DAYS`. It carries only the username — there is no server-side
  session store, so restarts don't log you out and rotating `AUTH_SECRET` does.
- **CSRF**: on top of `SameSite=Strict`, every `POST`/`PUT`/`PATCH`/`DELETE`
  must echo the readable `csrf_token` cookie back in an `X-CSRF-Token` header;
  a mismatch is a `403`. The frontend does this automatically.
- **Brute force**: 5 failed logins from one IP within 15 minutes lock that IP
  out for 15 minutes (`429`). The counters are in-memory and per-process, which
  suits a single instance — a restart clears them. Client IPs are taken from
  the connection, so set `FORWARDED_ALLOW_IPS` to your proxy's address if you
  want per-client (rather than per-proxy) granularity.
- Interactive API docs (`/api/docs`, `/api/openapi.json`) are turned off while
  auth is enabled.

## Compatibility

Built against `micasa` **v1.52.0**. Because the app mirrors `micasa`s schema exactly, a mismatched `micasa` version can drift; the backend logs a warning on startup if the schema it sees doesnt match what it expects.

## License

MIT
