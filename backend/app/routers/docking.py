import csv
import io
import json
import logging
import os
import uuid as uuid_lib
from uuid import UUID

import redis as redis_lib

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.config import get_settings
from app.database import get_db
from app.models.docking_job import DockingJob, JobStatus
from app.models.phytochemical import Phytochemical
from app.models.protein import Protein
from app.models.result import Result
from app.models.session import UserSession
from app.routers.sessions import get_current_session
from app.schemas.docking import DockingJobCreate, DockingJobOut, ResultOut

router = APIRouter()
logger = logging.getLogger(__name__)

_SUBDIRS = [
    "protein_pdb_files",
    "protein_pdbqt_files",
    "protien_pdbqt_files",   # typo spelling created by directory_creation()
    "drug_pdb_files",
    "drug_pdbqt_files",
    "output_files_1",
    "output_files_2",
    "configuration_file",    # Vina config files written by calculate_grid_box_*
]

_RESULT_CSV_FIELDS = [
    "compound_name", "binding_score", "rmsd_lower",
    "rmsd_upper", "h_bond_count", "pose_file",
]


def _assert_owns_job(job: DockingJob, session: UserSession) -> None:
    if job.session_id != session.id:
        raise HTTPException(status_code=403, detail="This job belongs to another session")


# ── GET /workers ─────────────────────────────────────────────────────────────

@router.get("/workers")
def get_workers() -> dict:
    try:
        inspector = celery_app.control.inspect(timeout=2.0)
        active = inspector.active() or {}
        ping   = inspector.ping()   or {}

        workers = [
            {
                "name":         worker_name,
                "status":       "online" if worker_name in ping else "unknown",
                "active_tasks": len(tasks),
                "queue":        "docking" if "docking" in worker_name else "fast",
            }
            for worker_name, tasks in active.items()
        ]

        r = redis_lib.from_url(get_settings().REDIS_URL)
        docking_len = r.llen("docking") or 0
        fast_len    = r.llen("fast")    or 0
        r.close()

        return {
            "workers":               workers,
            "total_online":          len(workers),
            "docking_queue_length":  docking_len,
            "fast_queue_length":     fast_len,
        }
    except Exception as e:
        return {
            "workers":               [],
            "total_online":          0,
            "docking_queue_length":  0,
            "fast_queue_length":     0,
            "error":                 str(e),
        }


# ── POST /dispatch ────────────────────────────────────────────────────────────

@router.post("/dispatch")
def dispatch_docking(
    body: DockingJobCreate,
    db: Session = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> dict:

    # STEP 1 — Validate protein exists
    protein = db.scalar(
        select(Protein).where(
            func.upper(Protein.protein_code) == body.protein_code.upper()
        )
    )
    if protein is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Protein {body.protein_code} not found. "
                f"Call GET /api/protein/{body.protein_code} first."
            ),
        )

    # STEP 2 — Validate all requested compounds have SMILES
    if body.compound_ids:
        missing = db.scalars(
            select(Phytochemical).where(
                Phytochemical.id.in_(body.compound_ids),
                Phytochemical.smiles.is_(None),
            )
        ).all()
        if missing:
            return JSONResponse(
                status_code=422,
                content={
                    "error": "compounds_missing_smiles",
                    "message": (
                        f"{len(missing)} compound(s) have no SMILES "
                        "and cannot be docked."
                    ),
                    "compound_ids": [str(c.id) for c in missing],
                },
            )

    # STEP 3 — Pre-generate UUID so pathway can be built before the DB insert
    job_id  = uuid_lib.uuid4()
    pathway = str(get_settings().job_workspace(job_id))

    compound_id = body.compound_ids[0] if body.compound_ids else None

    # Store the full ligand payload in error_message so the Celery task can
    # process every compound_id, not just the first. The task clears this field
    # when it starts; if the task fails, error_message is overwritten with the
    # actual error string.
    payload_json = json.dumps({
        "compound_ids": [str(cid) for cid in body.compound_ids],
        "smiles_list":  body.smiles_list,
        "plant_name":   body.plant_name,
    })

    job = DockingJob(
        id=job_id,
        compound_id=compound_id,
        protein_id=protein.id,
        session_id=session.id,
        pathway=pathway,
        status=JobStatus.pending,
        error_message=payload_json,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # STEP 4 — Create workspace directories
    os.makedirs(pathway, exist_ok=True)
    for subdir in _SUBDIRS:
        os.makedirs(f"{pathway}/{subdir}", exist_ok=True)

    # STEP 5 — Dispatch Celery task
    # Wrapped in try/except so the server starts before the task module exists.
    try:
        from app.tasks import run_docking_job  # noqa: PLC0415
        celery_result = run_docking_job.delay(str(job.id))
        job.celery_task_id = celery_result.id
        db.commit()
    except Exception as exc:
        logger.warning("Celery not available: %s", exc)

    # STEP 6 — Return
    return {
        "job_id":   str(job.id),
        "status":   "pending",
        "pathway":  pathway,
    }


# ── GET /jobs ─────────────────────────────────────────────────────────────────

@router.get("/jobs", response_model=list[DockingJobOut])
def list_jobs(
    response: Response,
    skip:    int = Query(0, ge=0),
    limit:   int = Query(20, ge=1, le=100),
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> list[DockingJobOut]:
    total = db.scalar(
        select(func.count())
        .select_from(DockingJob)
        .where(DockingJob.session_id == session.id)
    )
    jobs = db.scalars(
        select(DockingJob)
        .where(DockingJob.session_id == session.id)
        .order_by(DockingJob.created_at.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    response.headers["X-Session-Job-Count"]    = str(total or 0)
    response.headers["X-Session-Display-Name"] = session.display_name
    return jobs


# ── GET /jobs/{job_id}/error ──────────────────────────────────────────────────
# Declared before /jobs/{job_id} — extra path segment takes priority.

@router.get("/jobs/{job_id}/error")
def get_job_error(
    job_id:  UUID,
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> dict:
    job = db.get(DockingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)
    return {
        "job_id":        str(job.id),
        "status":        job.status.value if hasattr(job.status, "value") else str(job.status),
        "error_message": job.error_message,
        "created_at":    job.created_at.isoformat() if job.created_at else None,
    }


# ── GET /jobs/{job_id} ────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}", response_model=DockingJobOut)
def get_job(
    job_id:  UUID,
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> DockingJobOut:
    job = db.get(DockingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)
    return job


# ── GET /results/{job_id}/csv ─────────────────────────────────────────────────
# Declared before /results/{job_id} — both have the same prefix so the more
# specific route (extra /csv segment) must be registered first.

@router.get("/results/{job_id}/csv")
def results_csv(
    job_id:  UUID,
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> StreamingResponse:
    job = db.get(DockingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)

    rows = db.scalars(
        select(Result)
        .where(Result.job_id == job_id)
        .order_by(Result.binding_score.asc())
    ).all()

    def _generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_RESULT_CSV_FIELDS)
        writer.writeheader()
        yield buf.getvalue()

        for r in rows:
            buf.seek(0)
            buf.truncate(0)
            writer.writerow({
                "compound_name": r.compound_name,
                "binding_score": r.binding_score,
                "rmsd_lower":    r.rmsd_lower,
                "rmsd_upper":    r.rmsd_upper,
                "h_bond_count":  r.h_bond_count,
                "pose_file":     r.pose_file,
            })
            yield buf.getvalue()

    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="results_{job_id}.csv"'
        },
    )


# ── GET /results/{job_id}/plants/csv ──────────────────────────────────────────

_PLANT_CSV_FIELDS = ["compound_name", "smiles", "source_plant", "plant_family"]

@router.get("/results/{job_id}/plants/csv")
def results_plants_csv(
    job_id:  UUID,
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> StreamingResponse:
    job = db.get(DockingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)

    stmt = (
        select(
            Result.compound_name.label("compound_name"),
            Phytochemical.smiles.label("smiles"),
            Phytochemical.source_plant.label("source_plant"),
            Phytochemical.plant_family.label("plant_family"),
        )
        .join(Phytochemical, Result.compound_name == Phytochemical.name)
        .where(Result.job_id == job_id)
        .order_by(Result.binding_score.asc())
    )
    rows = db.execute(stmt).all()

    def _generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_PLANT_CSV_FIELDS)
        writer.writeheader()
        yield buf.getvalue()

        for r in rows:
            buf.seek(0)
            buf.truncate(0)
            writer.writerow({
                "compound_name": r.compound_name,
                "smiles":        r.smiles,
                "source_plant":  r.source_plant,
                "plant_family":  r.plant_family,
            })
            yield buf.getvalue()

    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="results_plants_{job_id}.csv"'
        },
    )


# ── GET /results/{job_id} ─────────────────────────────────────────────────────

@router.get("/results/{job_id}", response_model=list[ResultOut])
def get_results(
    job_id:  UUID,
    db:      Session     = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> list[ResultOut]:
    job = db.get(DockingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)

    return db.scalars(
        select(Result)
        .where(Result.job_id == job_id)
        .order_by(Result.binding_score.asc())
    ).all()


# ── GET /pose/{result_id} ─────────────────────────────────────────────────────

@router.get("/pose/{result_id}")
def get_pose(
    result_id: UUID,
    db:        Session     = Depends(get_db),
    session:   UserSession = Depends(get_current_session),
) -> PlainTextResponse:
    result = db.get(Result, result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")
    job = db.get(DockingJob, result.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _assert_owns_job(job, session)

    if not result.pose_file or not os.path.isfile(result.pose_file):
        raise HTTPException(
            status_code=404,
            detail=f"Pose file not found on disk: {result.pose_file}",
        )

    with open(result.pose_file) as fh:
        content = fh.read()

    return PlainTextResponse(content, media_type="chemical/x-pdbqt")
