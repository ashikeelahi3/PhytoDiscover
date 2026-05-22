import json
import logging
import time

from app.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)


def get_redis_client():
    import redis
    return redis.from_url(get_settings().REDIS_URL)


def get_db_session():
    from app.database import SessionLocal
    return SessionLocal()


def publish(redis_client, job_id: str, status: str, message: str) -> None:
    """Publish a status update to Redis and log it."""
    payload = json.dumps({
        "job_id":   job_id,
        "status":   status,
        "message":  message,
        "ts":       time.time(),
    })
    redis_client.publish(f"job_status:{job_id}", payload)
    logger.info("[%s] %s: %s", job_id, status, message)


def update_job_status(db, job_id: str, status: str, error: str | None = None) -> None:
    """Update DockingJob.status (and optionally error_message) in the DB."""
    from datetime import datetime

    from app.models.docking_job import DockingJob

    job = db.query(DockingJob).filter(DockingJob.id == job_id).first()
    if job:
        job.status     = status
        job.updated_at = datetime.utcnow()
        if error:
            job.error_message = error
        db.commit()


@celery_app.task(
    bind=True,
    max_retries=2,
    name="run_docking_job",
    queue="docking",
)
def run_docking_job(self, job_id: str) -> None:
    """
    Master docking task.
    Chains: protein prep → ligand prep → docking → parse → persist.
    Publishes status to Redis channel job_status:{job_id} at every step
    so the WebSocket endpoint can forward live updates to the browser.
    """
    db = get_db_session()
    r  = get_redis_client()

    try:
        from app.models.docking_job import DockingJob
        from app.models.protein import Protein

        # ── Load job ──────────────────────────────────────────
        job = db.query(DockingJob).filter(DockingJob.id == job_id).first()
        if not job:
            raise ValueError(f"Job {job_id} not found in database")

        pathway = job.pathway
        protein = db.query(Protein).filter(Protein.id == job.protein_id).first()

        # ── Step 1: Protein preparation ───────────────────────
        publish(r, job_id, "preparing", "Preparing protein structure...")
        update_job_status(db, job_id, "preparing")

        from app.services.protein_pipeline import (
            ProteinPrepError,
            run_protein_preparation,
        )

        prep_result = run_protein_preparation(
            job_id=job_id,
            protein_code=protein.protein_code,
            chain=protein.selected_chain or "A",
            grid_mode=(protein.grid_mode.value
                       if protein.grid_mode else "blind"),
            grid_params=protein.grid_params_json or {},
            pathway=pathway,
        )

        protein.pdb_path   = prep_result["pdb_path"]
        protein.pdbqt_path = prep_result["pdbqt_path"]
        db.commit()

        # ── Step 2: Ligand preparation ────────────────────────
        publish(r, job_id, "preparing", "Preparing ligands...")

        from app.services.ligand_pipeline import (
            LigandPrepError,
            run_ligand_preparation,
        )

        # Read compound payload stored by dispatch, then clear the field so
        # that if the job fails, error_message holds the real error string.
        try:
            stored  = json.loads(job.error_message or "{}")
            payload = {
                "compound_ids": stored.get("compound_ids",
                    [str(job.compound_id)] if job.compound_id else []),
                "smiles_list":  stored.get("smiles_list", []),
                "plant_name":   stored.get("plant_name"),
            }
        except Exception:
            payload = {
                "compound_ids": [str(job.compound_id)] if job.compound_id else [],
                "smiles_list":  [],
                "plant_name":   None,
            }
        job.error_message = None
        db.commit()

        ligand_count = run_ligand_preparation(
            job_id=job_id,
            payload=payload,
            pathway=pathway,
            db=db,
        )

        # ── Step 3: Docking ───────────────────────────────────
        publish(r, job_id, "docking",
                f"Running docking on {ligand_count} ligands...")
        update_job_status(db, job_id, "docking")

        from app.services.docking_engine import parse_results, run_docking

        successful = run_docking(pathway=pathway, job_id=job_id)
        logger.info("[%s] %d docking runs completed", job_id, successful)

        # ── Step 4: Parse raw results into consolidated CSV ───
        publish(r, job_id, "parsing", "Parsing binding affinity scores...")
        update_job_status(db, job_id, "parsing")

        df = parse_results(pathway=pathway, job_id=job_id)
        logger.info("[%s] %d results parsed", job_id, len(df))

        # ── Step 5: Persist results to DB ─────────────────────
        from app.services.result_parser import persist_results

        count = persist_results(job_id=job_id, pathway=pathway, db=db)

        update_job_status(db, job_id, "done")
        publish(r, job_id, "done",
                f"Docking complete. {count} results saved.")

    except Exception as exc:
        error_msg = str(exc)
        logger.error("[%s] Job failed: %s", job_id, error_msg)
        update_job_status(db, job_id, "failed", error=error_msg)
        publish(r, job_id, "failed", f"Job failed: {error_msg}")
        raise self.retry(exc=exc, countdown=30)

    finally:
        db.close()
        r.close()
