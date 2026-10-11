"""GET /documents/{id}/raw for stored filenames of any shape. Uses a temp
sqlite file; never touches /data."""

import os
import re
import sqlite3
import tempfile
import unicodedata
import unittest
from urllib.parse import unquote

BODY = b"\x89PNG\r\n\x1a\n\x00\xff"

# (stored file_name, ASCII filename fallback for clients that ignore filename*)
NAMES = [
    ("receipt.pdf", "receipt.pdf"),
    ("Scan%201.pdf", "Scan%201.pdf"),
    ("Fa\u00e7ade.pdf", "Facade.pdf"),
    ("Screenshot 2026-10-11 at 8.03.12\u202fPM.png", "Screenshot 2026-10-11 at 8.03.12 PM.png"),
    ("Quittung f\u00fcr K\u00fcche \u2013 \u53ce\u636e.pdf", "Quittung fur Kuche.pdf"),
    ("Leak under sink \U0001f6b0.jpg", "Leak under sink.jpg"),
    ("\U0001f9fe.pdf", "document.pdf"),
    ('a"b\\c.pdf', "a_b_c.pdf"),
    ("evil\r\nSet-Cookie: x=1.txt", "evil__Set-Cookie: x=1.txt"),
    (None, "document"),
    ("", "document"),
]
DELETED_ID = 101
NO_DATA_ID = 102
BAD_MIME_IDS = (103, 104)

# Greedy, so a quote that leaks into the fallback stays inside the captured value.
DISPOSITION = re.compile(r"inline; filename=\"(.*)\"(?:; filename\*=UTF-8''(\S*))?", re.DOTALL)


def _seed(path):
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT, file_name TEXT, entity_kind TEXT, entity_id INTEGER,
            mime_type TEXT, size_bytes INTEGER, sha256 TEXT, notes TEXT, data BLOB, created_at TEXT, updated_at TEXT,
            deleted_at TEXT)
        """
    )
    rows = [
        (doc_id, file_name, "application/pdf", BODY + bytes([doc_id]), None)
        for doc_id, (file_name, _) in enumerate(NAMES, start=1)
    ]
    rows += [
        (DELETED_ID, "gone.pdf", "application/pdf", BODY, "2026-10-01 00:00:00+00:00"),
        (NO_DATA_ID, "empty.pdf", "application/pdf", None, None),
        (BAD_MIME_IDS[0], "page.html", "text/html\r\nSet-Cookie: x=1", BODY, None),
        (BAD_MIME_IDS[1], "photo.png", "image/\u2603", BODY, None),
    ]
    conn.executemany(
        "INSERT INTO documents (id, file_name, mime_type, data, deleted_at) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    conn.close()


class DocumentRawTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = os.path.join(self.tmp.name, "micasa.db")
        _seed(db_path)

        import app.db as dbmod

        self.dbmod = dbmod
        self._old_db_path = dbmod.DB_PATH
        dbmod.DB_PATH = db_path

        from fastapi.testclient import TestClient
        from app.main import api

        self.client = TestClient(api)

    def tearDown(self):
        self.dbmod.DB_PATH = self._old_db_path
        self.tmp.cleanup()

    def test_every_stored_name_serves_with_an_ascii_disposition(self):
        for doc_id, (file_name, fallback) in enumerate(NAMES, start=1):
            with self.subTest(file_name=file_name):
                res = self.client.get(f"/documents/{doc_id}/raw")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.content, BODY + bytes([doc_id]))

                value = res.headers["content-disposition"]
                self.assertTrue(value.isascii(), value)
                match = DISPOSITION.fullmatch(value)
                self.assertIsNotNone(match, value)
                quoted, encoded = match.groups()
                for ch in '"\\\r\n':
                    self.assertNotIn(ch, quoted)
                self.assertEqual(quoted, fallback)

                exact = "".join(c for c in file_name or "" if unicodedata.category(c) != "Cc")
                if exact.strip():
                    self.assertIsNotNone(encoded, value)
                    self.assertEqual(unquote(encoded, errors="strict"), exact)
                else:
                    self.assertIsNone(encoded, value)

    def test_keeps_type_and_caching_and_adds_nosniff(self):
        res = self.client.get("/documents/1/raw")
        self.assertEqual(res.headers["content-type"], "application/pdf")
        self.assertEqual(res.headers["cache-control"], "public, max-age=3600")
        self.assertEqual(res.headers["x-content-type-options"], "nosniff")

    def test_unsafe_stored_mime_type_serves_as_octet_stream(self):
        for doc_id in BAD_MIME_IDS:
            with self.subTest(doc_id=doc_id):
                res = self.client.get(f"/documents/{doc_id}/raw")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers["content-type"], "application/octet-stream")

    def test_missing_deleted_or_dataless_document_is_404(self):
        for doc_id in (999, DELETED_ID, NO_DATA_ID):
            with self.subTest(doc_id=doc_id):
                self.assertEqual(self.client.get(f"/documents/{doc_id}/raw").status_code, 404)


if __name__ == "__main__":
    unittest.main()
