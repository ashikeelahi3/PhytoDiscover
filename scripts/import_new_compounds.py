#!/usr/bin/env python3
"""
Import a large CSV of phytochemical compounds into phytodiscover.

Column mapping (CSV → DB):
    smiles       → smiles
    name         → name
    organism     → source_plant
    synonym      → iupac_name
    pubchem_cid  → pubchem_cid   (deduplication key)

Deduplication:
    Rows WITH pubchem_cid  → INSERT … ON CONFLICT (pubchem_cid) DO NOTHING
    Rows WITHOUT pubchem_cid → pre-checked via SMILES lookup before insert

Safe to re-run: already-inserted rows are skipped automatically.

Usage:
    python scripts/import_new_compounds.py --file /path/to/data.csv
    python scripts/import_new_compounds.py --file /path/to/data.csv --dry-run
"""

from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path

# Must happen before os.environ is read
load_dotenv(Path(__file__).parents[1] / ".env")

import argparse
import csv
import os
import sys
import time
import uuid

import psycopg2
from psycopg2.extras import execute_values

# ── Connection ────────────────────────────────────────────────────────────────

_pg_password = os.environ.get("POSTGRES_PASSWORD", "")
if not _pg_password:
    sys.exit("POSTGRES_PASSWORD is not set — copy .env.example to .env and fill it in")

TARGET_DSN = dict(
    host="localhost",
    port=5433,
    dbname="phytodiscover",
    user="phyto",
    password=_pg_password,
)

# ── Tuning constants ──────────────────────────────────────────────────────────

INSERT_BATCH   = 1_000   # rows per INSERT statement
PROGRESS_EVERY = 10_000  # print progress every N rows
ENRICH_BATCH   = 1_000   # rows per UPDATE commit during enrichment
ENRICH_PRINT   = 5_000   # print enrichment progress every N rows

# ── NA normalisation ──────────────────────────────────────────────────────────

_NA = {"NA", "N/A", "na", "n/a", "NaN", "nan", "N/a", "null", "NULL", ""}


def _clean(value: str | None) -> str | None:
    """Return None for NA-like strings; otherwise strip and return."""
    if value is None:
        return None
    v = value.strip()
    return None if v in _NA else v


def _parse_cid(raw: str | None) -> int | None:
    v = _clean(raw)
    if v is None:
        return None
    try:
        return int(float(v))   # handles "12345.0"
    except (TypeError, ValueError):
        return None


# ── Row construction ──────────────────────────────────────────────────────────

def _build_row(r: dict) -> tuple:
    """
    Map one CSV DictReader row to a DB tuple.
    Returns: (id, name, iupac_name, smiles, source_plant, pubchem_cid)
    """
    return (
        str(uuid.uuid4()),
        _clean(r.get("name"))   or "",   # name: not null in DB
        _clean(r.get("synonym")),         # iupac_name
        _clean(r.get("smiles")),          # smiles (null allowed)
        _clean(r.get("organism")),        # source_plant
        _parse_cid(r.get("pubchem_cid")), # pubchem_cid
    )


# ── SQL templates ─────────────────────────────────────────────────────────────

_INSERT_WITH_CID = """
    INSERT INTO phytochemicals
        (id, name, iupac_name, smiles, source_plant, pubchem_cid)
    VALUES %s
    ON CONFLICT (pubchem_cid) DO NOTHING
    RETURNING id
"""

_INSERT_NO_CID = """
    INSERT INTO phytochemicals
        (id, name, iupac_name, smiles, source_plant)
    VALUES %s
    RETURNING id
"""

_SMILES_EXISTS = """
    SELECT smiles
    FROM   phytochemicals
    WHERE  smiles = ANY(%s)
"""

_SELECT_PENDING = """
    SELECT id, smiles
    FROM   phytochemicals
    WHERE  smiles IS NOT NULL
    AND    molecular_weight IS NULL
    ORDER  BY id
"""

_UPDATE_PROPS = """
    UPDATE phytochemicals SET
        molecular_weight = %s,
        logp             = %s,
        h_bond_donors    = %s,
        h_bond_acceptors = %s,
        tpsa             = %s,
        rotatable_bonds  = %s,
        lipinski_pass    = %s
    WHERE id = %s
"""


# ── Dedup index ───────────────────────────────────────────────────────────────

def _ensure_dedup_index(conn: psycopg2.extensions.connection) -> None:
    """Create the pubchem_cid unique index if it doesn't already exist."""
    with conn.cursor() as cur:
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_phytochemicals_pubchem_cid "
            "ON phytochemicals (pubchem_cid)"
        )
    conn.commit()


# ── Batch flush ───────────────────────────────────────────────────────────────

def _flush_batch(
    cur,
    with_cid: list[tuple],
    no_cid:   list[tuple],
    null_smiles_seen: set[str],
    dry_run: bool,
) -> tuple[int, int]:
    """
    Insert one batch.

    with_cid rows use ON CONFLICT DO NOTHING on pubchem_cid.
    no_cid rows are pre-filtered via a SMILES bulk-lookup so the same
    compound is not inserted twice even without a unique key.

    Returns (inserted, skipped).
    Mutates null_smiles_seen in-place with newly queued SMILES.
    """
    inserted = skipped = 0

    # ── with-cid rows ─────────────────────────────────────────────────────────
    if with_cid:
        if not dry_run:
            returned = execute_values(
                cur,
                _INSERT_WITH_CID,
                # tuple layout: (id, name, iupac_name, smiles, source_plant, pubchem_cid)
                with_cid,
                fetch=True,
            )
            ins = len(returned)
            skp = len(with_cid) - ins
        else:
            ins, skp = len(with_cid), 0   # dry-run: assume all new
        inserted += ins
        skipped  += skp

    # ── no-cid rows ───────────────────────────────────────────────────────────
    if no_cid:
        # Collect non-null SMILES for bulk existence check
        candidate_smiles = [r[3] for r in no_cid if r[3]]

        if candidate_smiles and not dry_run:
            cur.execute(_SMILES_EXISTS, (candidate_smiles,))
            db_existing: set[str] = {row[0] for row in cur.fetchall()}
        else:
            db_existing = set()

        to_insert: list[tuple] = []
        for row in no_cid:
            smiles = row[3]
            if smiles and (smiles in null_smiles_seen or smiles in db_existing):
                skipped += 1
                continue
            # Row passes dedup — schedule for insert
            if smiles:
                null_smiles_seen.add(smiles)
            to_insert.append(row)

        if to_insert:
            if not dry_run:
                returned = execute_values(
                    cur,
                    _INSERT_NO_CID,
                    # (id, name, iupac_name, smiles, source_plant) — drop pubchem_cid col
                    [(r[0], r[1], r[2], r[3], r[4]) for r in to_insert],
                    fetch=True,
                )
                ins = len(returned)
                skp = len(to_insert) - ins
            else:
                ins, skp = len(to_insert), 0
            inserted += ins
            skipped  += skp

    return inserted, skipped


# ── Phase 1: CSV import ───────────────────────────────────────────────────────

def run_import(csv_path: Path, dry_run: bool) -> tuple[int, int, int]:
    """
    Stream csv_path and insert into phytodiscover.

    Returns (rows_read, inserted, skipped).
    """
    conn = psycopg2.connect(**TARGET_DSN) if not dry_run else None

    if not dry_run:
        _ensure_dedup_index(conn)
        cur = conn.cursor()
    else:
        cur = None

    rows_read = inserted_total = skipped_total = 0
    null_smiles_seen: set[str] = set()   # dedup across batches for no-cid rows

    batch_with_cid: list[tuple] = []
    batch_no_cid:   list[tuple] = []

    t_start = time.monotonic()

    def _flush_and_commit() -> None:
        nonlocal inserted_total, skipped_total
        ins, skp = _flush_batch(cur, batch_with_cid, batch_no_cid, null_smiles_seen, dry_run)
        inserted_total += ins
        skipped_total  += skp
        batch_with_cid.clear()
        batch_no_cid.clear()
        if not dry_run:
            conn.commit()

    try:
        with open(csv_path, newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.DictReader(fh)

            # Validate expected columns
            expected = {"smiles", "name", "organism", "synonym", "pubchem_cid"}
            missing  = expected - set(reader.fieldnames or [])
            if missing:
                print(f"WARNING: CSV is missing expected columns: {missing}")
                print(f"         Available columns: {reader.fieldnames}")

            for raw_row in reader:
                rows_read += 1

                row = _build_row(raw_row)
                pubchem_cid = row[5]

                if pubchem_cid is not None:
                    batch_with_cid.append(row)
                else:
                    batch_no_cid.append(row)

                # Flush when either sub-batch fills up
                if len(batch_with_cid) + len(batch_no_cid) >= INSERT_BATCH:
                    _flush_and_commit()

                if rows_read % PROGRESS_EVERY == 0:
                    elapsed = time.monotonic() - t_start
                    rate    = rows_read / elapsed
                    print(
                        f"Processed {rows_read:>10,} rows | "
                        f"inserted {inserted_total:>8,} | "
                        f"skipped {skipped_total:>8,} duplicates | "
                        f"{rate:,.0f} rows/s"
                    )

        # Flush remainder
        if batch_with_cid or batch_no_cid:
            _flush_and_commit()

    finally:
        if not dry_run:
            cur.close()
            conn.close()

    return rows_read, inserted_total, skipped_total


# ── Phase 2: RDKit enrichment ─────────────────────────────────────────────────

def run_rdkit_enrichment() -> tuple[int, int]:
    """
    Compute molecular descriptors for every row with SMILES but no MW.

    Uses a server-side cursor (itersize=1000) so the full pending list
    is never loaded into memory at once — mirrors migrate_from_phytochem_db.py
    but streams instead of fetchall().
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors
    except ImportError as exc:
        print(f"RDKit unavailable ({exc}) — skipping enrichment")
        return 0, 0

    conn    = psycopg2.connect(**TARGET_DSN)
    enriched = failed = 0
    t_start  = time.monotonic()

    try:
        # Count pending rows for progress display
        with conn.cursor() as count_cur:
            count_cur.execute(
                "SELECT COUNT(*) FROM phytochemicals "
                "WHERE smiles IS NOT NULL AND molecular_weight IS NULL"
            )
            total = count_cur.fetchone()[0]

        print(f"\nRDKit enrichment: {total:,} rows to process")
        if total == 0:
            return 0, 0

        update_batch: list[tuple] = []

        def _flush_updates(write_cur) -> None:
            if not update_batch:
                return
            write_cur.executemany(_UPDATE_PROPS, update_batch)
            conn.commit()
            update_batch.clear()

        # Server-side cursor streams rows without loading all into memory
        with conn.cursor("enrich_cursor", withhold=True) as read_cur, conn.cursor() as write_cur:
            read_cur.itersize = ENRICH_BATCH
            read_cur.execute(_SELECT_PENDING)

            for row_id, smiles in read_cur:
                try:
                    mol = Chem.MolFromSmiles(smiles)
                    if mol is None:
                        raise ValueError("unparsable SMILES")

                    mw   = Descriptors.MolWt(mol)
                    logp = Descriptors.MolLogP(mol)
                    hbd  = rdMolDescriptors.CalcNumHBD(mol)
                    hba  = rdMolDescriptors.CalcNumHBA(mol)
                    tpsa = rdMolDescriptors.CalcTPSA(mol)
                    rb   = rdMolDescriptors.CalcNumRotatableBonds(mol)
                    lip  = bool(mw < 500 and logp < 5 and hbd <= 5 and hba <= 10)

                    update_batch.append((mw, logp, hbd, hba, tpsa, rb, lip, str(row_id)))
                    enriched += 1

                    if len(update_batch) >= ENRICH_BATCH:
                        _flush_updates(write_cur)

                    if enriched % ENRICH_PRINT == 0:
                        elapsed = time.monotonic() - t_start
                        pct     = enriched / total * 100
                        print(
                            f"  Enriched {enriched:>8,}/{total:,} ({pct:.1f}%)  "
                            f"{enriched / elapsed:,.0f} rows/s"
                        )

                except Exception:
                    failed += 1

            _flush_updates(write_cur)

    finally:
        conn.close()

    return enriched, failed


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import phytochemical CSV into phytodiscover (resumable)."
    )
    parser.add_argument("--file", required=True, help="Path to the CSV file")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and count rows without writing to the database",
    )
    args = parser.parse_args()

    csv_path = Path(args.file)
    if not csv_path.exists():
        sys.exit(f"File not found: {csv_path}")

    size_gb = csv_path.stat().st_size / 1_073_741_824
    mode    = "DRY RUN — no writes" if args.dry_run else "LIVE — writing to phytodiscover"

    print("=" * 70)
    print(f"  PhytoDiscover compound import")
    print(f"  File : {csv_path}  ({size_gb:.2f} GB)")
    print(f"  Mode : {mode}")
    print(f"  Note : Safe to re-run — existing rows are skipped automatically.")
    print("=" * 70)
    print()

    t0 = time.monotonic()

    print("Phase 1: CSV import")
    print("-" * 40)
    rows_read, inserted, skipped = run_import(csv_path, args.dry_run)
    elapsed = time.monotonic() - t0

    print(
        f"\nImport complete in {elapsed:.1f}s\n"
        f"  Rows read : {rows_read:>10,}\n"
        f"  Inserted  : {inserted:>10,}\n"
        f"  Skipped   : {skipped:>10,}  (duplicates)\n"
        f"  Unknown   : {rows_read - inserted - skipped:>10,}  (invalid)\n"
    )

    if args.dry_run:
        print("Dry run complete — no changes written.")
        return

    print()
    print("Phase 2: RDKit enrichment")
    print("-" * 40)
    enriched, failed = run_rdkit_enrichment()
    print(
        f"\nEnrichment complete\n"
        f"  Enriched  : {enriched:>10,}\n"
        f"  Failed    : {failed:>10,}  (invalid SMILES — left with null MW)\n"
    )

    total_elapsed = time.monotonic() - t0
    print(f"Total runtime: {total_elapsed:.1f}s ({total_elapsed / 60:.1f} min)")


if __name__ == "__main__":
    main()
