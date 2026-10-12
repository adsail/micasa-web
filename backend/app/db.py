import logging
import os
import sqlite3
from datetime import datetime, date, timezone

log = logging.getLogger(__name__)

DB_PATH = "/data/micasa.db"
BACKUP_DIR = "/data/backups"
MAX_BACKUPS = 30


def get_conn():
    """Open the micasa DB strictly read-only."""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # Extra safety: forbid any writes on this connection.
    conn.execute("PRAGMA query_only=ON")
    return conn


def get_write_conn():
    """Open a normal read-write connection for the two write endpoints.

    Does NOT set query_only. Leaves journal_mode (WAL) untouched. A short
    busy_timeout lets us wait briefly if the micasa TUI holds a lock rather
    than failing instantly.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def now_utc_str():
    """Current UTC timestamp as 'YYYY-MM-DD HH:MM:SS+00:00'."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00:00")


def today_utc_date_str():
    """Today (UTC) as a date-only stored value 'YYYY-MM-DD 00:00:00+00:00'."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d 00:00:00+00:00")


def date_only_str(yyyy_mm_dd):
    """Normalize a 'YYYY-MM-DD' input into stored 'YYYY-MM-DD 00:00:00+00:00'.

    Returns None for blank input. Raises ValueError for malformed input.
    """
    if yyyy_mm_dd is None:
        return None
    s = str(yyyy_mm_dd).strip()
    if not s:
        return None
    # Validate it really is a date (allows YYYY-MM-DD, tolerant of extra time).
    d = datetime.strptime(s[:10], "%Y-%m-%d").date()
    return d.strftime("%Y-%m-%d 00:00:00+00:00")


def backup_db():
    """Create a consistent, WAL-safe snapshot of the DB using SQLite's backup
    API, writing to /data/backups/micasa-<UTC timestamp>.db. Prune to the most
    recent MAX_BACKUPS files. Returns the backup file path.

    Raises on any failure so callers can ABORT the write (never write without
    a backup).
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    dest_path = os.path.join(BACKUP_DIR, f"micasa-{ts}.db")

    src = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        dest = sqlite3.connect(dest_path)
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()

    # Sanity: ensure a non-empty file landed.
    if not os.path.exists(dest_path) or os.path.getsize(dest_path) == 0:
        raise RuntimeError("backup produced no output")

    _prune_backups()
    return dest_path


def _prune_backups():
    try:
        files = [
            os.path.join(BACKUP_DIR, f)
            for f in os.listdir(BACKUP_DIR)
            if f.startswith("micasa-") and f.endswith(".db")
        ]
        files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        for old in files[MAX_BACKUPS:]:
            try:
                os.remove(old)
            except OSError:
                pass
    except OSError:
        pass


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def parse_dt(value):
    """Tolerant datetime parser for the mixed formats stored in micasa.

    Handles ISO8601 ("2026-06-08 00:00:00+00:00"),
    Go-style ("2025-10-08 00:00:00 +0000 UTC",
              "2026-02-19 18:27:09.688685601 -0500 EST"),
    and plain dates. Returns a date or None.
    """
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value if isinstance(value, date) and not isinstance(value, datetime) else value
    s = str(value).strip()
    if not s:
        return None
    # Strip trailing timezone-name noise like "+0000 UTC" / "-0500 EST".
    for suffix in (" UTC", " EST", " EDT", " PST", " PDT", " GMT"):
        if s.endswith(suffix):
            s = s[: -len(suffix)].strip()
            # After stripping name, there may be a " +0000" numeric offset left.
            parts = s.rsplit(" ", 1)
            if len(parts) == 2 and (parts[1].startswith("+") or parts[1].startswith("-")):
                s = parts[0].strip()
            break
    # Normalize Go nanosecond precision -> microseconds if needed.
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    # Try with a T separator variant.
    try:
        return datetime.fromisoformat(s.replace(" ", "T", 1))
    except ValueError:
        pass
    # Fallback: first 10 chars YYYY-MM-DD.
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except ValueError:
        return None


def to_iso_date(value):
    """Return a YYYY-MM-DD string (or None) from any stored datetime value."""
    d = parse_dt(value)
    if d is None:
        return None
    return d.date().isoformat() if isinstance(d, datetime) else d.isoformat()


def add_months(d, months):
    if d is None or months is None:
        return None
    if isinstance(d, datetime):
        d = d.date()
    month = d.month - 1 + int(months)
    year = d.year + month // 12
    month = month % 12 + 1
    # Clamp day to end of month.
    import calendar
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


# ---------------------------------------------------------------------------
# Home OpEx snapshot DB (separate from micasa.db, read-only).
# Populated on the box by /workspace/monarch/opex_pull.py and copied to the Pi.
# ---------------------------------------------------------------------------
OPEX_DB_PATH = "/data/opex/opex.db"


def get_opex_conn():
    """Open the OpEx snapshot DB strictly read-only. Returns None if the DB
    file does not exist yet (no snapshot has been pushed), so endpoints can
    degrade gracefully to a "no data yet" response."""
    if not os.path.exists(OPEX_DB_PATH):
        return None
    conn = sqlite3.connect(f"file:{OPEX_DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


# ---------------------------------------------------------------------------
# Programs DB (web-only grouping layer, separate from micasa.db).
# Groups existing micasa project IDs into "programs" for budget rollups.
# Does NOT change micasa schema or project semantics.
# ---------------------------------------------------------------------------
PROGRAMS_DB_PATH_DEFAULT = "/data/programs/programs.db"

_PROGRAMS_SCHEMA = """
CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS program_projects (
    id INTEGER PRIMARY KEY,
    program_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (program_id) REFERENCES programs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_program_projects_live
    ON program_projects(program_id, project_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_program_projects_program
    ON program_projects(program_id);
"""

_initialized_program_paths = set()


def _env_truthy(name, default=None):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def programs_db_path():
    return os.environ.get("PROGRAMS_DB_PATH", PROGRAMS_DB_PATH_DEFAULT)


def programs_feature_on():
    """PROGRAMS_ENABLED: default true when a DB path is configured (the
    built-in default counts), else false. Explicit env wins."""
    explicit = _env_truthy("PROGRAMS_ENABLED")
    if explicit is not None:
        return explicit
    return bool(programs_db_path())


def init_programs_db():
    """Create the programs DB file + schema if the feature is on.

    Returns True when the DB is usable. Failures (unwritable path, corrupt or
    non-SQLite file, etc.) return False so local/unauthenticated use still
    boots without Programs. Failures are not cached, so a fixed file is
    picked up on the next call. Never delete or rewrite a bad file here: it
    may be the only copy of the user's programs.
    """
    if not programs_feature_on():
        return False
    path = programs_db_path()
    if path in _initialized_program_paths and os.path.exists(path):
        return True
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        conn = sqlite3.connect(path)
        try:
            conn.executescript(_PROGRAMS_SCHEMA)
            conn.commit()
        finally:
            conn.close()
        _initialized_program_paths.add(path)
        return True
    except (OSError, sqlite3.Error) as e:
        log.warning("programs DB unavailable at %s: %s", path, e)
        return False


def is_programs_available():
    """True when PROGRAMS_ENABLED and the programs DB can be opened/created.

    Used by /api/health (`programs_enabled`) and as the gate for /api/programs*.
    Mirrors OpEx's "missing snapshot → degrade" idea, except Programs is a
    writeable module so a disabled/unusable DB yields 404s instead of empty
    rollups.

    Never raises. The cached path is re-probed on every call (the file is
    tiny) so a DB that breaks after startup reads as disabled, not a 500.
    """
    if not init_programs_db():
        return False
    path = programs_db_path()
    try:
        conn = sqlite3.connect(path)
        try:
            conn.execute("SELECT 1 FROM programs LIMIT 1").fetchone()
        finally:
            conn.close()
    except sqlite3.Error as e:
        _initialized_program_paths.discard(path)
        log.warning("programs DB unavailable at %s: %s", path, e)
        return False
    return True


def get_programs_conn():
    """Open a read-write connection to the programs DB. Returns None when
    the feature is off or the DB is unusable."""
    if not is_programs_available():
        return None
    conn = sqlite3.connect(programs_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
