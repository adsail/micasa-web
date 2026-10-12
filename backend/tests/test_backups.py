"""Pre-write backup tests: retention, placement, and programs.db coverage.
Uses temp dirs and temp sqlite files; never touches /data."""

import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from fastapi.testclient import TestClient

import app.db as dbmod
from app.main import api
from tests.test_programs import _seed_micasa

NOW = datetime(2026, 10, 11, 23, 30, tzinfo=timezone.utc)

_ENV_KEYS = (
    "BACKUP_DIR",
    "PROGRAMS_BACKUP_DIR",
    "BACKUP_KEEP_LAST",
    "BACKUP_KEEP_HOURLY",
    "BACKUP_KEEP_DAILY",
    "PROGRAMS_ENABLED",
    "PROGRAMS_DB_PATH",
)


def _backup_name(prefix, when):
    return f"{prefix}{when.strftime('%Y%m%dT%H%M%S.%fZ')}.db"


def _listing(path, prefix=""):
    if not os.path.isdir(path):
        return []
    return sorted(n for n in os.listdir(path) if n.startswith(prefix))


def _touch(path, mtime=None):
    with open(path, "wb") as f:
        f.write(b"x")
    if mtime is not None:
        os.utime(path, (mtime.timestamp(), mtime.timestamp()))


def _scalar(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _seed_micasa_for_writes(path):
    """_seed_micasa plus what project writes need: deletion_records,
    project_types, and project 20, which has no quotes and can be deleted."""
    _seed_micasa(path)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE deletion_records (
            id INTEGER PRIMARY KEY,
            entity TEXT,
            target_id INTEGER,
            deleted_at TEXT,
            restored_at TEXT
        );
        CREATE TABLE project_types (id INTEGER PRIMARY KEY, name TEXT);
        INSERT INTO projects (id, title, status, created_at, updated_at)
        VALUES (20, 'Garage | Shelves', 'ideating', '2026-01-01', '2026-01-01');
        """
    )
    conn.commit()
    conn.close()


class RetentionSelectionTest(unittest.TestCase):
    """backups_to_prune on synthetic timestamps. NOW is 23:30 UTC."""

    def kept(self, backups, keep_last, keep_hourly, keep_daily):
        doomed = dbmod.backups_to_prune(backups, NOW, keep_last, keep_hourly, keep_daily)
        return {name for name, _ in backups} - set(doomed)

    def test_keep_last_keeps_the_newest_n(self):
        backups = [(f"m{i}", NOW - timedelta(minutes=i)) for i in range(12)]
        self.assertEqual(
            dbmod.backups_to_prune(backups, NOW, 5, 0, 0),
            [f"m{i}" for i in range(11, 4, -1)],
        )

    def test_hourly_keeps_the_newest_backup_in_each_of_the_last_n_hours(self):
        top_of_hour = NOW.replace(minute=0)
        backups = [
            (f"h{h}:{m:02d}", top_of_hour - timedelta(hours=h) + timedelta(minutes=m))
            for h in range(30)
            for m in (0, 10, 20)
        ]
        self.assertEqual(self.kept(backups, 0, 24, 0), {f"h{h}:20" for h in range(24)})

    def test_daily_keeps_the_newest_backup_in_each_of_the_last_n_utc_days(self):
        midnight = NOW.replace(hour=0, minute=0)
        backups = [
            (f"d{d}@{hour:02d}", midnight - timedelta(days=d) + timedelta(hours=hour))
            for d in range(20)
            for hour in (0, 12, 23)
        ]
        self.assertEqual(self.kept(backups, 0, 0, 14), {f"d{d}@23" for d in range(14)})

    def test_newest_backup_survives_with_every_knob_at_zero(self):
        backups = [("older", NOW - timedelta(days=41)), ("newest", NOW - timedelta(days=40))]
        self.assertEqual(dbmod.backups_to_prune(backups, NOW, 0, 0, 0), ["older"])
        self.assertEqual(dbmod.backups_to_prune([], NOW, 0, 0, 0), [])

    def test_busy_evening_no_longer_pushes_out_older_restore_points(self):
        daily = [(f"day{d}", NOW - timedelta(days=d, hours=6)) for d in range(1, 22)]
        evening = [(f"edit{i}", NOW - timedelta(minutes=2 * i)) for i in range(30)]
        # edit16 (22:58) is the newest backup in the previous clock hour.
        self.assertEqual(
            self.kept(daily + evening, 10, 24, 14),
            {f"edit{i}" for i in range(10)} | {"edit16"} | {f"day{d}" for d in range(1, 14)},
        )

    def test_worst_case_with_defaults_keeps_46(self):
        # Every slot holds a different backup except the newest, which fills
        # a keep-last, an hourly, and a daily slot at once.
        current_hour = [(f"now{i}", NOW - timedelta(minutes=i)) for i in range(10)]
        earlier_hours = [(f"hour{h}", NOW - timedelta(hours=h)) for h in range(1, 24)]
        earlier_days = [(f"day{d}", NOW - timedelta(days=d)) for d in range(1, 20)]
        kept = self.kept(current_hour + earlier_hours + earlier_days, 10, 24, 14)
        self.assertEqual(len(kept), 46)


class _SandboxTestCase(unittest.TestCase):
    """Clears the backup and programs env vars and makes a temp dir per test."""

    def setUp(self):
        self._saved_env = {k: os.environ.pop(k, None) for k in _ENV_KEYS}
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()


class PruneBackupsTest(_SandboxTestCase):
    def test_each_prefix_prunes_independently(self):
        now = datetime.now(timezone.utc)
        micasa = [_backup_name("micasa-", now - timedelta(days=30 + i)) for i in range(4)]
        programs = [_backup_name("programs-", now - timedelta(days=i)) for i in range(4)]
        others = ["micasa.db", "programs.db", "notes.txt"]
        for name in micasa + programs + others:
            _touch(os.path.join(self.tmp.name, name))
        os.environ.update(BACKUP_KEEP_LAST="2", BACKUP_KEEP_HOURLY="0", BACKUP_KEEP_DAILY="0")

        dbmod._prune_backups(self.tmp.name, "micasa-")
        self.assertEqual(_listing(self.tmp.name), sorted(micasa[:2] + programs + others))

        dbmod._prune_backups(self.tmp.name, "programs-")
        self.assertEqual(_listing(self.tmp.name), sorted(micasa[:2] + programs[:2] + others))

    def test_backup_time_comes_from_the_name_then_mtime(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=40)
        named_recent = _backup_name("micasa-", now - timedelta(hours=1))
        _touch(os.path.join(self.tmp.name, _backup_name("micasa-", old)), mtime=now)
        _touch(os.path.join(self.tmp.name, named_recent), mtime=old)
        _touch(os.path.join(self.tmp.name, "micasa-manual-copy.db"), mtime=now)
        _touch(os.path.join(self.tmp.name, "micasa-before-upgrade.db"), mtime=old)
        os.environ.update(BACKUP_KEEP_LAST="2", BACKUP_KEEP_HOURLY="0", BACKUP_KEEP_DAILY="0")

        dbmod._prune_backups(self.tmp.name, "micasa-")
        self.assertEqual(_listing(self.tmp.name), sorted([named_recent, "micasa-manual-copy.db"]))

    def test_bad_or_negative_keep_values_fall_back_to_defaults(self):
        self.assertEqual(dbmod.backup_retention(), (10, 24, 14))
        os.environ.update(BACKUP_KEEP_LAST="lots", BACKUP_KEEP_HOURLY="-1", BACKUP_KEEP_DAILY="0")
        with self.assertLogs("app.db", level="WARNING") as logs:
            self.assertEqual(dbmod.backup_retention(), (10, 24, 0))
        self.assertEqual(len(logs.records), 2)
        self.assertIn("BACKUP_KEEP_LAST", logs.output[0])
        self.assertIn("BACKUP_KEEP_HOURLY", logs.output[1])

    def test_prune_errors_are_logged_not_raised(self):
        with self.assertLogs("app.db", level="WARNING"):
            dbmod._prune_backups(os.path.join(self.tmp.name, "missing"), "micasa-")


class MicasaWriteBackupTest(_SandboxTestCase):
    def setUp(self):
        super().setUp()
        self.micasa_db = os.path.join(self.tmp.name, "micasa.db")
        self.backups = os.path.join(self.tmp.name, "backups")
        _seed_micasa_for_writes(self.micasa_db)
        os.environ["BACKUP_DIR"] = self.backups
        self._old = (dbmod.DB_PATH, dbmod.BACKUP_DIR)
        dbmod.DB_PATH = self.micasa_db
        dbmod.BACKUP_DIR = self.backups
        self.client = TestClient(api)

    def tearDown(self):
        dbmod.DB_PATH, dbmod.BACKUP_DIR = self._old
        super().tearDown()

    def project(self, project_id, column):
        return _scalar(self.micasa_db, f"SELECT {column} FROM projects WHERE id = ?", (project_id,))

    def assert_refused(self, requests):
        dbmod.backup_db()
        before = _listing(self.backups)
        for method, path, body, status in requests:
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, status, f"{method} {path}: {res.text}")
        self.assertEqual(_listing(self.backups), before)

    def test_404_write_leaves_backups_unchanged(self):
        self.assert_refused(
            [
                ("PUT", "/projects/404", {"title": "Ghost", "status": "planned"}, 404),
                ("PATCH", "/projects/404/status", {"status": "planned"}, 404),
                ("DELETE", "/projects/404", None, 404),
            ]
        )

    def test_guard_refusal_leaves_backups_unchanged(self):
        self.assert_refused([("DELETE", "/projects/10", None, 400)])
        self.assertIsNone(self.project(10, "deleted_at"))

    def test_validation_error_leaves_backups_unchanged(self):
        self.assert_refused(
            [
                ("POST", "/projects", {"title": "  "}, 400),
                ("PATCH", "/projects/11/status", {"status": "bogus"}, 400),
                ("PUT", "/projects/11", {"title": "Paint", "status": "planned", "start_date": "soon"}, 400),
            ]
        )

    def test_each_successful_write_adds_exactly_one_backup(self):
        writes = [
            ("POST", "/projects", {"title": "Porch"}, 201),
            ("PATCH", "/projects/11/status", {"status": "underway"}, 200),
            ("PUT", "/projects/12", {"title": "Office | Blinds", "status": "planned"}, 200),
            ("DELETE", "/projects/20", None, 200),
        ]
        for count, (method, path, body, status) in enumerate(writes, start=1):
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, status, f"{method} {path}: {res.text}")
            self.assertEqual(len(_listing(self.backups, "micasa-")), count, f"{method} {path}")

    def test_backup_holds_the_state_from_just_before_the_write(self):
        res = self.client.delete("/projects/20")
        self.assertEqual(res.status_code, 200, res.text)
        [name] = _listing(self.backups)
        copy = os.path.join(self.backups, name)
        self.assertIsNone(_scalar(copy, "SELECT deleted_at FROM projects WHERE id = 20"))
        self.assertEqual(_scalar(copy, "SELECT COUNT(*) FROM deletion_records"), 0)
        self.assertIsNotNone(self.project(20, "deleted_at"))

    def test_failed_backup_returns_500_and_leaves_the_row(self):
        blocker = os.path.join(self.tmp.name, "not-a-dir")
        _touch(blocker)
        os.environ["BACKUP_DIR"] = blocker
        for method, path, body in [
            ("DELETE", "/projects/20", None),
            ("PATCH", "/projects/11/status", {"status": "underway"}),
        ]:
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, 500, res.text)
            self.assertTrue(res.json()["detail"].startswith("backup failed, write aborted: "))
        self.assertIsNone(self.project(20, "deleted_at"))
        self.assertEqual(self.project(11, "status"), "completed")
        self.assertEqual(_scalar(self.micasa_db, "SELECT COUNT(*) FROM deletion_records"), 0)

    def test_backup_dir_env_overrides_module_default(self):
        dbmod.BACKUP_DIR = os.path.join(self.tmp.name, "module-default")
        self.assertEqual(self.client.delete("/projects/20").status_code, 200)
        self.assertEqual(len(_listing(self.backups, "micasa-")), 1)
        self.assertEqual(_listing(dbmod.BACKUP_DIR), [])

        os.environ.pop("BACKUP_DIR")
        res = self.client.patch("/projects/11/status", json={"status": "underway"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(len(_listing(dbmod.BACKUP_DIR, "micasa-")), 1)

    def test_prune_failure_is_logged_and_the_write_still_happens(self):
        os.makedirs(self.backups)
        stale = _backup_name("micasa-", datetime.now(timezone.utc) - timedelta(days=60))
        _touch(os.path.join(self.backups, stale))
        os.environ.update(BACKUP_KEEP_LAST="1", BACKUP_KEEP_HOURLY="0", BACKUP_KEEP_DAILY="0")
        with mock.patch("os.remove", side_effect=PermissionError("read-only")):
            with self.assertLogs("app.db", level="WARNING"):
                res = self.client.delete("/projects/20")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn(stale, _listing(self.backups))
        self.assertIsNotNone(self.project(20, "deleted_at"))


class ProgramsWriteBackupTest(_SandboxTestCase):
    def setUp(self):
        super().setUp()
        self.micasa_db = os.path.join(self.tmp.name, "micasa.db")
        self.micasa_backups = os.path.join(self.tmp.name, "backups")
        self.prog_db = os.path.join(self.tmp.name, "programs", "programs.db")
        self.prog_backups = os.path.join(self.tmp.name, "programs", "backups")
        _seed_micasa(self.micasa_db)
        os.environ["PROGRAMS_ENABLED"] = "true"
        os.environ["PROGRAMS_DB_PATH"] = self.prog_db
        os.environ["BACKUP_DIR"] = self.micasa_backups
        self._old = (dbmod.DB_PATH, dbmod.BACKUP_DIR)
        dbmod.DB_PATH = self.micasa_db
        dbmod.BACKUP_DIR = self.micasa_backups
        dbmod._initialized_program_paths.discard(self.prog_db)
        dbmod.init_programs_db()
        self.client = TestClient(api)

    def tearDown(self):
        dbmod.DB_PATH, dbmod.BACKUP_DIR = self._old
        super().tearDown()

    def test_each_programs_write_adds_one_programs_backup(self):
        res = self.client.post("/programs", json={"name": "Office Reno", "project_ids": [10]})
        self.assertEqual(res.status_code, 201, res.text)
        pid = res.json()["id"]
        [first] = _listing(self.prog_backups, "programs-")
        self.assertEqual(_scalar(os.path.join(self.prog_backups, first), "SELECT COUNT(*) FROM programs"), 0)

        writes = [
            ("PUT", f"/programs/{pid}", {"name": "Office"}, 200),
            ("POST", f"/programs/{pid}/projects", {"project_id": 11}, 201),
            ("DELETE", f"/programs/{pid}/projects/10", None, 200),
            ("DELETE", f"/programs/{pid}", None, 200),
        ]
        for count, (method, path, body, status) in enumerate(writes, start=2):
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, status, f"{method} {path}: {res.text}")
            self.assertEqual(len(_listing(self.prog_backups, "programs-")), count, f"{method} {path}")
        self.assertEqual(_listing(self.micasa_backups), [])

    def test_refused_programs_writes_leave_backups_unchanged(self):
        pid = self.client.post("/programs", json={"name": "Office", "project_ids": [10]}).json()["id"]
        before = _listing(self.prog_backups)
        refused = [
            ("POST", "/programs", {"name": " "}, 400),
            ("POST", "/programs", {"name": "Gone", "project_ids": [99]}, 400),
            ("PUT", "/programs/999", {"name": "Nope"}, 404),
            ("DELETE", "/programs/999", None, 404),
            ("POST", f"/programs/{pid}/projects", {"project_id": 10}, 400),
            ("POST", f"/programs/{pid}/projects", {"project_id": 99}, 400),
            ("POST", "/programs/999/projects", {"project_id": 11}, 404),
            ("DELETE", f"/programs/{pid}/projects/11", None, 404),
        ]
        for method, path, body, status in refused:
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, status, f"{method} {path}: {res.text}")
        self.assertEqual(_listing(self.prog_backups), before)

    def test_programs_backup_failure_aborts_the_write(self):
        pid = self.client.post("/programs", json={"name": "Office"}).json()["id"]
        blocker = os.path.join(self.tmp.name, "not-a-dir")
        _touch(blocker)
        os.environ["PROGRAMS_BACKUP_DIR"] = blocker

        for method, path, body in [
            ("POST", "/programs", {"name": "Garage"}),
            ("POST", f"/programs/{pid}/projects", {"project_id": 10}),
        ]:
            res = self.client.request(method, path, json=body)
            self.assertEqual(res.status_code, 500, res.text)
            self.assertTrue(res.json()["detail"].startswith("backup failed, write aborted: "))
        self.assertEqual(_scalar(self.prog_db, "SELECT COUNT(*) FROM programs"), 1)
        self.assertEqual(_scalar(self.prog_db, "SELECT COUNT(*) FROM program_projects"), 0)

    def test_programs_backup_dir_env_override(self):
        custom = os.path.join(self.tmp.name, "programs-backups")
        os.environ["PROGRAMS_BACKUP_DIR"] = custom
        self.assertEqual(self.client.post("/programs", json={"name": "Office"}).status_code, 201)
        self.assertEqual(len(_listing(custom, "programs-")), 1)
        self.assertEqual(_listing(self.prog_backups), [])


if __name__ == "__main__":
    unittest.main()
