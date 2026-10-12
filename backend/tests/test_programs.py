"""Programs rollup + API tests. Uses temp sqlite files; never touches /data."""

import os
import sqlite3
import tempfile
import unittest

from app.programs import budget_status, compute_rollup, project_projected, project_trend


def _seed_micasa(path):
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            budget_cents INTEGER,
            actual_cents INTEGER,
            start_date TEXT,
            end_date TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT,
            project_type_id INTEGER,
            description TEXT
        );
        CREATE TABLE quotes (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            total_cents INTEGER,
            deleted_at TEXT
        );
        """
    )
    # live: tile (underway, has actual), paint (completed), windows (abandoned)
    # deleted: old demo project — must not roll up
    conn.executemany(
        """
        INSERT INTO projects
            (id, title, status, budget_cents, actual_cents, start_date, end_date,
             created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01', ?)
        """,
        [
            (10, "Office | Tile", "underway", 200_000, 150_000, "2026-03-01", None, None),
            (11, "Office | Paint", "completed", 80_000, 90_000, "2026-02-01", "2026-02-20", None),
            (12, "Office | Windows", "abandoned", 50_000, None, "2026-01-15", "2026-01-20", None),
            (99, "Deleted project", "ideating", 1_000_000, 1_000_000, None, None, "2026-01-02"),
        ],
    )
    conn.executemany(
        "INSERT INTO quotes (id, project_id, total_cents, deleted_at) VALUES (?, ?, ?, ?)",
        [
            (1, 10, 40_000, None),
            (2, 10, 45_000, None),  # both live quotes count
            (3, 10, 99_000, "2026-01-03"),  # deleted quote ignored
            (4, 11, 85_000, None),
            (5, 12, 48_000, None),
            (6, 99, 500_000, None),  # belongs to deleted project
        ],
    )
    conn.commit()
    conn.close()


class RollupMathTest(unittest.TestCase):
    def test_projected_is_max_quoted_and_paid(self):
        # Old COALESCE(actual, quoted) would spend 40+30=70 and drop the $70 quote.
        # max(quoted, paid) keeps the open quote: 70+30=100.
        roll = compute_rollup(
            [
                {"budget_cents": 100, "actual_cents": 40, "quoted_cents": 70},
                {"budget_cents": 50, "actual_cents": None, "quoted_cents": 30},
                {"budget_cents": None, "actual_cents": None, "quoted_cents": 0},
            ]
        )
        self.assertEqual(roll["budget_cents"], 150)
        self.assertEqual(roll["quoted_cents"], 100)
        self.assertEqual(roll["accepted_quote_cents"], 100)
        self.assertEqual(roll["actual_cents"], 40)
        self.assertEqual(roll["spend_cents"], 100)
        self.assertEqual(roll["projected_cents"], 100)
        self.assertEqual(roll["remaining_vs_budget_cents"], 50)
        self.assertEqual(roll["variance_vs_budget_cents"], -50)
        self.assertEqual(roll["variance_vs_budget_pct"], -33.3)
        self.assertEqual(roll["budget_status"], "on_track")
        self.assertEqual(roll["project_count"], 3)
        self.assertTrue(roll["has_actuals"])

    def test_paid_above_quote_uses_paid(self):
        self.assertEqual(project_projected(90, 70), 90)
        roll = compute_rollup(
            [{"budget_cents": 80, "actual_cents": 90, "quoted_cents": 70}]
        )
        self.assertEqual(roll["spend_cents"], 90)
        self.assertEqual(roll["variance_vs_budget_cents"], 10)
        self.assertEqual(roll["budget_status"], "over_budget")

    def test_no_actuals_uses_quoted(self):
        roll = compute_rollup(
            [
                {"budget_cents": 100, "actual_cents": None, "quoted_cents": 25},
            ]
        )
        self.assertEqual(roll["spend_cents"], 25)
        self.assertEqual(roll["projected_cents"], 25)
        self.assertEqual(roll["remaining_vs_budget_cents"], 75)
        self.assertFalse(roll["has_actuals"])
        self.assertEqual(roll["budget_status"], "on_track")

    def test_zero_budget_with_spend_is_over(self):
        trend = project_trend(0, None, 50)
        self.assertEqual(trend["spend_cents"], 50)
        self.assertEqual(trend["variance_vs_budget_cents"], 50)
        self.assertIsNone(trend["variance_vs_budget_pct"])
        self.assertEqual(trend["budget_status"], "over_budget")

    def test_missing_budget_is_no_budget(self):
        self.assertEqual(budget_status(None, 10), "no_budget")
        trend = project_trend(None, 5, 8)
        self.assertEqual(trend["spend_cents"], 8)
        self.assertIsNone(trend["remaining_vs_budget_cents"])
        self.assertEqual(trend["budget_status"], "no_budget")

    def test_at_risk_at_ninety_percent(self):
        self.assertEqual(budget_status(100, 89), "on_track")
        self.assertEqual(budget_status(100, 90), "at_risk")
        self.assertEqual(budget_status(100, 100), "at_risk")
        self.assertEqual(budget_status(100, 101), "over_budget")


class ProgramsApiTest(unittest.TestCase):
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

        import app.db as dbmod

        self.dbmod = dbmod
        self._old_micasa = dbmod.DB_PATH
        dbmod.DB_PATH = self.micasa_db
        dbmod._initialized_program_paths.discard(self.prog_db)
        dbmod.init_programs_db()

        from fastapi.testclient import TestClient
        from app.main import api

        self.client = TestClient(api)

    def tearDown(self):
        self.dbmod.DB_PATH = self._old_micasa
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_create_with_project_ids_and_rollup(self):
        res = self.client.post(
            "/programs",
            json={
                "name": "Office Reno",
                "description": "test",
                "project_ids": [10, 11, 12],
            },
        )
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(body["name"], "Office Reno")
        self.assertEqual(body["project_count"], 3)
        # budget 2000+800+500 = 3300 dollars → 330000 cents
        self.assertEqual(body["budget_cents"]["cents"], 330_000)
        # quotes: tile 40000+45000, paint 85000, windows 48000 = 218000
        self.assertEqual(body["quoted_cents"]["cents"], 218_000)
        self.assertEqual(body["accepted_quote_cents"]["cents"], 218_000)
        # actuals: 150000 + 90000 (windows null) = 240000
        self.assertEqual(body["actual_cents"]["cents"], 240_000)
        # spend / projected: max(150000,85000)+max(90000,85000)+max(0,48000)=288000
        self.assertEqual(body["spend_cents"]["cents"], 288_000)
        self.assertEqual(body["projected_cents"]["cents"], 288_000)
        self.assertEqual(body["remaining_vs_budget_cents"]["cents"], 42_000)
        self.assertEqual(body["variance_vs_budget_cents"]["cents"], -42_000)
        self.assertEqual(body["budget_status"], "on_track")

        titles = {p["title"] for p in body["projects"]}
        self.assertEqual(titles, {"Office | Tile", "Office | Paint", "Office | Windows"})
        tile = next(p for p in body["projects"] if p["project_id"] == 10)
        self.assertEqual(tile["projected_cents"]["cents"], 150_000)
        self.assertEqual(tile["budget_status"], "on_track")
        paint = next(p for p in body["projects"] if p["project_id"] == 11)
        self.assertEqual(paint["projected_cents"]["cents"], 90_000)
        self.assertEqual(paint["budget_status"], "over_budget")

    def test_soft_deleted_micasa_project_excluded(self):
        res = self.client.post(
            "/programs",
            json={"name": "With deleted", "project_ids": [10, 99]},
        )
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("99", res.json()["detail"])

        res = self.client.post("/programs", json={"name": "Live only", "project_ids": [10]})
        self.assertEqual(res.status_code, 201)
        pid = res.json()["id"]
        # sneak a link to the deleted project directly
        conn = sqlite3.connect(self.prog_db)
        conn.execute(
            "INSERT INTO program_projects (program_id, project_id, sort_order, created_at) VALUES (?,?,0,'now')",
            (pid, 99),
        )
        conn.commit()
        conn.close()
        detail = self.client.get(f"/programs/{pid}").json()
        self.assertEqual(detail["project_count"], 1)
        self.assertEqual(detail["projects"][0]["project_id"], 10)
        # deleted project's $10k budget must not appear
        self.assertEqual(detail["budget_cents"]["cents"], 200_000)

    def test_abandoned_and_completed_still_roll_up(self):
        res = self.client.post(
            "/programs",
            json={"name": "Done work", "project_ids": [11, 12]},
        )
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body["project_count"], 2)
        statuses = {p["status"] for p in body["projects"]}
        self.assertEqual(statuses, {"completed", "abandoned"})
        self.assertEqual(body["budget_cents"]["cents"], 130_000)

    def test_unlink_and_soft_delete_program(self):
        res = self.client.post(
            "/programs",
            json={"name": "Temp", "project_ids": [10, 11]},
        )
        pid = res.json()["id"]
        gone = self.client.delete(f"/programs/{pid}/projects/10")
        self.assertEqual(gone.status_code, 200, gone.text)
        self.assertEqual(gone.json()["project_count"], 1)
        self.assertEqual(gone.json()["projects"][0]["project_id"], 11)

        deleted = self.client.delete(f"/programs/{pid}")
        self.assertEqual(deleted.status_code, 200)
        listing = self.client.get("/programs")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json(), [])
        self.assertEqual(self.client.get(f"/programs/{pid}").status_code, 404)

    def test_add_project_and_list(self):
        res = self.client.post("/programs", json={"name": "Empty"})
        self.assertEqual(res.status_code, 201)
        pid = res.json()["id"]
        added = self.client.post(f"/programs/{pid}/projects", json={"project_id": 10})
        self.assertEqual(added.status_code, 201)
        listing = self.client.get("/programs").json()
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing[0]["project_count"], 1)
        self.assertNotIn("projects", listing[0])

    def test_disabled_returns_404(self):
        os.environ["PROGRAMS_ENABLED"] = "false"
        self.assertEqual(self.client.get("/programs").status_code, 404)
        self.assertEqual(
            self.client.post("/programs", json={"name": "Nope"}).status_code, 404
        )


if __name__ == "__main__":
    unittest.main()
