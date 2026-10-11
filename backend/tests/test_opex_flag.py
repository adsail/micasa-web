"""OPEX_ENABLED gate tests. Uses temp sqlite files; never touches /data."""

import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

PULLED_AT = "2026-01-01T12:00:00+00:00"


def _seed_opex(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE opex_monthly (month TEXT, category_id INTEGER, category_name TEXT, bucket TEXT,
            amount_cents INTEGER, pulled_at TEXT)
        """
    )
    conn.executemany("INSERT INTO opex_monthly VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


def _recent_months(n):
    """First-of-month ISO dates for the current UTC month and the n - 1 before
    it, newest first."""
    m = datetime.now(timezone.utc).date().replace(day=1)
    out = []
    for _ in range(n):
        out.append(m.isoformat())
        m = (m - timedelta(days=1)).replace(day=1)
    return out


class OpexFlagTest(unittest.TestCase):
    def setUp(self):
        self._saved_env = {k: os.environ.get(k) for k in ("OPEX_ENABLED", "PROGRAMS_ENABLED")}
        os.environ.pop("OPEX_ENABLED", None)
        os.environ["PROGRAMS_ENABLED"] = "false"

        self.tmp = tempfile.TemporaryDirectory()
        micasa_db = os.path.join(self.tmp.name, "micasa.db")
        sqlite3.connect(micasa_db).close()
        self.opex_db = os.path.join(self.tmp.name, "opex.db")

        import app.db as dbmod

        self.dbmod = dbmod
        self._saved_paths = (dbmod.DB_PATH, dbmod.OPEX_DB_PATH)
        dbmod.DB_PATH = micasa_db
        dbmod.OPEX_DB_PATH = self.opex_db

        from fastapi.testclient import TestClient
        from app.main import api

        self.client = TestClient(api)

    def tearDown(self):
        self.dbmod.DB_PATH, self.dbmod.OPEX_DB_PATH = self._saved_paths
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def _set_flag(self, value):
        if value is None:
            os.environ.pop("OPEX_ENABLED", None)
        else:
            os.environ["OPEX_ENABLED"] = value

    def test_disabled_returns_404_and_health_reports_false(self):
        # The gate must win over an existing snapshot and over period validation.
        this_month = _recent_months(1)[0]
        _seed_opex(self.opex_db, [(this_month, 1, "Mortgage", "FIXED", 100_000, PULLED_AT)])
        for value in (None, "false", "0"):
            with self.subTest(OPEX_ENABLED=value):
                self._set_flag(value)
                for path in ("/opex/summary", "/opex/summary?period=bogus", "/opex/series"):
                    res = self.client.get(path)
                    self.assertEqual(res.status_code, 404, f"{path}: {res.text}")
                    self.assertEqual(res.json(), {"detail": "opex disabled"})
                health = self.client.get("/health")
                self.assertEqual(health.status_code, 200, health.text)
                self.assertIs(health.json()["opex_enabled"], False)

    def test_enabled_without_snapshot_returns_no_data(self):
        for value in ("true", "1", "yes"):
            with self.subTest(OPEX_ENABLED=value):
                self._set_flag(value)
                summary = self.client.get("/opex/summary")
                self.assertEqual(summary.status_code, 200, summary.text)
                self.assertIs(summary.json()["no_data"], True)
                series = self.client.get("/opex/series")
                self.assertEqual(series.status_code, 200, series.text)
                self.assertIs(series.json()["no_data"], True)
                self.assertEqual(self.client.get("/opex/summary?period=bogus").status_code, 400)
                health = self.client.get("/health")
                self.assertEqual(health.status_code, 200, health.text)
                self.assertIs(health.json()["opex_enabled"], True)

    def test_enabled_with_snapshot_returns_totals(self):
        self._set_flag("true")
        m0, m1, m2 = _recent_months(3)
        # Inserted out of month order so the series sort is exercised.
        _seed_opex(
            self.opex_db,
            [
                (m0, 1, "Mortgage", "FIXED", 200_000, PULLED_AT),
                (m0, 2, "Utilities", "FLEXIBLE", 15_000, PULLED_AT),
                (m2, 1, "Mortgage", "FIXED", 200_000, PULLED_AT),
                (m2, 3, "Repairs", "NON_MONTHLY", 33_000, PULLED_AT),
                (m1, 1, "Mortgage", "FIXED", 200_000, PULLED_AT),
                (m1, 2, "Utilities", "FLEXIBLE", 12_000, PULLED_AT),
            ],
        )

        res = self.client.get("/opex/summary")
        self.assertEqual(res.status_code, 200, res.text)
        summary = res.json()
        self.assertIs(summary["no_data"], False)
        self.assertEqual(summary["months"], 3)
        self.assertEqual(summary["total_cents"], 660_000)
        self.assertEqual(summary["fixed_cents"], 600_000)
        self.assertEqual(summary["variable_cents"], 60_000)
        self.assertEqual(summary["monthly_burn_cents"], 220_000)
        self.assertEqual(summary["annualized_cents"], 2_640_000)
        self.assertEqual(summary["pulled_at"], PULLED_AT)
        self.assertEqual(
            {c["category_id"]: c["total_cents"] for c in summary["by_category"]},
            {1: 600_000, 2: 27_000, 3: 33_000},
        )

        res = self.client.get("/opex/series")
        self.assertEqual(res.status_code, 200, res.text)
        series = res.json()
        self.assertIs(series["no_data"], False)
        self.assertEqual(
            [(m["month"], m["fixed_cents"], m["variable_cents"], m["total_cents"])
             for m in series["months"]],
            [
                (m2, 200_000, 33_000, 233_000),
                (m1, 200_000, 12_000, 212_000),
                (m0, 200_000, 15_000, 215_000),
            ],
        )
        self.assertEqual(
            [c["category_name"] for c in series["categories"]],
            ["Mortgage", "Repairs", "Utilities"],
        )


if __name__ == "__main__":
    unittest.main()
