"""Service log -> maintenance_items.last_serviced_at sync tests. Uses a temp
sqlite file; never touches /data."""

import os
import sqlite3
import tempfile
import unittest

OLD_STAMP = "2026-01-01 00:00:00+00:00"


def _seed_micasa(path):
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE maintenance_categories (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE appliances (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE,
            contact_name TEXT,
            email TEXT,
            phone TEXT,
            website TEXT,
            notes TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE maintenance_items (
            id INTEGER PRIMARY KEY,
            name TEXT,
            category_id INTEGER,
            appliance_id INTEGER,
            last_serviced_at TEXT,
            interval_months INTEGER,
            due_date TEXT,
            manual_url TEXT,
            manual_text TEXT,
            notes TEXT,
            cost_cents INTEGER,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE service_log_entries (
            id INTEGER PRIMARY KEY,
            maintenance_item_id INTEGER,
            serviced_at TEXT,
            vendor_id INTEGER,
            cost_cents INTEGER,
            notes TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE deletion_records (
            id INTEGER PRIMARY KEY,
            entity TEXT,
            target_id INTEGER,
            deleted_at TEXT,
            restored_at TEXT
        );
        INSERT INTO maintenance_categories (id, name) VALUES (1, 'HVAC');
        """
    )
    conn.commit()
    conn.close()


class ServiceLogSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.micasa_db = os.path.join(self.tmp.name, "micasa.db")
        backup_dir = os.path.join(self.tmp.name, "backups")
        _seed_micasa(self.micasa_db)

        import app.db as dbmod

        self.dbmod = dbmod
        self._old_paths = (dbmod.DB_PATH, dbmod.BACKUP_DIR)
        dbmod.DB_PATH = self.micasa_db
        dbmod.BACKUP_DIR = backup_dir

        from fastapi.testclient import TestClient
        from app.main import api

        self.client = TestClient(api)

    def tearDown(self):
        self.dbmod.DB_PATH, self.dbmod.BACKUP_DIR = self._old_paths
        self.tmp.cleanup()

    def _insert_item(self, last_serviced_at):
        conn = sqlite3.connect(self.micasa_db)
        cur = conn.execute(
            """
            INSERT INTO maintenance_items
                (name, category_id, last_serviced_at, interval_months, created_at, updated_at)
            VALUES ('Furnace filter', 1, ?, 3, ?, ?)
            """,
            (last_serviced_at, OLD_STAMP, OLD_STAMP),
        )
        item_id = cur.lastrowid
        conn.commit()
        conn.close()
        return item_id

    def _insert_log(self, item_id, serviced_at, deleted_at=None):
        conn = sqlite3.connect(self.micasa_db)
        cur = conn.execute(
            """
            INSERT INTO service_log_entries
                (maintenance_item_id, serviced_at, notes, created_at, updated_at, deleted_at)
            VALUES (?, ?, '', ?, ?, ?)
            """,
            (item_id, serviced_at, OLD_STAMP, OLD_STAMP, deleted_at),
        )
        log_id = cur.lastrowid
        conn.commit()
        conn.close()
        return log_id

    def _stored(self, item_id):
        """(last_serviced_at, updated_at) exactly as written to micasa.db."""
        conn = sqlite3.connect(self.micasa_db)
        row = conn.execute(
            "SELECT last_serviced_at, updated_at FROM maintenance_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        conn.close()
        return row

    def _add_log(self, item_id, day):
        res = self.client.post(
            "/service-logs", json={"maintenance_item_id": item_id, "serviced_at": day}
        )
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()["id"]

    def _edit_log(self, log_id, day, notes=None):
        res = self.client.put(f"/service-logs/{log_id}", json={"serviced_at": day, "notes": notes})
        self.assertEqual(res.status_code, 200, res.text)

    def _delete_log(self, log_id):
        res = self.client.delete(f"/service-logs/{log_id}")
        self.assertEqual(res.status_code, 200, res.text)

    def test_older_backfilled_log_does_not_rewind_manual_value(self):
        item = self._insert_item("2026-09-01 00:00:00+00:00")
        log_id = self._add_log(item, "2024-05-01")
        self.assertEqual(self._stored(item), ("2026-09-01 00:00:00+00:00", OLD_STAMP))

        self._delete_log(log_id)
        self.assertEqual(self._stored(item), ("2026-09-01 00:00:00+00:00", OLD_STAMP))
        detail = self.client.get(f"/maintenance/{item}").json()
        self.assertEqual(detail["last_serviced_at"], "2026-09-01")
        self.assertEqual(detail["computed_due_date"], "2026-12-01")

    def test_newer_log_advances_value_in_micasa_format(self):
        item = self._insert_item("2026-09-01 00:00:00+00:00")
        self._add_log(item, "2026-10-05")
        last_serviced, updated = self._stored(item)
        self.assertEqual(last_serviced, "2026-10-05 00:00:00+00:00")
        self.assertNotEqual(updated, OLD_STAMP)

    def test_first_log_fills_empty_value(self):
        item = self._insert_item(None)
        self._add_log(item, "2025-03-10")
        self.assertEqual(self._stored(item)[0], "2025-03-10 00:00:00+00:00")

    def test_empty_value_fills_from_newest_live_log(self):
        item = self._insert_item(None)
        self._insert_log(item, "2026-06-01 00:00:00 +0000 UTC")
        self._add_log(item, "2025-01-15")
        self.assertEqual(self._stored(item)[0], "2026-06-01 00:00:00+00:00")

    def test_deleting_only_log_keeps_value_and_due_status(self):
        item = self._insert_item("2026-09-01 00:00:00+00:00")
        log_id = self._add_log(item, "2026-10-05")
        self._delete_log(log_id)

        self.assertEqual(self._stored(item)[0], "2026-10-05 00:00:00+00:00")
        detail = self.client.get(f"/maintenance/{item}").json()
        self.assertEqual(detail["last_serviced_at"], "2026-10-05")
        self.assertIsNotNone(detail["due_status"])

    def test_deleting_newest_log_falls_back_to_next_live_log(self):
        item = self._insert_item(None)
        self._insert_log(item, "2026-03-01 00:00:00 +0000 UTC")
        self._insert_log(item, "2026-05-01 00:00:00+00:00", deleted_at="2026-05-02 00:00:00+00:00")
        self._insert_log(item, "2026-02-01 00:00:00+00:00")
        newest = self._add_log(item, "2026-06-01")
        self.assertEqual(self._stored(item)[0], "2026-06-01 00:00:00+00:00")

        self._delete_log(newest)
        self.assertEqual(self._stored(item)[0], "2026-03-01 00:00:00+00:00")

    def test_editing_source_log_earlier_recomputes_other_logs_do_not(self):
        manual = self._insert_item("2026-09-01 00:00:00+00:00")
        backfill = self._insert_log(manual, "2026-04-01 00:00:00+00:00")
        self._edit_log(backfill, "2026-02-01")
        self.assertEqual(self._stored(manual), ("2026-09-01 00:00:00+00:00", OLD_STAMP))

        item = self._insert_item("2026-06-01 00:00:00+00:00")
        other = self._insert_log(item, "2026-04-01 00:00:00+00:00")
        source = self._insert_log(item, "2026-06-01 00:00:00+00:00")

        self._edit_log(source, "2026-06-01", notes="new filter")
        self._edit_log(other, "2026-02-01")
        self.assertEqual(self._stored(item), ("2026-06-01 00:00:00+00:00", OLD_STAMP))

        self._edit_log(source, "2026-05-01")
        self.assertEqual(self._stored(item)[0], "2026-05-01 00:00:00+00:00")

        self._edit_log(source, "2026-01-01")
        self.assertEqual(self._stored(item)[0], "2026-02-01 00:00:00+00:00")

    def test_other_stored_formats_compare_by_day(self):
        rfc3339 = self._insert_item("2026-09-01T00:00:00Z")
        self._add_log(rfc3339, "2026-08-15")
        self._add_log(rfc3339, "2026-09-01")
        self.assertEqual(self._stored(rfc3339), ("2026-09-01T00:00:00Z", OLD_STAMP))

        go_style = self._insert_item("2026-09-01 00:00:00 +0000 UTC")
        self._add_log(go_style, "2026-09-01")
        self.assertEqual(self._stored(go_style), ("2026-09-01 00:00:00 +0000 UTC", OLD_STAMP))

        self._add_log(rfc3339, "2026-09-02")
        self.assertEqual(self._stored(rfc3339)[0], "2026-09-02 00:00:00+00:00")

    def test_source_log_matches_current_value_across_formats(self):
        item = self._insert_item("2026-09-01T00:00:00Z")
        self._insert_log(item, "2026-07-01 00:00:00 +0000 UTC")
        source = self._insert_log(item, "2026-09-01 00:00:00+00:00")

        self._edit_log(source, "2026-06-01")
        self.assertEqual(self._stored(item)[0], "2026-07-01 00:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
