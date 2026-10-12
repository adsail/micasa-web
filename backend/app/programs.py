"""Web-only Programs layer + budget rollup.

Programs live in a separate sqlite DB (see db.programs_db_path). They group
existing micasa `projects.id` values — this module never writes micasa.db and
does not invent parent/child project semantics.

Remaining vs budget
-------------------
Per live (non-deleted) child project:
    quoted_cents = SUM(quotes.total_cents) WHERE quotes.deleted_at IS NULL
    paid = actual_cents or 0
    projected = spend = max(quoted, paid)
    remaining = budget_cents - spend
    variance = spend - budget_cents

`max(quoted, paid)` is paid plus any unpaid quote (not COALESCE(actual, quoted)).
COALESCE treated a recorded payment as the final cost and dropped a larger
quote, so program spend undercounted deposits against still-open quotes.

Program totals sum those per-project figures (null budgets ignored in the
budget sum; spend uses 0 when both paid and quoted are missing).

Abandoned and completed projects still roll up (they are real costs). Soft-
deleted micasa projects are excluded.

budget_status: no_budget (budget is null), over_budget (projected > budget),
at_risk (projected is at least 90% of a positive budget), else on_track.
A $0 budget is intentional; any positive projected spend is over_budget.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .db import (
    backup_programs_db,
    get_conn,
    get_programs_conn,
    is_programs_available,
    now_utc_str,
    to_iso_date,
)

router = APIRouter()


class ProgramCreate(BaseModel):
    name: str
    description: str | None = None
    project_ids: list[int] | None = None


class ProgramUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProgramProjectAdd(BaseModel):
    project_id: int
    sort_order: int | None = None


def _money(cents):
    if cents is None:
        return None
    return {"cents": int(cents), "dollars": round(int(cents) / 100.0, 2)}


def _as_cents(value):
    return 0 if value is None else int(value)


def project_projected(actual_cents, quoted_cents):
    """Committed / projected final for one project: max(quoted, paid).

    A missing paid or quote is 0. This equals paid plus remaining quote, and
    stays at paid when paid already exceeds the quote.
    """
    return max(_as_cents(actual_cents), _as_cents(quoted_cents))


AT_RISK_PCT = 90


def budget_status(budget_cents, projected_cents):
    if budget_cents is None:
        return "no_budget"
    budget = int(budget_cents)
    projected = _as_cents(projected_cents)
    if projected > budget:
        return "over_budget"
    if budget > 0 and projected * 100 >= budget * AT_RISK_PCT:
        return "at_risk"
    return "on_track"


def variance_pct(budget_cents, variance_cents):
    """(projected - budget) / budget * 100. None when budget is missing or 0."""
    if budget_cents is None or int(budget_cents) == 0 or variance_cents is None:
        return None
    return round(int(variance_cents) / int(budget_cents) * 100.0, 1)


def project_trend(budget_cents, actual_cents, quoted_cents):
    """Per-project (or rolled-up) spend, projection, variance, and status."""
    projected = project_projected(actual_cents, quoted_cents)
    remaining = (int(budget_cents) - projected) if budget_cents is not None else None
    variance = (projected - int(budget_cents)) if budget_cents is not None else None
    return {
        "spend_cents": projected,
        "projected_cents": projected,
        "remaining_vs_budget_cents": remaining,
        "variance_vs_budget_cents": variance,
        "variance_vs_budget_pct": variance_pct(budget_cents, variance),
        "budget_status": budget_status(budget_cents, projected),
    }


def _require_programs():
    if not is_programs_available():
        raise HTTPException(status_code=404, detail="programs disabled")


def _backup_or_abort():
    """Back up programs.db or raise HTTP 500. Call it inside the route's try,
    after every check that can refuse the request and immediately before the
    first write, so refused requests leave no copy."""
    try:
        backup_programs_db()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"backup failed, write aborted: {e}")


def _placeholders(ids):
    return ",".join("?" * len(ids))


def compute_rollup(projects):
    """Roll up a list of per-project money dicts.

    Each item may have budget_cents, actual_cents, quoted_cents (ints or None).
    spend / projected per row = max(quoted or 0, paid or 0).
    """
    budget_sum = 0
    quoted_sum = 0
    actual_sum = 0
    spend_sum = 0
    has_actual = False
    has_budget = False
    for p in projects:
        budget = p.get("budget_cents")
        actual = p.get("actual_cents")
        quoted = p.get("quoted_cents")
        if budget is not None:
            budget_sum += int(budget)
            has_budget = True
        if quoted:
            quoted_sum += int(quoted)
        if actual is not None:
            actual_sum += int(actual)
            has_actual = True
        spend_sum += project_projected(actual, quoted)
    # budget_cents stays a numeric sum (0 when no child set a budget) so
    # existing clients keep seeing a money object. Status is no_budget only
    # when every child budget is null. A stored $0 budget is intentional.
    program_budget = budget_sum if has_budget else None
    remaining = (program_budget - spend_sum) if program_budget is not None else None
    variance = (spend_sum - program_budget) if program_budget is not None else None
    return {
        "project_count": len(projects),
        "budget_cents": budget_sum,
        "quoted_cents": quoted_sum,
        "accepted_quote_cents": quoted_sum,
        "actual_cents": actual_sum,
        "spend_cents": spend_sum,
        "projected_cents": spend_sum,
        "remaining_vs_budget_cents": remaining,
        "variance_vs_budget_cents": variance,
        "variance_vs_budget_pct": variance_pct(program_budget, variance),
        "budget_status": budget_status(program_budget, spend_sum),
        "has_actuals": has_actual,
    }


def _expand_rollup(rollup):
    out = {
        "project_count": rollup["project_count"],
        "has_actuals": rollup["has_actuals"],
        "budget_status": rollup["budget_status"],
        "variance_vs_budget_pct": rollup["variance_vs_budget_pct"],
    }
    for key in (
        "budget_cents",
        "quoted_cents",
        "accepted_quote_cents",
        "actual_cents",
        "spend_cents",
        "projected_cents",
        "remaining_vs_budget_cents",
        "variance_vs_budget_cents",
    ):
        out[key] = _money(rollup[key])
    return out


def _load_micasa_projects(project_ids):
    """Return {id: project_dict} for live (non-deleted) micasa projects.

    Includes abandoned/completed. Soft-deleted rows are omitted.
    quoted_cents is the sum of all non-deleted quotes' total_cents.
    """
    if not project_ids:
        return {}
    ids = list(dict.fromkeys(int(i) for i in project_ids))
    ph = _placeholders(ids)
    conn = get_conn()
    try:
        rows = conn.execute(
            f"""
            SELECT id, title, status, budget_cents, actual_cents,
                   start_date, end_date
              FROM projects
             WHERE id IN ({ph}) AND deleted_at IS NULL
            """,
            ids,
        ).fetchall()
        quote_rows = conn.execute(
            f"""
            SELECT project_id, COALESCE(SUM(total_cents), 0) AS quoted_cents
              FROM quotes
             WHERE project_id IN ({ph}) AND deleted_at IS NULL
             GROUP BY project_id
            """,
            ids,
        ).fetchall()
    finally:
        conn.close()

    quoted_by = {int(r["project_id"]): int(r["quoted_cents"] or 0) for r in quote_rows}
    out = {}
    for r in rows:
        d = dict(r)
        pid = int(d["id"])
        d["quoted_cents"] = quoted_by.get(pid, 0)
        d["start_date"] = to_iso_date(d.get("start_date"))
        d["end_date"] = to_iso_date(d.get("end_date"))
        out[pid] = d
    return out


def _live_project_ids(project_ids):
    found = _load_micasa_projects(project_ids)
    return [pid for pid in project_ids if pid in found]


def _require_live_project(project_id):
    found = _load_micasa_projects([project_id])
    if project_id not in found:
        raise HTTPException(
            status_code=400,
            detail=f"project {project_id} not found or deleted",
        )
    return found[project_id]


def _program_links(pconn, program_id):
    return pconn.execute(
        """
        SELECT id, program_id, project_id, sort_order, created_at
          FROM program_projects
         WHERE program_id = ? AND deleted_at IS NULL
         ORDER BY sort_order ASC, id ASC
        """,
        (program_id,),
    ).fetchall()


def _fetch_program_row(pconn, program_id):
    row = pconn.execute(
        """
        SELECT id, name, description, created_at, updated_at
          FROM programs
         WHERE id = ? AND deleted_at IS NULL
        """,
        (program_id,),
    ).fetchone()
    return dict(row) if row else None


def _serialize_project_row(link, proj):
    budget = proj.get("budget_cents")
    actual = proj.get("actual_cents")
    quoted = proj.get("quoted_cents") or 0
    trend = project_trend(budget, actual, quoted)
    return {
        "id": link["id"],
        "project_id": int(link["project_id"]),
        "sort_order": link["sort_order"] if link["sort_order"] is not None else 0,
        "title": proj.get("title"),
        "status": proj.get("status"),
        "start_date": proj.get("start_date"),
        "end_date": proj.get("end_date"),
        "budget_cents": _money(budget),
        "quoted_cents": _money(quoted),
        "actual_cents": _money(actual),
        "spend_cents": _money(trend["spend_cents"]),
        "projected_cents": _money(trend["projected_cents"]),
        "remaining_vs_budget_cents": _money(trend["remaining_vs_budget_cents"]),
        "variance_vs_budget_cents": _money(trend["variance_vs_budget_cents"]),
        "variance_vs_budget_pct": trend["variance_vs_budget_pct"],
        "budget_status": trend["budget_status"],
    }


def _program_payload(pconn, program_id, include_projects=True):
    prog = _fetch_program_row(pconn, program_id)
    if not prog:
        return None
    links = _program_links(pconn, program_id)
    micasa = _load_micasa_projects([int(l["project_id"]) for l in links])
    children = []
    rollup_src = []
    for link in links:
        proj = micasa.get(int(link["project_id"]))
        if not proj:
            continue
        rollup_src.append(
            {
                "budget_cents": proj.get("budget_cents"),
                "actual_cents": proj.get("actual_cents"),
                "quoted_cents": proj.get("quoted_cents"),
            }
        )
        if include_projects:
            children.append(_serialize_project_row(link, proj))
    payload = {**prog, **_expand_rollup(compute_rollup(rollup_src))}
    if include_projects:
        payload["projects"] = children
    return payload


def _next_sort_order(pconn, program_id):
    row = pconn.execute(
        """
        SELECT COALESCE(MAX(sort_order), -1) AS m
          FROM program_projects
         WHERE program_id = ? AND deleted_at IS NULL
        """,
        (program_id,),
    ).fetchone()
    return int(row["m"]) + 1


def _link_project(pconn, program_id, project_id, sort_order, now, backup_first=False):
    existing = pconn.execute(
        """
        SELECT id, deleted_at FROM program_projects
         WHERE program_id = ? AND project_id = ?
        """,
        (program_id, project_id),
    ).fetchone()
    if existing and existing["deleted_at"] is None:
        raise HTTPException(
            status_code=400,
            detail=f"project {project_id} is already in this program",
        )
    if backup_first:
        _backup_or_abort()
    if existing:
        pconn.execute(
            """
            UPDATE program_projects
               SET deleted_at = NULL, sort_order = ?, created_at = ?
             WHERE id = ?
            """,
            (sort_order, now, existing["id"]),
        )
        return
    pconn.execute(
        """
        INSERT INTO program_projects
            (program_id, project_id, sort_order, created_at, deleted_at)
        VALUES (?, ?, ?, ?, NULL)
        """,
        (program_id, project_id, sort_order, now),
    )


@router.get("/programs")
def list_programs():
    _require_programs()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        rows = pconn.execute(
            """
            SELECT id FROM programs
             WHERE deleted_at IS NULL
             ORDER BY updated_at DESC, id DESC
            """
        ).fetchall()
        return [_program_payload(pconn, r["id"], include_projects=False) for r in rows]
    finally:
        pconn.close()


@router.get("/programs/{program_id}")
def get_program(program_id: int):
    _require_programs()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        payload = _program_payload(pconn, program_id, include_projects=True)
        if not payload:
            raise HTTPException(status_code=404, detail="program not found")
        return payload
    finally:
        pconn.close()


@router.post("/programs", status_code=201)
def create_program(payload: ProgramCreate):
    _require_programs()
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    description = (payload.description or "").strip() or None
    raw_ids = payload.project_ids or []
    project_ids = list(dict.fromkeys(int(i) for i in raw_ids))
    if project_ids:
        live = set(_live_project_ids(project_ids))
        missing = [i for i in project_ids if i not in live]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"project(s) not found or deleted: {missing}",
            )

    now = now_utc_str()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        _backup_or_abort()
        cur = pconn.execute(
            """
            INSERT INTO programs (name, description, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, NULL)
            """,
            (name, description, now, now),
        )
        new_id = cur.lastrowid
        for i, pid in enumerate(project_ids):
            _link_project(pconn, new_id, pid, i, now)
        pconn.commit()
        return _program_payload(pconn, new_id, include_projects=True)
    except HTTPException:
        pconn.rollback()
        raise
    except Exception as e:
        pconn.rollback()
        raise HTTPException(status_code=500, detail=f"insert failed: {e}")
    finally:
        pconn.close()


@router.put("/programs/{program_id}")
def update_program(program_id: int, payload: ProgramUpdate):
    _require_programs()
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    description = (payload.description or "").strip() or None

    now = now_utc_str()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        row = pconn.execute(
            "SELECT id FROM programs WHERE id = ? AND deleted_at IS NULL",
            (program_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="program not found")
        _backup_or_abort()
        pconn.execute(
            """
            UPDATE programs
               SET name = ?, description = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL
            """,
            (name, description, now, program_id),
        )
        pconn.commit()
        return _program_payload(pconn, program_id, include_projects=True)
    except HTTPException:
        pconn.rollback()
        raise
    except Exception as e:
        pconn.rollback()
        raise HTTPException(status_code=500, detail=f"update failed: {e}")
    finally:
        pconn.close()


@router.delete("/programs/{program_id}")
def delete_program(program_id: int):
    """Soft-delete the program and its membership links."""
    _require_programs()
    now = now_utc_str()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        row = pconn.execute(
            "SELECT id FROM programs WHERE id = ? AND deleted_at IS NULL",
            (program_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="program not found")
        _backup_or_abort()
        pconn.execute(
            "UPDATE programs SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, program_id),
        )
        pconn.execute(
            """
            UPDATE program_projects
               SET deleted_at = ?
             WHERE program_id = ? AND deleted_at IS NULL
            """,
            (now, program_id),
        )
        pconn.commit()
    except HTTPException:
        pconn.rollback()
        raise
    except Exception as e:
        pconn.rollback()
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    finally:
        pconn.close()
    return {"ok": True, "id": program_id}


@router.post("/programs/{program_id}/projects", status_code=201)
def add_program_project(program_id: int, payload: ProgramProjectAdd):
    _require_programs()
    _require_live_project(payload.project_id)
    now = now_utc_str()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        row = pconn.execute(
            "SELECT id FROM programs WHERE id = ? AND deleted_at IS NULL",
            (program_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="program not found")
        sort_order = payload.sort_order
        if sort_order is None:
            sort_order = _next_sort_order(pconn, program_id)
        _link_project(pconn, program_id, payload.project_id, int(sort_order), now, backup_first=True)
        pconn.execute(
            "UPDATE programs SET updated_at = ? WHERE id = ?",
            (now, program_id),
        )
        pconn.commit()
        return _program_payload(pconn, program_id, include_projects=True)
    except HTTPException:
        pconn.rollback()
        raise
    except Exception as e:
        pconn.rollback()
        raise HTTPException(status_code=500, detail=f"link failed: {e}")
    finally:
        pconn.close()


@router.delete("/programs/{program_id}/projects/{project_id}")
def remove_program_project(program_id: int, project_id: int):
    """Unlink a project (hard-remove the live membership row)."""
    _require_programs()
    pconn = get_programs_conn()
    if pconn is None:
        raise HTTPException(status_code=404, detail="programs disabled")
    try:
        prog = pconn.execute(
            "SELECT id FROM programs WHERE id = ? AND deleted_at IS NULL",
            (program_id,),
        ).fetchone()
        if not prog:
            raise HTTPException(status_code=404, detail="program not found")
        link = pconn.execute(
            """
            SELECT id FROM program_projects
             WHERE program_id = ? AND project_id = ? AND deleted_at IS NULL
            """,
            (program_id, project_id),
        ).fetchone()
        if not link:
            raise HTTPException(status_code=404, detail="project is not in this program")
        _backup_or_abort()
        pconn.execute("DELETE FROM program_projects WHERE id = ?", (link["id"],))
        pconn.execute(
            "UPDATE programs SET updated_at = ? WHERE id = ?",
            (now_utc_str(), program_id),
        )
        pconn.commit()
        return _program_payload(pconn, program_id, include_projects=True)
    except HTTPException:
        pconn.rollback()
        raise
    except Exception as e:
        pconn.rollback()
        raise HTTPException(status_code=500, detail=f"unlink failed: {e}")
    finally:
        pconn.close()
