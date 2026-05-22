import csv
import glob
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def persist_results(job_id: str, pathway: str, db: Session) -> int:
    """
    Reads binding affinity CSV files from output_files_2/.
    Inserts one Result row per compound per file.
    Returns the total count of rows inserted.
    """
    from app.models.result import Result

    output_dir = os.path.join(pathway, "output_files_2")
    csv_files  = glob.glob(os.path.join(output_dir, "*.csv"))

    if not csv_files:
        logger.warning("[%s] No CSV files found in %s", job_id, output_dir)
        return 0

    results: list[Result] = []

    for csv_file in csv_files:
        try:
            with open(csv_file, newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        result = Result(
                            job_id=job_id,
                            compound_name=row.get("compound_name", ""),
                            binding_score=float(row.get("binding_score") or 0),
                            rmsd_lower=float(row.get("rmsd_lower") or 0),
                            rmsd_upper=float(row.get("rmsd_upper") or 0),
                            h_bond_count=int(row.get("h_bond_count") or 0),
                            pose_file=row.get("pose_file", ""),
                            created_at=datetime.utcnow(),
                        )
                        results.append(result)
                    except (ValueError, KeyError) as e:
                        logger.warning(
                            "[%s] Skipping malformed row in %s: %s",
                            job_id, csv_file, e,
                        )
        except Exception as e:
            logger.warning(
                "[%s] Could not read %s: %s", job_id, csv_file, e
            )

    if results:
        db.bulk_save_objects(results)
        db.commit()

    logger.info("[%s] Persisted %d results", job_id, len(results))
    return len(results)
