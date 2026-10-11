import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query, Response
from pydantic import BaseModel
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    get_conn,
    get_write_conn,
    rows_to_dicts,
    parse_dt,
    to_iso_date,
    add_months,
    backup_db,
    now_utc_str,
    today_utc_date_str,
    date_only_str,
    get_opex_conn,
    opex_feature_on,
    init_programs_db,
    is_programs_available,
)
from .programs import router as programs_router


@asynccontextmanager
async def _lifespan(_app):
    init_programs_db()
    yield


app = FastAPI(title="micasa web", description="Read-only micasa home-maintenance API", lifespan=_lifespan)

api = FastAPI(title="micasa API")

STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")

UPCOMING_WINDOW_DAYS = 30


# Valid micasa project status enum values.
VALID_STATUSES = {
    "ideating",
    "planned",
    "quoted",
    "underway",
    "delayed",
    "completed",
    "abandoned",
}


class ProjectCreate(BaseModel):
    title: str
    project_type_id: int | None = None
    status: str | None = "ideating"
    description: str | None = None
    budget_dollars: float | None = None
    start_date: str | None = None
    end_date: str | None = None


class StatusUpdate(BaseModel):
    status: str


class ProjectUpdate(BaseModel):
    # Full-ish update of an existing project's editable fields. All fields are
    # optional in the request; the frontend edit modal sends every field, and
    # empty/null clears the optional numeric/date fields. Title stays required.
    title: str | None = None
    project_type_id: int | None = None
    status: str | None = None
    description: str | None = None
    budget_dollars: float | None = None
    actual_dollars: float | None = None
    start_date: str | None = None
    end_date: str | None = None


class QuoteCreate(BaseModel):
    # Mirrors micasa's Quote model exactly. project_id + vendor_id are REQUIRED
    # (FK ON DELETE RESTRICT, must reference live parents). total is required and
    # INDEPENDENT of the components (micasa does NOT derive it); labor/materials/
    # other are optional. received_date optional date; notes optional text.
    project_id: int | None = None
    vendor_id: int | None = None
    total_dollars: float | None = None
    labor_dollars: float | None = None
    materials_dollars: float | None = None
    other_dollars: float | None = None
    received_date: str | None = None
    notes: str | None = None


class QuoteUpdate(BaseModel):
    # micasa allows reassigning a quote's project on edit (its edit form exposes
    # the Project select and UpdateQuote persists it), so project_id is editable.
    project_id: int | None = None
    vendor_id: int | None = None
    total_dollars: float | None = None
    labor_dollars: float | None = None
    materials_dollars: float | None = None
    other_dollars: float | None = None
    received_date: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Money helper: expose both cents and dollars for consistency.
# ---------------------------------------------------------------------------
def money(cents):
    if cents is None:
        return None
    return {"cents": int(cents), "dollars": round(int(cents) / 100.0, 2)}


def expand_money(d, fields):
    for f in fields:
        if f in d:
            d[f] = money(d.get(f))
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@api.get("/health")
def health():
    try:
        conn = get_conn()
        conn.execute("SELECT 1").fetchone()
        # confirm the connection is truly read-only
        readonly = True
        try:
            conn.execute("CREATE TABLE __probe__ (x)")
            readonly = False
        except Exception:
            readonly = True
        conn.close()
        return {
            "status": "healthy",
            "db": "ok",
            "read_only": readonly,
            "programs_enabled": is_programs_available(),
            "opex_enabled": opex_feature_on(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"unhealthy: {e}")


@api.get("/house")
def house():
    conn = get_conn()
    row = conn.execute("SELECT * FROM house_profiles ORDER BY id LIMIT 1").fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="no house profile")
    d = dict(row)
    d = expand_money(d, ["property_tax_cents", "hoa_fee_cents"])
    d["insurance_renewal"] = to_iso_date(d.get("insurance_renewal"))
    return d


@api.get("/projects")
def projects():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT p.*, pt.name AS project_type_name,
               (SELECT COUNT(*) FROM quotes q
                  WHERE q.project_id = p.id AND q.deleted_at IS NULL) AS quote_count
        FROM projects p
        LEFT JOIN project_types pt ON pt.id = p.project_type_id
        WHERE p.deleted_at IS NULL
        ORDER BY COALESCE(p.start_date, p.created_at) DESC, p.id DESC
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["budget_cents", "actual_cents"])
        d["start_date"] = to_iso_date(d.get("start_date"))
        d["end_date"] = to_iso_date(d.get("end_date"))
        out.append(d)
    return out


@api.get("/projects/{project_id}")
def project_detail(project_id: int):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT p.*, pt.name AS project_type_name
        FROM projects p
        LEFT JOIN project_types pt ON pt.id = p.project_type_id
        WHERE p.id = ? AND p.deleted_at IS NULL
        """,
        (project_id,),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="project not found")
    d = dict(row)
    d = expand_money(d, ["budget_cents", "actual_cents"])
    d["start_date"] = to_iso_date(d.get("start_date"))
    d["end_date"] = to_iso_date(d.get("end_date"))

    quotes = conn.execute(
        """
        SELECT q.*, v.name AS vendor_name
        FROM quotes q
        LEFT JOIN vendors v ON v.id = q.vendor_id
        WHERE q.project_id = ? AND q.deleted_at IS NULL
        ORDER BY q.total_cents ASC
        """,
        (project_id,),
    ).fetchall()
    qout = []
    for q in quotes:
        qd = dict(q)
        qd = expand_money(qd, ["total_cents", "labor_cents", "materials_cents", "other_cents"])
        qd["received_date"] = to_iso_date(qd.get("received_date"))
        qout.append(qd)
    d["quotes"] = qout

    docs = conn.execute(
        """
        SELECT id, title, file_name, mime_type, size_bytes, notes
        FROM documents
        WHERE deleted_at IS NULL AND entity_kind = 'project' AND entity_id = ?
        ORDER BY id
        """,
        (project_id,),
    ).fetchall()
    d["documents"] = rows_to_dicts(docs)
    conn.close()
    return d


# ---------------------------------------------------------------------------
# WRITE endpoints (the only two mutations in the app). Every write is
# preceded by a successful auto-backup; if the backup fails, we abort.
# ---------------------------------------------------------------------------
def _fetch_project_row(conn, project_id):
    """Return a single project row in the SAME shape as GET /api/projects."""
    row = conn.execute(
        """
        SELECT p.*, pt.name AS project_type_name,
               (SELECT COUNT(*) FROM quotes q
                  WHERE q.project_id = p.id AND q.deleted_at IS NULL) AS quote_count
        FROM projects p
        LEFT JOIN project_types pt ON pt.id = p.project_type_id
        WHERE p.id = ? AND p.deleted_at IS NULL
        """,
        (project_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["budget_cents", "actual_cents"])
    d["start_date"] = to_iso_date(d.get("start_date"))
    d["end_date"] = to_iso_date(d.get("end_date"))
    return d


@api.get("/project-types")
def project_types():
    conn = get_conn()
    # project_types has no deleted_at column; handle gracefully.
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(project_types)").fetchall()}
    where = "WHERE deleted_at IS NULL" if "deleted_at" in cols else ""
    rows = conn.execute(
        f"SELECT id, name FROM project_types {where} ORDER BY name"
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


@api.post("/projects", status_code=201)
def create_project(payload: ProjectCreate):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    status = (payload.status or "ideating").strip().lower()
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid status '{status}'; must be one of {sorted(VALID_STATUSES)}",
        )

    try:
        start_date = date_only_str(payload.start_date)
        end_date = date_only_str(payload.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    budget_cents = None
    if payload.budget_dollars is not None:
        try:
            budget_cents = int(round(float(payload.budget_dollars) * 100))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="budget_dollars must be a number")

    description = payload.description if payload.description not in ("", None) else None
    project_type_id = payload.project_type_id

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO projects
                (title, project_type_id, status, description,
                 start_date, end_date, budget_cents, actual_cents,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
            """,
            (title, project_type_id, status, description,
             start_date, end_date, budget_cents, now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_project_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.patch("/projects/{project_id}/status")
def update_project_status(project_id: int, payload: StatusUpdate):
    status = (payload.status or "").strip().lower()
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid status '{status}'; must be one of {sorted(VALID_STATUSES)}",
        )

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id, end_date FROM projects WHERE id = ? AND deleted_at IS NULL",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")

        # Auto-stamp end_date when moving into a terminal status and none set.
        if status in ("completed", "abandoned") and not row["end_date"]:
            conn.execute(
                "UPDATE projects SET status = ?, end_date = ?, updated_at = ? WHERE id = ?",
                (status, today_utc_date_str(), now, project_id),
            )
        else:
            conn.execute(
                "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
                (status, now, project_id),
            )
        conn.commit()
        result = _fetch_project_row(conn, project_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


def _dollars_to_cents(value, field):
    """Convert a dollars float to integer cents, or None to clear."""
    if value is None:
        return None
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a number")


@api.put("/projects/{project_id}")
def update_project(project_id: int, payload: ProjectUpdate):
    """Update an existing project's editable fields. Matches micasa's own
    update semantics: preserve id/created_at/deleted_at, refresh updated_at,
    and only touch fields micasa itself stores. Empty/null clears optional
    numeric/date fields; title must stay non-empty."""
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    status = (payload.status or "").strip().lower()
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid status '{status}'; must be one of {sorted(VALID_STATUSES)}",
        )

    try:
        start_date = date_only_str(payload.start_date)
        end_date = date_only_str(payload.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    budget_cents = _dollars_to_cents(payload.budget_dollars, "budget_dollars")
    actual_cents = _dollars_to_cents(payload.actual_dollars, "actual_dollars")

    description = payload.description if payload.description not in ("", None) else None
    project_type_id = payload.project_type_id

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")

        # Auto-stamp end_date when entering a terminal status with none set --
        # identical behavior to PATCH /projects/{id}/status. A user-provided
        # end_date is respected (non-empty end_date wins).
        if status in ("completed", "abandoned") and not end_date:
            end_date = today_utc_date_str()

        conn.execute(
            """
            UPDATE projects
               SET title = ?, project_type_id = ?, status = ?, description = ?,
                   start_date = ?, end_date = ?, budget_cents = ?, actual_cents = ?,
                   updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (title, project_type_id, status, description,
             start_date, end_date, budget_cents, actual_cents, now, project_id),
        )
        conn.commit()
        result = _fetch_project_row(conn, project_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/projects/{project_id}")
def delete_project(project_id: int):
    """SOFT delete, exactly like micasa's DeleteProject: refuse if the project
    still has active (non-deleted) quotes, otherwise set deleted_at (and
    updated_at) and record a deletion_records row for undo parity. Never
    hard-deletes the row."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="project not found")

        # micasa blocks deleting a project that still has active quotes.
        active_quotes = conn.execute(
            "SELECT COUNT(*) FROM quotes WHERE project_id = ? AND deleted_at IS NULL",
            (project_id,),
        ).fetchone()[0]
        if active_quotes > 0:
            raise HTTPException(
                status_code=400,
                detail=f"project has {active_quotes} active quote(s) -- delete them first",
            )

        conn.execute(
            "UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, project_id),
        )
        # Mirror micasa: record the soft-delete for undo history.
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('project', ?, ?, NULL)",
            (project_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": project_id}


@api.get("/quotes")
def quotes():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT q.*, v.name AS vendor_name, p.title AS project_title
        FROM quotes q
        LEFT JOIN vendors v ON v.id = q.vendor_id
        LEFT JOIN projects p ON p.id = q.project_id
        WHERE q.deleted_at IS NULL
        ORDER BY q.id DESC
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["total_cents", "labor_cents", "materials_cents", "other_cents"])
        d["received_date"] = to_iso_date(d.get("received_date"))
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# QUOTE write endpoints. Mirror the project write endpoints' safety pattern:
# auto-backup-before-write-or-abort, get_write_conn, short transaction,
# set created_at/updated_at, soft-delete via deleted_at + deletion_records.
#
# Data model matches micasa v1.52.0 (internal/data/models.go Quote):
#   project_id (FK RESTRICT, required, live), vendor_id (FK RESTRICT, required,
#   live), total_cents (required, INDEPENDENT -- micasa does NOT derive it from
#   the components; see internal/app/forms.go parseQuoteFormData which parses
#   total via ParseRequiredCents and labor/materials/other via ParseOptionalCents),
#   labor/materials/other_cents (optional), received_date (optional date),
#   notes (optional text, blank stored as "").
# ---------------------------------------------------------------------------
def _fetch_quote_row(conn, quote_id):
    """Return a single quote row in the SAME shape as GET /api/quotes."""
    row = conn.execute(
        """
        SELECT q.*, v.name AS vendor_name, p.title AS project_title
        FROM quotes q
        LEFT JOIN vendors v ON v.id = q.vendor_id
        LEFT JOIN projects p ON p.id = q.project_id
        WHERE q.id = ? AND q.deleted_at IS NULL
        """,
        (quote_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["total_cents", "labor_cents", "materials_cents", "other_cents"])
    d["received_date"] = to_iso_date(d.get("received_date"))
    return d


def _require_live_project(conn, project_id):
    """Replicate micasa's requireParentAlive(Project): reject if the project is
    missing (404) or soft-deleted (400)."""
    if project_id is None:
        raise HTTPException(status_code=400, detail="project_id is required")
    row = conn.execute(
        "SELECT id, deleted_at FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    if row["deleted_at"] is not None:
        raise HTTPException(
            status_code=400,
            detail=f"project {project_id} is deleted -- restore it first",
        )


def _require_live_vendor(conn, vendor_id):
    """Replicate micasa's requireParentAlive(Vendor): reject if the vendor is
    missing (404) or soft-deleted (400)."""
    if vendor_id is None:
        raise HTTPException(status_code=400, detail="vendor_id is required")
    row = conn.execute(
        "SELECT id, deleted_at FROM vendors WHERE id = ?", (vendor_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"vendor {vendor_id} not found")
    if row["deleted_at"] is not None:
        raise HTTPException(
            status_code=400,
            detail=f"vendor {vendor_id} is deleted -- restore it first",
        )


@api.post("/quotes", status_code=201)
def create_quote(payload: QuoteCreate):
    """Create a quote attached to a live project + live vendor. total is
    required and independent; labor/materials/other optional. Matches micasa's
    parse semantics (money via cents, received_date optional, notes blank->"")."""
    if payload.project_id is None:
        raise HTTPException(status_code=400, detail="project_id is required")
    if payload.vendor_id is None:
        raise HTTPException(status_code=400, detail="vendor_id is required")
    if payload.total_dollars is None:
        raise HTTPException(status_code=400, detail="total is required")

    total_cents = _dollars_to_cents(payload.total_dollars, "total_dollars")
    labor_cents = _dollars_to_cents(payload.labor_dollars, "labor_dollars")
    materials_cents = _dollars_to_cents(payload.materials_dollars, "materials_dollars")
    other_cents = _dollars_to_cents(payload.other_dollars, "other_dollars")
    if any(c is not None and c < 0 for c in (total_cents, labor_cents, materials_cents, other_cents)):
        raise HTTPException(status_code=400, detail="money values must not be negative")

    try:
        received_date = date_only_str(payload.received_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="received_date must be YYYY-MM-DD")

    # micasa stores notes as a trimmed string, blank -> "" (not NULL).
    notes = (payload.notes or "").strip()

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        # requireParentAlive for BOTH parents, exactly like micasa's restore path.
        _require_live_project(conn, payload.project_id)
        _require_live_vendor(conn, payload.vendor_id)

        cur = conn.execute(
            """
            INSERT INTO quotes
                (project_id, vendor_id, total_cents, labor_cents, materials_cents,
                 other_cents, received_date, notes, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (payload.project_id, payload.vendor_id, total_cents, labor_cents,
             materials_cents, other_cents, received_date, notes, now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_quote_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/quotes/{quote_id}")
def update_quote(quote_id: int, payload: QuoteUpdate):
    """Update an existing quote's editable fields. micasa allows reassigning the
    project (its edit form exposes Project + UpdateQuote persists it), so
    project_id is editable here too; both parents must be live. Preserve
    id/created_at/deleted_at, bump updated_at."""
    if payload.project_id is None:
        raise HTTPException(status_code=400, detail="project_id is required")
    if payload.vendor_id is None:
        raise HTTPException(status_code=400, detail="vendor_id is required")
    if payload.total_dollars is None:
        raise HTTPException(status_code=400, detail="total is required")

    total_cents = _dollars_to_cents(payload.total_dollars, "total_dollars")
    labor_cents = _dollars_to_cents(payload.labor_dollars, "labor_dollars")
    materials_cents = _dollars_to_cents(payload.materials_dollars, "materials_dollars")
    other_cents = _dollars_to_cents(payload.other_dollars, "other_dollars")
    if any(c is not None and c < 0 for c in (total_cents, labor_cents, materials_cents, other_cents)):
        raise HTTPException(status_code=400, detail="money values must not be negative")

    try:
        received_date = date_only_str(payload.received_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="received_date must be YYYY-MM-DD")

    notes = (payload.notes or "").strip()

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM quotes WHERE id = ? AND deleted_at IS NULL",
            (quote_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="quote not found")

        _require_live_project(conn, payload.project_id)
        _require_live_vendor(conn, payload.vendor_id)

        conn.execute(
            """
            UPDATE quotes
               SET project_id = ?, vendor_id = ?, total_cents = ?, labor_cents = ?,
                   materials_cents = ?, other_cents = ?, received_date = ?, notes = ?,
                   updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (payload.project_id, payload.vendor_id, total_cents, labor_cents,
             materials_cents, other_cents, received_date, notes, now, quote_id),
        )
        conn.commit()
        result = _fetch_quote_row(conn, quote_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/quotes/{quote_id}")
def delete_quote(quote_id: int):
    """SOFT delete, exactly like micasa's DeleteQuote -> softDelete(&Quote{},
    DeletionEntityQuote, id): set deleted_at and insert a deletion_records row
    with entity='quote', target_id=id, restored_at=NULL. Never hard-deletes."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM quotes WHERE id = ? AND deleted_at IS NULL",
            (quote_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="quote not found")

        conn.execute(
            "UPDATE quotes SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, quote_id),
        )
        # Mirror micasa's softDelete: record the soft-delete for undo history.
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('quote', ?, ?, NULL)",
            (quote_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": quote_id}


def _compute_due(item):
    """Return (due_iso, status) where status in overdue/upcoming/ok/None."""
    due = parse_dt(item.get("due_date"))
    if due is None:
        last = parse_dt(item.get("last_serviced_at"))
        interval = item.get("interval_months")
        if last is not None and interval:
            due = add_months(last, interval)
    if due is None:
        return None, None
    if isinstance(due, datetime):
        due = due.date()
    today = date.today()
    if due < today:
        status = "overdue"
    elif due <= today + timedelta(days=UPCOMING_WINDOW_DAYS):
        status = "upcoming"
    else:
        status = "ok"
    return due.isoformat(), status


@api.get("/maintenance")
def maintenance():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT m.*, c.name AS category_name, a.name AS appliance_name
        FROM maintenance_items m
        LEFT JOIN maintenance_categories c ON c.id = m.category_id
        LEFT JOIN appliances a ON a.id = m.appliance_id
        WHERE m.deleted_at IS NULL
        ORDER BY m.name
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["cost_cents"])
        due_iso, status = _compute_due(d)
        d["computed_due_date"] = due_iso
        d["due_status"] = status
        d["last_serviced_at"] = to_iso_date(d.get("last_serviced_at"))
        d["due_date"] = to_iso_date(d.get("due_date"))
        out.append(d)
    # sort: overdue first, then upcoming, then rest by due date
    order = {"overdue": 0, "upcoming": 1, "ok": 2, None: 3}
    out.sort(key=lambda x: (order.get(x["due_status"], 3), x.get("computed_due_date") or "9999"))
    return out


@api.get("/maintenance/overdue")
def maintenance_overdue():
    """Read-only list of overdue maintenance items, mirroring the same
    due-date logic the Maintenance tab uses (see _compute_due). Overdue =
    computed_due_date < today. An item never serviced but with an interval set
    still has no due date and is NOT overdue; matches the tab, which only flags
    items whose computed_due_date is in the past. Returns items sorted most
    overdue first, plus enough for the notification drawer to render."""
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT m.*, c.name AS category_name, a.name AS appliance_name
        FROM maintenance_items m
        LEFT JOIN maintenance_categories c ON c.id = m.category_id
        LEFT JOIN appliances a ON a.id = m.appliance_id
        WHERE m.deleted_at IS NULL
        ORDER BY m.name
        """
    ).fetchall()
    conn.close()
    today = date.today()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["cost_cents"])
        due_iso, status = _compute_due(d)
        if status != "overdue":
            continue
        due = date.fromisoformat(due_iso)
        out.append(
            {
                "id": d["id"],
                "name": d.get("name"),
                "category_name": d.get("category_name"),
                "appliance_name": d.get("appliance_name"),
                "last_serviced_at": to_iso_date(d.get("last_serviced_at")),
                "interval_months": d.get("interval_months"),
                "next_due": due_iso,
                "due_status": status,
                "days_overdue": (today - due).days,
            }
        )
    # Most overdue first.
    out.sort(key=lambda x: x["days_overdue"], reverse=True)
    return {"count": len(out), "items": out}


@api.get("/maintenance/{item_id}")
def maintenance_detail(item_id: int):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT m.*, c.name AS category_name, a.name AS appliance_name
        FROM maintenance_items m
        LEFT JOIN maintenance_categories c ON c.id = m.category_id
        LEFT JOIN appliances a ON a.id = m.appliance_id
        WHERE m.id = ? AND m.deleted_at IS NULL
        """,
        (item_id,),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="maintenance item not found")
    d = dict(row)
    d = expand_money(d, ["cost_cents"])
    due_iso, status = _compute_due(d)
    d["computed_due_date"] = due_iso
    d["due_status"] = status
    d["last_serviced_at"] = to_iso_date(d.get("last_serviced_at"))
    d["due_date"] = to_iso_date(d.get("due_date"))

    history = conn.execute(
        """
        SELECT s.*, v.name AS vendor_name
        FROM service_log_entries s
        LEFT JOIN vendors v ON v.id = s.vendor_id
        WHERE s.maintenance_item_id = ? AND s.deleted_at IS NULL
        ORDER BY s.serviced_at DESC
        """,
        (item_id,),
    ).fetchall()
    hout = []
    for h in history:
        hd = dict(h)
        hd = expand_money(hd, ["cost_cents"])
        hd["serviced_at"] = to_iso_date(hd.get("serviced_at"))
        hout.append(hd)
    d["service_log"] = hout
    conn.close()
    return d


@api.get("/incidents")
def incidents(status: str = Query("open", pattern="^(open|all)$")):
    conn = get_conn()
    if status == "open":
        where = "i.deleted_at IS NULL"
    else:
        where = "1=1"
    rows = conn.execute(
        f"""
        SELECT i.*, a.name AS appliance_name, v.name AS vendor_name
        FROM incidents i
        LEFT JOIN appliances a ON a.id = i.appliance_id
        LEFT JOIN vendors v ON v.id = i.vendor_id
        WHERE {where}
        ORDER BY
            CASE i.severity WHEN 'urgent' THEN 0 WHEN 'soon' THEN 1 WHEN 'whenever' THEN 2 ELSE 3 END,
            COALESCE(i.date_noticed, i.created_at) DESC
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["cost_cents"])
        d["date_noticed"] = to_iso_date(d.get("date_noticed"))
        d["date_resolved"] = to_iso_date(d.get("date_resolved"))
        # resolved if soft-deleted or has a resolution date
        d["resolved"] = bool(d.get("deleted_at")) or bool(d.get("date_resolved"))
        out.append(d)
    return out


@api.get("/appliances")
def appliances():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM appliances WHERE deleted_at IS NULL ORDER BY name"
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["cost_cents"])
        d["purchase_date"] = to_iso_date(d.get("purchase_date"))
        d["warranty_expiry"] = to_iso_date(d.get("warranty_expiry"))
        out.append(d)
    return out


@api.get("/vendors")
def vendors():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT v.*,
          (SELECT COUNT(*) FROM quotes q WHERE q.vendor_id = v.id AND q.deleted_at IS NULL) AS quote_count,
          (SELECT COUNT(*) FROM service_log_entries s WHERE s.vendor_id = v.id AND s.deleted_at IS NULL) AS service_count,
          (SELECT COUNT(*) FROM incidents i WHERE i.vendor_id = v.id AND i.deleted_at IS NULL) AS incident_count
        FROM vendors v
        WHERE v.deleted_at IS NULL
        ORDER BY v.name
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["job_count"] = (d.get("quote_count") or 0) + (d.get("service_count") or 0) + (d.get("incident_count") or 0)
        out.append(d)
    return out



# ---------------------------------------------------------------------------
# VENDOR write endpoints. Mirror micasa v1.52.0 (models.go Vendor +
# store.go CreateVendor/UpdateVendor/DeleteVendor, forms.go
# parseVendorFormData). Fields: name (required, UNIQUE index spanning all rows
# including soft-deleted -- so a duplicate name errors), contact_name, email,
# phone, website, notes (all optional, stored trimmed, blank -> ""). Delete is
# a SOFT delete that micasa BLOCKS when the vendor still has active quotes or
# active incidents (NOT service logs); on success it soft-deletes and records a
# deletion_records row (entity='vendor').
# ---------------------------------------------------------------------------
class VendorCreate(BaseModel):
    name: str
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    website: str | None = None
    notes: str | None = None


class VendorUpdate(BaseModel):
    name: str | None = None
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    website: str | None = None
    notes: str | None = None


def _fetch_vendor_row(conn, vendor_id):
    """Return a single vendor row in the SAME shape as GET /api/vendors."""
    row = conn.execute(
        """
        SELECT v.*,
          (SELECT COUNT(*) FROM quotes q WHERE q.vendor_id = v.id AND q.deleted_at IS NULL) AS quote_count,
          (SELECT COUNT(*) FROM service_log_entries s WHERE s.vendor_id = v.id AND s.deleted_at IS NULL) AS service_count,
          (SELECT COUNT(*) FROM incidents i WHERE i.vendor_id = v.id AND i.deleted_at IS NULL) AS incident_count
        FROM vendors v
        WHERE v.id = ? AND v.deleted_at IS NULL
        """,
        (vendor_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["job_count"] = (d.get("quote_count") or 0) + (d.get("service_count") or 0) + (d.get("incident_count") or 0)
    return d


@api.post("/vendors", status_code=201)
def create_vendor(payload: VendorCreate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    # micasa stores the optional fields trimmed, blank -> "" (not NULL).
    contact_name = (payload.contact_name or "").strip()
    email = (payload.email or "").strip()
    phone = (payload.phone or "").strip()
    website = (payload.website or "").strip()
    notes = (payload.notes or "").strip()

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO vendors
                (name, contact_name, email, phone, website, notes,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (name, contact_name, email, phone, website, notes, now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_vendor_row(conn, new_id)
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=400, detail=f"a vendor named '{name}' already exists")
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/vendors/{vendor_id}")
def update_vendor(vendor_id: int, payload: VendorUpdate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    contact_name = (payload.contact_name or "").strip()
    email = (payload.email or "").strip()
    phone = (payload.phone or "").strip()
    website = (payload.website or "").strip()
    notes = (payload.notes or "").strip()

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL",
            (vendor_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="vendor not found")

        conn.execute(
            """
            UPDATE vendors
               SET name = ?, contact_name = ?, email = ?, phone = ?,
                   website = ?, notes = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (name, contact_name, email, phone, website, notes, now, vendor_id),
        )
        conn.commit()
        result = _fetch_vendor_row(conn, vendor_id)
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=400, detail=f"a vendor named '{name}' already exists")
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/vendors/{vendor_id}")
def delete_vendor(vendor_id: int):
    """SOFT delete, exactly like micasa's DeleteVendor: refuse if the vendor
    still has active (non-deleted) quotes or incidents (service logs do NOT
    block, matching micasa), otherwise set deleted_at and record a
    deletion_records row (entity='vendor')."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL",
            (vendor_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="vendor not found")

        active_quotes = conn.execute(
            "SELECT COUNT(*) FROM quotes WHERE vendor_id = ? AND deleted_at IS NULL",
            (vendor_id,),
        ).fetchone()[0]
        if active_quotes > 0:
            raise HTTPException(
                status_code=400,
                detail=f"vendor has {active_quotes} active quote(s) -- delete them first",
            )
        active_incidents = conn.execute(
            "SELECT COUNT(*) FROM incidents WHERE vendor_id = ? AND deleted_at IS NULL",
            (vendor_id,),
        ).fetchone()[0]
        if active_incidents > 0:
            raise HTTPException(
                status_code=400,
                detail=f"vendor has {active_incidents} active incident(s) -- delete them first",
            )

        conn.execute(
            "UPDATE vendors SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, vendor_id),
        )
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('vendor', ?, ?, NULL)",
            (vendor_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": vendor_id}



# ---------------------------------------------------------------------------
# APPLIANCE write endpoints. Mirror micasa v1.52.0 (models.go Appliance +
# store.go CreateAppliance/UpdateAppliance/DeleteAppliance, forms.go
# parseApplianceFormData). Fields: name (required), brand, model_number,
# serial_number, location, notes (optional strings, trimmed, blank -> ""),
# purchase_date + warranty_expiry (optional dates), cost_cents (optional).
# Delete is a SOFT delete that micasa BLOCKS when the appliance still has
# active maintenance items or active incidents; on success it soft-deletes and
# records a deletion_records row (entity='appliance').
# ---------------------------------------------------------------------------
class ApplianceCreate(BaseModel):
    name: str
    brand: str | None = None
    model_number: str | None = None
    serial_number: str | None = None
    purchase_date: str | None = None
    warranty_expiry: str | None = None
    location: str | None = None
    cost_dollars: float | None = None
    notes: str | None = None


class ApplianceUpdate(BaseModel):
    name: str | None = None
    brand: str | None = None
    model_number: str | None = None
    serial_number: str | None = None
    purchase_date: str | None = None
    warranty_expiry: str | None = None
    location: str | None = None
    cost_dollars: float | None = None
    notes: str | None = None


def _fetch_appliance_row(conn, appliance_id):
    """Return a single appliance row in the SAME shape as GET /api/appliances."""
    row = conn.execute(
        "SELECT * FROM appliances WHERE id = ? AND deleted_at IS NULL",
        (appliance_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["cost_cents"])
    d["purchase_date"] = to_iso_date(d.get("purchase_date"))
    d["warranty_expiry"] = to_iso_date(d.get("warranty_expiry"))
    return d


@api.post("/appliances", status_code=201)
def create_appliance(payload: ApplianceCreate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    brand = (payload.brand or "").strip()
    model_number = (payload.model_number or "").strip()
    serial_number = (payload.serial_number or "").strip()
    location = (payload.location or "").strip()
    notes = (payload.notes or "").strip()

    try:
        purchase_date = date_only_str(payload.purchase_date)
        warranty_expiry = date_only_str(payload.warranty_expiry)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO appliances
                (name, brand, model_number, serial_number, purchase_date,
                 warranty_expiry, location, cost_cents, notes,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (name, brand, model_number, serial_number, purchase_date,
             warranty_expiry, location, cost_cents, notes, now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_appliance_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/appliances/{appliance_id}")
def update_appliance(appliance_id: int, payload: ApplianceUpdate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    brand = (payload.brand or "").strip()
    model_number = (payload.model_number or "").strip()
    serial_number = (payload.serial_number or "").strip()
    location = (payload.location or "").strip()
    notes = (payload.notes or "").strip()

    try:
        purchase_date = date_only_str(payload.purchase_date)
        warranty_expiry = date_only_str(payload.warranty_expiry)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM appliances WHERE id = ? AND deleted_at IS NULL",
            (appliance_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="appliance not found")

        conn.execute(
            """
            UPDATE appliances
               SET name = ?, brand = ?, model_number = ?, serial_number = ?,
                   purchase_date = ?, warranty_expiry = ?, location = ?,
                   cost_cents = ?, notes = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (name, brand, model_number, serial_number, purchase_date,
             warranty_expiry, location, cost_cents, notes, now, appliance_id),
        )
        conn.commit()
        result = _fetch_appliance_row(conn, appliance_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/appliances/{appliance_id}")
def delete_appliance(appliance_id: int):
    """SOFT delete, exactly like micasa's DeleteAppliance: refuse if the
    appliance still has active (non-deleted) maintenance items or incidents,
    otherwise set deleted_at and record a deletion_records row
    (entity='appliance')."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM appliances WHERE id = ? AND deleted_at IS NULL",
            (appliance_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="appliance not found")

        active_maint = conn.execute(
            "SELECT COUNT(*) FROM maintenance_items WHERE appliance_id = ? AND deleted_at IS NULL",
            (appliance_id,),
        ).fetchone()[0]
        if active_maint > 0:
            raise HTTPException(
                status_code=400,
                detail=f"appliance has {active_maint} active maintenance item(s) -- delete or reassign them first",
            )
        active_incidents = conn.execute(
            "SELECT COUNT(*) FROM incidents WHERE appliance_id = ? AND deleted_at IS NULL",
            (appliance_id,),
        ).fetchone()[0]
        if active_incidents > 0:
            raise HTTPException(
                status_code=400,
                detail=f"appliance has {active_incidents} active incident(s) -- delete them first",
            )

        conn.execute(
            "UPDATE appliances SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, appliance_id),
        )
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('appliance', ?, ?, NULL)",
            (appliance_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": appliance_id}



# ---------------------------------------------------------------------------
# MAINTENANCE CATEGORIES (read-only lookup for the maintenance form's Category
# picker). Mirrors micasa's MaintenanceCategories() ordering (name ASC).
# maintenance_categories has no deleted_at column.
# ---------------------------------------------------------------------------
@api.get("/maintenance-categories")
def maintenance_categories():
    conn = get_conn()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(maintenance_categories)").fetchall()}
    where = "WHERE deleted_at IS NULL" if "deleted_at" in cols else ""
    rows = conn.execute(
        f"SELECT id, name FROM maintenance_categories {where} ORDER BY name"
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


# ---------------------------------------------------------------------------
# MAINTENANCE ITEM write endpoints. Mirror micasa v1.52.0 (models.go
# MaintenanceItem + store.go CreateMaintenance/UpdateMaintenance/
# DeleteMaintenance, forms.go parseMaintenanceFormData). Fields:
#   name (required), category_id (required uint FK RESTRICT -> live category),
#   appliance_id (optional FK, SET NULL -> live appliance), last_serviced_at
#   (optional date), schedule is MUTUALLY EXCLUSIVE: interval_months XOR
#   due_date XOR none (micasa's schedule selector only parses one; the other is
#   left zero/nil), manual_url, manual_text, notes (optional strings, trimmed),
#   cost_cents (optional). Delete is a SOFT delete that micasa BLOCKS when the
#   item still has active service log entries; on success it soft-deletes and
#   records a deletion_records row (entity='maintenance').
# ---------------------------------------------------------------------------
class MaintenanceCreate(BaseModel):
    name: str
    category_id: int | None = None
    appliance_id: int | None = None
    last_serviced_at: str | None = None
    interval_months: int | None = None
    due_date: str | None = None
    manual_url: str | None = None
    manual_text: str | None = None
    cost_dollars: float | None = None
    notes: str | None = None


class MaintenanceUpdate(BaseModel):
    name: str | None = None
    category_id: int | None = None
    appliance_id: int | None = None
    last_serviced_at: str | None = None
    interval_months: int | None = None
    due_date: str | None = None
    manual_url: str | None = None
    manual_text: str | None = None
    cost_dollars: float | None = None
    notes: str | None = None



class ServiceLogCreate(BaseModel):
    # Mirrors micasa ServiceLogEntry + forms.go parseServiceLogFormData.
    # CreateServiceLog inserts a service_log_entries row and optionally
    # find-or-creates a vendor; it does NOT update maintenance_items.last_serviced_at.
    maintenance_item_id: int
    serviced_at: str  # required YYYY-MM-DD
    vendor_id: int | None = None
    cost_dollars: float | None = None
    notes: str | None = None


class ServiceLogUpdate(BaseModel):
    # maintenance_item_id is fixed to the parent item (prefer keep fixed).
    serviced_at: str  # required YYYY-MM-DD
    vendor_id: int | None = None
    cost_dollars: float | None = None
    notes: str | None = None


def _fetch_maintenance_row(conn, item_id):
    """Return a single maintenance item in the SAME shape as GET /api/maintenance."""
    row = conn.execute(
        """
        SELECT m.*, c.name AS category_name, a.name AS appliance_name
        FROM maintenance_items m
        LEFT JOIN maintenance_categories c ON c.id = m.category_id
        LEFT JOIN appliances a ON a.id = m.appliance_id
        WHERE m.id = ? AND m.deleted_at IS NULL
        """,
        (item_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["cost_cents"])
    due_iso, status = _compute_due(d)
    d["computed_due_date"] = due_iso
    d["due_status"] = status
    d["last_serviced_at"] = to_iso_date(d.get("last_serviced_at"))
    d["due_date"] = to_iso_date(d.get("due_date"))
    return d


def _require_live_category(conn, category_id):
    """maintenance_items.category_id is a required FK (RESTRICT). Reject a
    missing category. maintenance_categories has no soft-delete column."""
    if category_id is None:
        raise HTTPException(status_code=400, detail="category is required")
    row = conn.execute(
        "SELECT id FROM maintenance_categories WHERE id = ?", (category_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")


def _require_live_appliance(conn, appliance_id):
    """Optional appliance link; if provided, must reference a live appliance."""
    if appliance_id is None:
        return
    row = conn.execute(
        "SELECT id, deleted_at FROM appliances WHERE id = ?", (appliance_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"appliance {appliance_id} not found")
    if row["deleted_at"] is not None:
        raise HTTPException(
            status_code=400,
            detail=f"appliance {appliance_id} is deleted -- restore it first",
        )


def _resolve_schedule(interval_months, due_date_raw):
    """Enforce micasa's mutually-exclusive schedule: interval XOR due date.
    Returns (interval_months_int, due_date_stored) with the unused side zeroed/
    nulled. interval_months defaults to 0 (non-recurring), due_date to NULL."""
    interval = 0
    due_date = None
    has_interval = interval_months not in (None, 0)
    has_due = due_date_raw not in (None, "")
    if has_interval and has_due:
        raise HTTPException(
            status_code=400,
            detail="set interval or due date, not both",
        )
    if has_interval:
        if interval_months < 0:
            raise HTTPException(status_code=400, detail="interval_months must not be negative")
        interval = int(interval_months)
    elif has_due:
        try:
            due_date = date_only_str(due_date_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="due_date must be YYYY-MM-DD")
    return interval, due_date


@api.post("/maintenance", status_code=201)
def create_maintenance(payload: MaintenanceCreate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if payload.category_id is None:
        raise HTTPException(status_code=400, detail="category is required")

    try:
        last_serviced = date_only_str(payload.last_serviced_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="last_serviced_at must be YYYY-MM-DD")

    interval, due_date = _resolve_schedule(payload.interval_months, payload.due_date)

    manual_url = (payload.manual_url or "").strip()
    manual_text = (payload.manual_text or "").strip()
    notes = (payload.notes or "").strip()
    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        _require_live_category(conn, payload.category_id)
        _require_live_appliance(conn, payload.appliance_id)

        cur = conn.execute(
            """
            INSERT INTO maintenance_items
                (name, category_id, appliance_id, last_serviced_at, interval_months,
                 due_date, manual_url, manual_text, notes, cost_cents,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (name, payload.category_id, payload.appliance_id, last_serviced, interval,
             due_date, manual_url, manual_text, notes, cost_cents, now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_maintenance_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/maintenance/{item_id}")
def update_maintenance(item_id: int, payload: MaintenanceUpdate):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if payload.category_id is None:
        raise HTTPException(status_code=400, detail="category is required")

    try:
        last_serviced = date_only_str(payload.last_serviced_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="last_serviced_at must be YYYY-MM-DD")

    interval, due_date = _resolve_schedule(payload.interval_months, payload.due_date)

    manual_url = (payload.manual_url or "").strip()
    manual_text = (payload.manual_text or "").strip()
    notes = (payload.notes or "").strip()
    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM maintenance_items WHERE id = ? AND deleted_at IS NULL",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="maintenance item not found")

        _require_live_category(conn, payload.category_id)
        _require_live_appliance(conn, payload.appliance_id)

        conn.execute(
            """
            UPDATE maintenance_items
               SET name = ?, category_id = ?, appliance_id = ?, last_serviced_at = ?,
                   interval_months = ?, due_date = ?, manual_url = ?, manual_text = ?,
                   notes = ?, cost_cents = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (name, payload.category_id, payload.appliance_id, last_serviced, interval,
             due_date, manual_url, manual_text, notes, cost_cents, now, item_id),
        )
        conn.commit()
        result = _fetch_maintenance_row(conn, item_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/maintenance/{item_id}")
def delete_maintenance(item_id: int):
    """SOFT delete, exactly like micasa's DeleteMaintenance: refuse if the item
    still has active (non-deleted) service log entries, otherwise set deleted_at
    and record a deletion_records row (entity='maintenance')."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id FROM maintenance_items WHERE id = ? AND deleted_at IS NULL",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="maintenance item not found")

        active_logs = conn.execute(
            "SELECT COUNT(*) FROM service_log_entries WHERE maintenance_item_id = ? AND deleted_at IS NULL",
            (item_id,),
        ).fetchone()[0]
        if active_logs > 0:
            raise HTTPException(
                status_code=400,
                detail=f"maintenance item has {active_logs} service log(s) -- delete them first",
            )

        conn.execute(
            "UPDATE maintenance_items SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, item_id),
        )
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('maintenance', ?, ?, NULL)",
            (item_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": item_id}


# ---------------------------------------------------------------------------
# SERVICE LOG write endpoints. Mirror micasa v1.52.0 (models.go ServiceLogEntry
# + store.go CreateServiceLog/UpdateServiceLog/DeleteServiceLog, forms.go
# openServiceLogForm / parseServiceLogFormData).
#
# Fields: maintenance_item_id (required on create, fixed on update), serviced_at
# (required date), vendor_id (optional, live vendor if set), cost_cents
# (optional), notes (optional text, blank -> "").
#
# STRICT: Create/Update MUST NOT touch maintenance_items.last_serviced_at.
# Soft-delete entity name for deletion_records: "service_log"
# (DeletionEntityServiceLog).
# ---------------------------------------------------------------------------
def _fetch_service_log_row(conn, log_id):
    """Return a single service log row with vendor_name + expanded cost."""
    row = conn.execute(
        """
        SELECT s.*, v.name AS vendor_name
        FROM service_log_entries s
        LEFT JOIN vendors v ON v.id = s.vendor_id
        WHERE s.id = ? AND s.deleted_at IS NULL
        """,
        (log_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["cost_cents"])
    d["serviced_at"] = to_iso_date(d.get("serviced_at"))
    return d


def _require_live_maintenance_item(conn, item_id):
    """Reject missing (404) or soft-deleted (400) maintenance items."""
    if item_id is None:
        raise HTTPException(status_code=400, detail="maintenance_item_id is required")
    row = conn.execute(
        "SELECT id, deleted_at FROM maintenance_items WHERE id = ?", (item_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"maintenance item {item_id} not found")
    if row["deleted_at"] is not None:
        raise HTTPException(
            status_code=400,
            detail=f"maintenance item {item_id} is deleted -- restore it first",
        )


def _require_optional_live_vendor(conn, vendor_id):
    """Vendor is optional on service logs; if provided, must be alive."""
    if vendor_id is None:
        return
    row = conn.execute(
        "SELECT id, deleted_at FROM vendors WHERE id = ?", (vendor_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"vendor {vendor_id} not found")
    if row["deleted_at"] is not None:
        raise HTTPException(
            status_code=400,
            detail=f"vendor {vendor_id} is deleted -- restore it first",
        )


@api.get("/service-logs")
def list_service_logs(maintenance_item_id: int = Query(...)):
    """Optional list of active service logs for one maintenance item."""
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT s.*, v.name AS vendor_name
        FROM service_log_entries s
        LEFT JOIN vendors v ON v.id = s.vendor_id
        WHERE s.maintenance_item_id = ? AND s.deleted_at IS NULL
        ORDER BY s.serviced_at DESC, s.id DESC
        """,
        (maintenance_item_id,),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d = expand_money(d, ["cost_cents"])
        d["serviced_at"] = to_iso_date(d.get("serviced_at"))
        out.append(d)
    return out


def _sync_last_serviced_from_logs(conn, maintenance_item_id: int) -> None:
    """Recompute maintenance_items.last_serviced_at from active service logs.

    Sets last_serviced_at to the newest serviced_at among non-deleted logs for
    this item, or NULL if there are none. Due dates derived from
    last_serviced_at + interval then roll automatically. Called after every
    service-log create/update/delete.

    NOTE: intentional UX convenience beyond stock micasa, which keeps
    last_serviced_at and service_log_entries independent.
    """
    row = conn.execute(
        """
        SELECT MAX(serviced_at) AS newest
          FROM service_log_entries
         WHERE maintenance_item_id = ? AND deleted_at IS NULL
        """,
        (maintenance_item_id,),
    ).fetchone()
    newest = row["newest"] if row else None
    if newest is not None:
        newest = str(newest)[:10]
    conn.execute(
        """
        UPDATE maintenance_items
           SET last_serviced_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL
        """,
        (newest, now_utc_str(), maintenance_item_id),
    )


@api.post("/service-logs", status_code=201)
def create_service_log(payload: ServiceLogCreate):
    """Insert a service_log_entries row. Does NOT update last_serviced_at."""
    if payload.maintenance_item_id is None:
        raise HTTPException(status_code=400, detail="maintenance_item_id is required")
    if not (payload.serviced_at or "").strip():
        raise HTTPException(status_code=400, detail="serviced_at is required")

    try:
        serviced_at = date_only_str(payload.serviced_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="serviced_at must be YYYY-MM-DD")
    if serviced_at is None:
        raise HTTPException(status_code=400, detail="serviced_at is required")

    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # micasa stores notes trimmed; blank -> "" (not NULL).
    notes = (payload.notes or "").strip()
    vendor_id = payload.vendor_id

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        _require_live_maintenance_item(conn, payload.maintenance_item_id)
        _require_optional_live_vendor(conn, vendor_id)

        cur = conn.execute(
            """
            INSERT INTO service_log_entries
                (maintenance_item_id, serviced_at, vendor_id, cost_cents, notes,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (payload.maintenance_item_id, serviced_at, vendor_id, cost_cents, notes, now, now),
        )
        new_id = cur.lastrowid
        _sync_last_serviced_from_logs(conn, payload.maintenance_item_id)
        conn.commit()
        result = _fetch_service_log_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/service-logs/{log_id}")
def update_service_log(log_id: int, payload: ServiceLogUpdate):
    """Update an existing service log. Parent maintenance_item_id stays fixed.
    Does NOT touch maintenance_items.last_serviced_at."""
    if not (payload.serviced_at or "").strip():
        raise HTTPException(status_code=400, detail="serviced_at is required")

    try:
        serviced_at = date_only_str(payload.serviced_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="serviced_at must be YYYY-MM-DD")
    if serviced_at is None:
        raise HTTPException(status_code=400, detail="serviced_at is required")

    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    notes = (payload.notes or "").strip()
    vendor_id = payload.vendor_id

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id, maintenance_item_id FROM service_log_entries WHERE id = ? AND deleted_at IS NULL",
            (log_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="service log not found")

        parent_id = row["maintenance_item_id"]
        _require_optional_live_vendor(conn, vendor_id)

        conn.execute(
            """
            UPDATE service_log_entries
               SET serviced_at = ?, vendor_id = ?, cost_cents = ?, notes = ?,
                   updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (serviced_at, vendor_id, cost_cents, notes, now, log_id),
        )
        _sync_last_serviced_from_logs(conn, parent_id)
        conn.commit()
        result = _fetch_service_log_row(conn, log_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/service-logs/{log_id}")
def delete_service_log(log_id: int):
    """SOFT delete, exactly like micasa's DeleteServiceLog -> softDelete(
    &ServiceLogEntry{}, DeletionEntityServiceLog, id): set deleted_at and
    insert a deletion_records row with entity='service_log'."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id, maintenance_item_id FROM service_log_entries WHERE id = ? AND deleted_at IS NULL",
            (log_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="service log not found")

        conn.execute(
            "UPDATE service_log_entries SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, log_id),
        )
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('service_log', ?, ?, NULL)",
            (log_id, now),
        )
        _sync_last_serviced_from_logs(conn, row["maintenance_item_id"])
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": log_id}



# ---------------------------------------------------------------------------
# INCIDENT write endpoints. Mirror micasa v1.52.0 (models.go Incident +
# store.go CreateIncident/UpdateIncident/DeleteIncident, forms.go
# parseIncidentFormData). Fields:
#   title (required), description (optional), status (ENUM: only 'open' or
#   'in_progress' -- there is NO 'resolved' status value in micasa),
#   severity (ENUM: 'urgent' | 'soon' | 'whenever'), date_noticed (REQUIRED
#   date), date_resolved (optional date), location, notes (optional strings),
#   cost_cents (optional), appliance_id + vendor_id (optional FKs, SET NULL,
#   must reference LIVE rows). An incident is marked RESOLVED by setting
#   date_resolved AND soft-deleting it (deleted_at) -- that hides it from the
#   active list but keeps history. Delete/resolve records a deletion_records
#   row (entity='incident'); micasa's DeleteIncident has NO dependent guard.
# ---------------------------------------------------------------------------
VALID_INCIDENT_STATUSES = {"open", "in_progress"}
VALID_INCIDENT_SEVERITIES = {"urgent", "soon", "whenever"}


class IncidentCreate(BaseModel):
    title: str
    description: str | None = None
    status: str | None = "open"
    severity: str | None = "soon"
    date_noticed: str | None = None
    date_resolved: str | None = None
    location: str | None = None
    cost_dollars: float | None = None
    appliance_id: int | None = None
    vendor_id: int | None = None
    notes: str | None = None


class IncidentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    severity: str | None = None
    date_noticed: str | None = None
    date_resolved: str | None = None
    location: str | None = None
    cost_dollars: float | None = None
    appliance_id: int | None = None
    vendor_id: int | None = None
    notes: str | None = None


def _fetch_incident_row(conn, incident_id):
    """Return a single incident in the SAME shape as GET /api/incidents,
    including soft-deleted (resolved) rows so a resolve action can echo back."""
    row = conn.execute(
        """
        SELECT i.*, a.name AS appliance_name, v.name AS vendor_name
        FROM incidents i
        LEFT JOIN appliances a ON a.id = i.appliance_id
        LEFT JOIN vendors v ON v.id = i.vendor_id
        WHERE i.id = ?
        """,
        (incident_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d = expand_money(d, ["cost_cents"])
    d["date_noticed"] = to_iso_date(d.get("date_noticed"))
    d["date_resolved"] = to_iso_date(d.get("date_resolved"))
    d["resolved"] = bool(d.get("deleted_at")) or bool(d.get("date_resolved"))
    return d


def _validate_incident_enums(status, severity):
    if status not in VALID_INCIDENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid status '{status}'; must be one of {sorted(VALID_INCIDENT_STATUSES)}",
        )
    if severity not in VALID_INCIDENT_SEVERITIES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid severity '{severity}'; must be one of {sorted(VALID_INCIDENT_SEVERITIES)}",
        )


@api.post("/incidents", status_code=201)
def create_incident(payload: IncidentCreate):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    status = (payload.status or "open").strip().lower()
    severity = (payload.severity or "soon").strip().lower()
    _validate_incident_enums(status, severity)

    # date_noticed is REQUIRED in micasa (ParseRequiredDate).
    if not (payload.date_noticed or "").strip():
        raise HTTPException(status_code=400, detail="date_noticed is required")
    try:
        date_noticed = date_only_str(payload.date_noticed)
        date_resolved = date_only_str(payload.date_resolved)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    description = (payload.description or "").strip()
    location = (payload.location or "").strip()
    notes = (payload.notes or "").strip()
    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        if payload.appliance_id is not None:
            _require_live_appliance(conn, payload.appliance_id)
        if payload.vendor_id is not None:
            _require_live_vendor(conn, payload.vendor_id)

        cur = conn.execute(
            """
            INSERT INTO incidents
                (title, description, status, severity, date_noticed, date_resolved,
                 location, cost_cents, appliance_id, vendor_id, notes,
                 created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (title, description, status, severity, date_noticed, date_resolved,
             location, cost_cents, payload.appliance_id, payload.vendor_id, notes,
             now, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        result = _fetch_incident_row(conn, new_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        conn.close()
    return result


@api.put("/incidents/{incident_id}")
def update_incident(incident_id: int, payload: IncidentUpdate):
    """Update an incident's editable fields. Editing does NOT change the
    deleted_at flag (an active incident stays active); to RESOLVE an incident
    use DELETE (which sets date_resolved + deleted_at). Status is restricted to
    open/in_progress; setting date_resolved here alone is allowed (matches
    micasa's edit form which exposes a Date resolved field) but does not hide
    the incident -- only a soft-delete does."""
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    status = (payload.status or "").strip().lower()
    severity = (payload.severity or "").strip().lower()
    _validate_incident_enums(status, severity)

    if not (payload.date_noticed or "").strip():
        raise HTTPException(status_code=400, detail="date_noticed is required")
    try:
        date_noticed = date_only_str(payload.date_noticed)
        date_resolved = date_only_str(payload.date_resolved)
    except ValueError:
        raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD")

    description = (payload.description or "").strip()
    location = (payload.location or "").strip()
    notes = (payload.notes or "").strip()
    cost_cents = _dollars_to_cents(payload.cost_dollars, "cost_dollars")
    if cost_cents is not None and cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost must not be negative")

    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        # Edit operates on the active (non-deleted) incident.
        row = conn.execute(
            "SELECT id FROM incidents WHERE id = ? AND deleted_at IS NULL",
            (incident_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="incident not found")

        if payload.appliance_id is not None:
            _require_live_appliance(conn, payload.appliance_id)
        if payload.vendor_id is not None:
            _require_live_vendor(conn, payload.vendor_id)

        conn.execute(
            """
            UPDATE incidents
               SET title = ?, description = ?, status = ?, severity = ?,
                   date_noticed = ?, date_resolved = ?, location = ?, cost_cents = ?,
                   appliance_id = ?, vendor_id = ?, notes = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (title, description, status, severity, date_noticed, date_resolved,
             location, cost_cents, payload.appliance_id, payload.vendor_id, notes,
             now, incident_id),
        )
        conn.commit()
        result = _fetch_incident_row(conn, incident_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        conn.close()
    return result


@api.delete("/incidents/{incident_id}")
def delete_incident(incident_id: int, resolve: bool = Query(False)):
    """SOFT delete, exactly like micasa's DeleteIncident -> softDelete(&Incident{},
    DeletionEntityIncident, id): set deleted_at and insert a deletion_records
    row (entity='incident'). micasa has NO dependent guard for incidents.

    RESOLVE semantics: in micasa an incident is marked resolved by setting
    date_resolved AND soft-deleting it. Passing ?resolve=true stamps
    date_resolved (today, UTC) when it isn't already set, then soft-deletes --
    matching micasa's 'resolve = date_resolved + hide from active list'."""
    # AUTO-BACKUP BEFORE WRITE. Abort on any failure.
    try:
        backup_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")

    now = now_utc_str()
    conn = get_write_conn()
    try:
        row = conn.execute(
            "SELECT id, date_resolved FROM incidents WHERE id = ? AND deleted_at IS NULL",
            (incident_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="incident not found")

        if resolve and not row["date_resolved"]:
            conn.execute(
                "UPDATE incidents SET date_resolved = ?, deleted_at = ?, updated_at = ? WHERE id = ?",
                (today_utc_date_str(), now, now, incident_id),
            )
        else:
            conn.execute(
                "UPDATE incidents SET deleted_at = ?, updated_at = ? WHERE id = ?",
                (now, now, incident_id),
            )
        conn.execute(
            "INSERT INTO deletion_records (entity, target_id, deleted_at, restored_at) "
            "VALUES ('incident', ?, ?, NULL)",
            (incident_id, now),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        conn.close()
    return {"ok": True, "id": incident_id, "resolved": bool(resolve)}


@api.get("/documents")
def documents():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, title, file_name, entity_kind, entity_id, mime_type,
               size_bytes, sha256, notes, created_at, updated_at
        FROM documents
        WHERE deleted_at IS NULL
        ORDER BY id
        """
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        d["created_at"] = to_iso_date(d.get("created_at"))
        d["updated_at"] = to_iso_date(d.get("updated_at"))
        d["is_image"] = bool(d.get("mime_type") and str(d["mime_type"]).startswith("image/"))
        out.append(d)
    return out


@api.get("/documents/{doc_id}/raw")
def document_raw(doc_id: int):
    conn = get_conn()
    row = conn.execute(
        "SELECT mime_type, file_name, data FROM documents WHERE id = ? AND deleted_at IS NULL",
        (doc_id,),
    ).fetchone()
    conn.close()
    if not row or row["data"] is None:
        raise HTTPException(status_code=404, detail="document not found")
    mime = row["mime_type"] or "application/octet-stream"
    headers = {
        "Content-Disposition": f'inline; filename="{row["file_name"] or "document"}"',
        "Cache-Control": "public, max-age=3600",
    }
    return Response(content=bytes(row["data"]), media_type=mime, headers=headers)


# ---------------------------------------------------------------------------
# Home OpEx endpoints — read the standalone OpEx snapshot DB (read-only).
# Completely independent of micasa data. See db.get_opex_conn / opex_pull.py.
# ---------------------------------------------------------------------------
def _first_of_month(d):
    return date(d.year, d.month, 1)


def _shift_month(d, delta):
    m = d.month - 1 + delta
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, 1)


def _opex_period_range(period):
    """Return (start_month, end_month) as first-of-month date objects
    (inclusive) for the requested period, based on today's UTC date."""
    today = datetime.now(timezone.utc).date()
    tm = _first_of_month(today)
    if period == "this_month":
        return tm, tm
    if period == "last_month":
        lm = _shift_month(tm, -1)
        return lm, lm
    if period == "this_year":
        return date(today.year, 1, 1), date(today.year, 12, 1)
    if period == "last_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 1)
    if period == "trailing_12":
        return _shift_month(tm, -11), tm
    raise HTTPException(status_code=400, detail=f"invalid period '{period}'")


VALID_OPEX_PERIODS = {"this_month", "last_month", "this_year", "last_year", "trailing_12"}


def _require_opex():
    if not opex_feature_on():
        raise HTTPException(status_code=404, detail="opex disabled")


@api.get("/opex/summary")
def opex_summary(period: str = Query("trailing_12")):
    _require_opex()
    if period not in VALID_OPEX_PERIODS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid period '{period}'; must be one of {sorted(VALID_OPEX_PERIODS)}",
        )
    start, end = _opex_period_range(period)
    start_s, end_s = start.isoformat(), end.isoformat()

    empty = {
        "period": period,
        "start_month": start_s,
        "end_month": end_s,
        "no_data": True,
        "months": 0,
        "total_cents": 0,
        "fixed_cents": 0,
        "variable_cents": 0,
        "monthly_burn_cents": 0,
        "annualized_cents": 0,
        "by_category": [],
        "pulled_at": None,
    }

    conn = get_opex_conn()
    if conn is None:
        return empty
    try:
        rows = conn.execute(
            """
            SELECT category_id, category_name, bucket,
                   SUM(amount_cents) AS total_cents
            FROM opex_monthly
            WHERE month >= ? AND month <= ?
            GROUP BY category_id, category_name, bucket
            ORDER BY total_cents DESC
            """,
            (start_s, end_s),
        ).fetchall()
        months = conn.execute(
            "SELECT COUNT(DISTINCT month) AS n FROM opex_monthly WHERE month >= ? AND month <= ?",
            (start_s, end_s),
        ).fetchone()["n"]
        pulled = conn.execute("SELECT MAX(pulled_at) AS p FROM opex_monthly").fetchone()["p"]
    finally:
        conn.close()

    if not rows or not months:
        return empty

    by_category = []
    total = fixed = variable = 0
    for r in rows:
        c = int(r["total_cents"] or 0)
        total += c
        if r["bucket"] == "FIXED":
            fixed += c
        else:
            variable += c
        by_category.append(
            {
                "category_id": r["category_id"],
                "category_name": r["category_name"],
                "bucket": r["bucket"],
                "total_cents": c,
            }
        )

    monthly_burn = round(total / months)
    return {
        "period": period,
        "start_month": start_s,
        "end_month": end_s,
        "no_data": False,
        "months": months,
        "total_cents": total,
        "fixed_cents": fixed,
        "variable_cents": variable,
        "monthly_burn_cents": monthly_burn,
        "annualized_cents": monthly_burn * 12,
        "by_category": by_category,
        "pulled_at": pulled,
    }


@api.get("/opex/series")
def opex_series():
    """Monthly totals across all months in the DB, split by bucket and by
    category, for charting the trend."""
    _require_opex()
    conn = get_opex_conn()
    if conn is None:
        return {"no_data": True, "months": [], "categories": [], "pulled_at": None}
    try:
        rows = conn.execute(
            """
            SELECT month, category_id, category_name, bucket, amount_cents
            FROM opex_monthly
            ORDER BY month ASC, category_name ASC
            """
        ).fetchall()
        pulled = conn.execute("SELECT MAX(pulled_at) AS p FROM opex_monthly").fetchone()["p"]
    finally:
        conn.close()

    if not rows:
        return {"no_data": True, "months": [], "categories": [], "pulled_at": None}

    # Stable category ordering (by name) for the frontend legend/series.
    cats = {}
    for r in rows:
        cats.setdefault(r["category_id"], {"category_id": r["category_id"], "category_name": r["category_name"], "bucket": r["bucket"]})
    categories = sorted(cats.values(), key=lambda c: c["category_name"])

    months = {}
    for r in rows:
        m = months.setdefault(
            r["month"],
            {"month": r["month"], "fixed_cents": 0, "variable_cents": 0, "total_cents": 0, "by_category": {}},
        )
        c = int(r["amount_cents"] or 0)
        m["total_cents"] += c
        if r["bucket"] == "FIXED":
            m["fixed_cents"] += c
        else:
            m["variable_cents"] += c
        m["by_category"][r["category_id"]] = c

    month_list = [months[k] for k in sorted(months.keys())]
    return {
        "no_data": False,
        "months": month_list,
        "categories": categories,
        "pulled_at": pulled,
    }


# Web-only Programs layer (separate sqlite). 404s when PROGRAMS_ENABLED is
# false or the programs DB cannot be created — see db.is_programs_available.
api.include_router(programs_router)


# Mount the API under /api
app.mount("/api", api)


# ---------------------------------------------------------------------------
# Serve the built frontend (same-origin). SPA fallback to index.html.
# ---------------------------------------------------------------------------
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

IMMUTABLE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
}


def _apply_cache_headers(response):
    """Force no-cache on HTML (index.html / SPA fallback) so the browser
    never serves a stale shell pointing at old asset hashes. Hashed assets
    (their filenames change per build) get long-lived immutable caching."""
    content_type = response.headers.get("content-type", "")
    if content_type.startswith("text/html"):
        for k, v in NO_CACHE_HEADERS.items():
            response.headers[k] = v
    elif "immutable" not in response.headers.get("cache-control", ""):
        # Hashed static assets under /assets etc. are safe to cache forever.
        for k, v in IMMUTABLE_HEADERS.items():
            response.headers[k] = v
    return response


if os.path.isdir(STATIC_DIR):
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path, scope):
            try:
                response = await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404:
                    return _apply_cache_headers(
                        await super().get_response("index.html", scope)
                    )
                raise
            if response.status_code == 404:
                return _apply_cache_headers(
                    await super().get_response("index.html", scope)
                )
            return _apply_cache_headers(response)

    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="static")
