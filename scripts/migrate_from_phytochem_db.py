#!/usr/bin/env python3
"""
Two-phase migration for PhytoDiscover.

Phase 1 — Row copy
    Reads phytochem_db.phytochemicals in batches of 500 and inserts
    into phytodiscover.phytochemicals.  Dedup key is pubchem_cid;
    rows without one (NULL) are always inserted because PostgreSQL
    treats NULLs as distinct in unique indexes.

Phase 2 — RDKit enrichment
    Computes molecular descriptors for every row whose smiles is
    non-NULL and molecular_weight is still NULL.

Run:
    python scripts/migrate_from_phytochem_db.py
"""

from dotenv import load_dotenv
from pathlib import Path

# Must happen before os.environ is read
load_dotenv(Path(__file__).parents[1] / ".env")

import os
import sys
import uuid

import psycopg2
from psycopg2.extras import execute_values

# ── Connection config ─────────────────────────────────────────────────────────

_pg_password = os.environ.get("POSTGRES_PASSWORD", "")
if not _pg_password:
    sys.exit("POSTGRES_PASSWORD is not set — copy .env.example to .env and fill it in")

SOURCE_DSN = {
    "host": "localhost",
    "port": 5432,
    "dbname": "phytochem_db",
    "user": "mdfahimfaysal",
    "password": os.getenv("PHYTOCHEM_DB_PASSWORD"),
}

TARGET_DSN = dict(
    host="localhost",
    port=5433,
    dbname="phytodiscover",
    user="phyto",
    password=_pg_password,
)

BATCH_SIZE = 500
KNOWN_TOTAL = 12_663


# ── Phase 1: data migration ───────────────────────────────────────────────────

_SELECT_SOURCE = """
    SELECT phytochemical_name,
           miles,
           plant_name,
           plant_part,
           phytochemical_identifier,
           synonyms
    FROM   phytochemicals
    ORDER  BY id
    LIMIT  %s OFFSET %s
"""

_INSERT_TARGET = """
    INSERT INTO phytochemicals
        (id, name, iupac_name, smiles, source_plant, plant_family, pubchem_cid)
    VALUES %s
    ON CONFLICT (pubchem_cid) DO NOTHING
    RETURNING id
"""


def _ensure_dedup_index(tgt: "psycopg2.connection") -> None:
    """Create a unique index on pubchem_cid if it does not already exist."""
    with tgt.cursor() as cur:
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_phytochemicals_pubchem_cid "
            "ON phytochemicals (pubchem_cid)"
        )
    tgt.commit()


def _parse_cid(raw) -> int | None:
    """Coerce phytochemical_identifier to int; return None if not possible."""
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def run_migration() -> tuple[int, int]:
    src = psycopg2.connect(**SOURCE_DSN)
    tgt = psycopg2.connect(**TARGET_DSN)

    try:
        _ensure_dedup_index(tgt)

        inserted_total = skipped_total = 0
        offset = 0

        with src.cursor() as src_cur, tgt.cursor() as tgt_cur:
            while True:
                src_cur.execute(_SELECT_SOURCE, (BATCH_SIZE, offset))
                rows = src_cur.fetchall()
                if not rows:
                    break

                batch = [
                    (
                        str(uuid.uuid4()),
                        row[0] or "",       # name              ← phytochemical_name
                        row[5],             # iupac_name        ← synonyms
                        row[1],             # smiles            ← miles
                        row[2],             # source_plant      ← plant_name
                        row[3],             # plant_family      ← plant_part
                        _parse_cid(row[4]), # pubchem_cid       ← phytochemical_identifier
                    )
                    for row in rows
                ]

                returned = execute_values(tgt_cur, _INSERT_TARGET, batch, fetch=True)
                inserted = len(returned)
                skipped = len(batch) - inserted
                inserted_total += inserted
                skipped_total += skipped
                tgt.commit()

                offset += len(rows)
                print(
                    f"Processed {min(offset, KNOWN_TOTAL)}/{KNOWN_TOTAL}  "
                    f"(+{inserted} inserted, {skipped} skipped)"
                )

                if len(rows) < BATCH_SIZE:
                    break

    finally:
        src.close()
        tgt.close()

    return inserted_total, skipped_total


# ── Phase 2: RDKit enrichment ─────────────────────────────────────────────────

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


def run_rdkit_enrichment() -> tuple[int, int]:
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors
    except Exception as exc:
        print(f"RDKit unavailable ({exc}) — skipping enrichment")
        return 0, 0

    tgt = psycopg2.connect(**TARGET_DSN)
    enriched = failed = 0

    try:
        with tgt.cursor() as cur:
            cur.execute(_SELECT_PENDING)
            pending = cur.fetchall()

        total = len(pending)
        print(f"\nRDKit enrichment: {total} rows to process")

        with tgt.cursor() as cur:
            for row_id, smiles in pending:
                try:
                    # RDKit raises or returns None on invalid SMILES
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

                    cur.execute(_UPDATE_PROPS, (mw, logp, hbd, hba, tpsa, rb, lip, str(row_id)))
                    enriched += 1

                    if enriched % BATCH_SIZE == 0:
                        tgt.commit()
                        print(f"Enriched {enriched} so far...")

                except Exception:
                    failed += 1

            tgt.commit()

    finally:
        tgt.close()

    return enriched, failed


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("Phase 1: data migration")
    print("=" * 60)
    inserted, skipped = run_migration()
    print(f"\nMigration complete: inserted {inserted}, skipped {skipped} duplicates")

    print()
    print("=" * 60)
    print("Phase 2: RDKit enrichment")
    print("=" * 60)
    enriched, failed = run_rdkit_enrichment()
    print(f"RDKit enrichment: enriched {enriched} rows, failed on {failed} invalid SMILES")
