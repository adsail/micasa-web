import importlib
import sqlite3
import sys
from pathlib import Path

import bcrypt
import pytest
from fastapi.testclient import TestClient

# Import the backend package the same way uvicorn does (`app.main:app`).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

USERNAME = "admin"
PASSWORD = "correct-horse-battery-staple"
SECRET = "a" * 48

AUTH_ENV_VARS = (
    "AUTH_ENABLED",
    "AUTH_USERNAME",
    "AUTH_PASSWORD_HASH",
    "AUTH_SECRET",
    "AUTH_SESSION_DAYS",
    "AUTH_COOKIE_SECURE",
)


@pytest.fixture(scope="session")
def password_hash():
    return bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()


def _seed_db(path):
    """Minimal slice of the micasa schema: one read table and one write table,
    enough to exercise the auth layer without touching a real database."""
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE project_types (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO project_types (id, name) VALUES (1, 'Roofing')")
    conn.execute(
        "CREATE TABLE vendors (id INTEGER PRIMARY KEY, name TEXT, contact_name TEXT,"
        " email TEXT, phone TEXT, website TEXT, notes TEXT, created_at TEXT,"
        " updated_at TEXT, deleted_at TEXT)"
    )
    conn.commit()
    conn.close()


@pytest.fixture
def build_app(tmp_path, monkeypatch):
    """Reload the backend with a given AUTH_* environment and return a client.

    Reloading picks up the module-level auth config (and resets the in-memory
    login limiter) so each test gets a clean instance.
    """
    db_path = tmp_path / "micasa.db"
    _seed_db(db_path)

    def _build(**env):
        for name in AUTH_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        # No built frontend in the test tree; keep the SPA mount out of the way.
        monkeypatch.setenv("STATIC_DIR", str(tmp_path / "no-static"))

        import app.auth
        import app.db
        import app.main

        importlib.reload(app.auth)
        importlib.reload(app.main)
        monkeypatch.setattr(app.db, "DB_PATH", str(db_path))
        return TestClient(app.main.app)

    return _build


@pytest.fixture
def auth_env(password_hash):
    """Enabled-auth environment. Secure cookies are off so the test client's
    plain-HTTP jar keeps them -- production keeps the default (true)."""
    return {
        "AUTH_ENABLED": "true",
        "AUTH_USERNAME": USERNAME,
        "AUTH_PASSWORD_HASH": password_hash,
        "AUTH_SECRET": SECRET,
        "AUTH_COOKIE_SECURE": "false",
    }
