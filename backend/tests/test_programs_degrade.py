"""A bad programs.db must switch Programs off, never take down the app.
Uses temp sqlite files; never touches /data."""

import os
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient

import app.db as dbmod
from app.main import app
from tests.test_programs import _seed_micasa

GARBAGE = b"not a sqlite database" * 64


class ProgramsDegradeTest(unittest.TestCase):
    def setUp(self):
        self._saved = {
            "PROGRAMS_ENABLED": os.environ.get("PROGRAMS_ENABLED"),
            "PROGRAMS_DB_PATH": os.environ.get("PROGRAMS_DB_PATH"),
        }
        self.tmp = tempfile.TemporaryDirectory()
        self.micasa_db = os.path.join(self.tmp.name, "micasa.db")
        self.prog_db = os.path.join(self.tmp.name, "programs.db")
        _seed_micasa(self.micasa_db)
        os.environ["PROGRAMS_ENABLED"] = "true"
        os.environ["PROGRAMS_DB_PATH"] = self.prog_db
        self._old_micasa = dbmod.DB_PATH
        dbmod.DB_PATH = self.micasa_db
        dbmod._initialized_program_paths.discard(self.prog_db)

    def tearDown(self):
        dbmod._initialized_program_paths.discard(self.prog_db)
        dbmod.DB_PATH = self._old_micasa
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def _write_garbage(self):
        with open(self.prog_db, "wb") as f:
            f.write(GARBAGE)

    def _assert_programs_disabled(self, client):
        health = client.get("/api/health")
        self.assertEqual(health.status_code, 200, health.text)
        self.assertIs(health.json()["programs_enabled"], False)
        res = client.get("/api/programs")
        self.assertEqual(res.status_code, 404, res.text)
        self.assertEqual(res.json()["detail"], "programs disabled")

    def test_corrupt_file_does_not_block_startup(self):
        self._write_garbage()
        with self.assertLogs("app.db", "WARNING") as logs:
            self.assertFalse(dbmod.init_programs_db())
            with TestClient(app) as client:
                self._assert_programs_disabled(client)
        self.assertIn(self.prog_db, logs.output[0])
        self.assertIn("file is not a database", logs.output[0])
        with open(self.prog_db, "rb") as f:
            self.assertEqual(f.read(), GARBAGE)

    def test_parent_path_is_a_file(self):
        parent = os.path.join(self.tmp.name, "not-a-dir")
        open(parent, "w").close()
        os.environ["PROGRAMS_DB_PATH"] = os.path.join(parent, "programs.db")
        with self.assertLogs("app.db", "WARNING"):
            self.assertFalse(dbmod.init_programs_db())

    @unittest.skipIf(os.geteuid() == 0, "root ignores directory permissions")
    def test_read_only_parent_dir(self):
        ro_dir = os.path.join(self.tmp.name, "ro")
        os.mkdir(ro_dir)
        os.chmod(ro_dir, 0o555)
        try:
            os.environ["PROGRAMS_DB_PATH"] = os.path.join(ro_dir, "programs.db")
            with self.assertLogs("app.db", "WARNING"):
                self.assertFalse(dbmod.init_programs_db())
                with TestClient(app) as client:
                    self._assert_programs_disabled(client)
        finally:
            os.chmod(ro_dir, 0o755)

    def test_corruption_after_init_disables_programs(self):
        with TestClient(app) as client:
            self.assertIs(client.get("/api/health").json()["programs_enabled"], True)
            res = client.post("/api/programs", json={"name": "Office Reno", "project_ids": [10]})
            self.assertEqual(res.status_code, 201, res.text)
            pid = res.json()["id"]

            self._write_garbage()
            with self.assertLogs("app.db", "WARNING"):
                self._assert_programs_disabled(client)
                for method, path, body in (
                    ("GET", f"/api/programs/{pid}", None),
                    ("POST", "/api/programs", {"name": "Later"}),
                    ("PUT", f"/api/programs/{pid}", {"name": "Renamed"}),
                    ("DELETE", f"/api/programs/{pid}", None),
                    ("POST", f"/api/programs/{pid}/projects", {"project_id": 11}),
                    ("DELETE", f"/api/programs/{pid}/projects/10", None),
                ):
                    with self.subTest(method=method, path=path):
                        res = client.request(method, path, json=body)
                        self.assertEqual(res.status_code, 404, res.text)
                        self.assertEqual(res.json()["detail"], "programs disabled")

    def test_recovers_once_bad_file_is_removed(self):
        self.assertTrue(dbmod.init_programs_db())
        self._write_garbage()
        with self.assertLogs("app.db", "WARNING"):
            self.assertFalse(dbmod.is_programs_available())
            self.assertFalse(dbmod.is_programs_available())
        os.remove(self.prog_db)
        self.assertTrue(dbmod.is_programs_available())
        conn = sqlite3.connect(self.prog_db)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0], 0)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
