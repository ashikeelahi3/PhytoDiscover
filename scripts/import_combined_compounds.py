#!/usr/bin/env python3
"""
Import 58M-row phytochemical CSV into phytodiscover via a staging table.

Strategy
--------
Phase 1 — COPY raw CSV into an UNLOGGED staging table (fastest bulk load,
           no WAL overhead).  Uses psycopg2 copy_expert to stream the file
           directly through the socket; Python never holds the data.

Phase 2 — One SQL statement: GROUP BY smiles to produce 867K unique rows,
           merge organism/synonym into semicolon-joined TEXT fields, and
           INSERT into phytochemicals.  A CTE excludes SMILES already in
           the table so existing rows are never duplicated.

Phase 3 — DROP the staging table.

Phase 4 — RDKit enrichment (MW, logP, Lipinski, InChIKey) on every newly
           inserted row that has a SMILES but no molecular_weight.  Uses a
           PostgreSQL named (server-side) cursor so the full pending set is
           never loaded into Python memory.

Column mapping (CSV → phytochemicals):
    smiles      → smiles         (deduplication key, grouped by)
    name        → name           (MIN — alphabetically first non-NA value)
    organism    → source_plant   (string_agg DISTINCT, '; '-joined)
    synonym     → iupac_name     (string_agg DISTINCT, '; '-joined)
    pubchem_cid → pubchem_cid    (first numeric value per group)

Usage
-----
    # Full import (all 4 phases):
    python scripts/import_combined_compounds.py --file /path/to/data.csv

    # Estimate without writing anything:
    python scripts/import_combined_compounds.py --file /path/to/data.csv --dry-run

    # Skip Phases 1-3 (staging already loaded); run only enrichment:
    python scripts/import_combined_compounds.py --file /path/to/data.csv --skip-load

Safe to re-run: the NOT EXISTS guard skips SMILES already in phytochemicals.
"""

from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path

# Must happen before os.environ is read
load_dotenv(Path(__file__).parents[1] / ".env")

import argparse
import contextlib
import os
import sys
import time

import pandas as pd
import psycopg2

# ── RDKit noise suppression ───────────────────────────────────────────────────
# Must be set before any rdkit submodule is imported so the C library sees it.
os.environ.setdefault("RDKIT_VERBOSITY", "critical")

try:
    from rdkit import RDLogger as _rdlogger
    _rdlogger.DisableLog("rdApp.*")
except ImportError:
    pass


@contextlib.contextmanager
def suppress_stderr():
    """Redirect stderr to /dev/null to silence C-level RDKit parse noise."""
    old = sys.stderr
    try:
        with open(os.devnull, "w") as _devnull:
            sys.stderr = _devnull
            yield
    finally:
        sys.stderr = old


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
    options="-c statement_timeout=0",   # no timeout — queries can take 30+ min
)

# ── Tuning ────────────────────────────────────────────────────────────────────

ENRICH_BATCH = 1_000    # rows per UPDATE commit
ENRICH_PRINT = 5_000    # progress print interval

# ── NA sentinel values treated as NULL ───────────────────────────────────────
# Used in SQL IN-lists; must be a parenthesised SQL literal tuple.

_NA_SQL = "('NA', 'N/A', 'na', 'n/a', 'NaN', 'nan', 'null', 'NULL', '')"
_NA_PY  = frozenset({"NA", "N/A", "na", "n/a", "NaN", "nan", "null", "NULL", ""})

# ── DDL / DML constants ───────────────────────────────────────────────────────

_DDL_STAGING = """\
CREATE UNLOGGED TABLE IF NOT EXISTS staging_compounds (
    smiles      TEXT,
    name        TEXT,
    organism    TEXT,
    synonym     TEXT,
    pubchem_cid TEXT
);"""

_TRUNCATE_STAGING = "TRUNCATE staging_compounds;"

# Binary-mode COPY — fastest path; PostgreSQL owns the encoding decode.
_COPY_SQL = (
    "COPY staging_compounds (smiles, name, organism, synonym, pubchem_cid) "
    "FROM STDIN WITH (FORMAT CSV, HEADER TRUE)"
)

# Convert NA-like strings to NULL after COPY.
# The WHERE clause limits the UPDATE to only rows that need it.
_CLEAN_NA = f"""\
UPDATE staging_compounds
   SET name        = CASE WHEN name        IN {_NA_SQL} THEN NULL ELSE name        END,
       organism    = CASE WHEN organism    IN {_NA_SQL} THEN NULL ELSE organism    END,
       synonym     = CASE WHEN synonym     IN {_NA_SQL} THEN NULL ELSE synonym     END,
       pubchem_cid = CASE WHEN pubchem_cid IN {_NA_SQL} THEN NULL ELSE pubchem_cid END
 WHERE name        IN {_NA_SQL}
    OR organism    IN {_NA_SQL}
    OR synonym     IN {_NA_SQL}
    OR pubchem_cid IN {_NA_SQL};"""

# Widen source_plant to TEXT so merged organism strings (potentially thousands
# of plant names joined with '; ') cannot overflow the old String(512) limit.
# iupac_name is already TEXT in the model; ALTER is idempotent for TEXT→TEXT.
_WIDEN_COLS = """\
ALTER TABLE phytochemicals
    ALTER COLUMN source_plant TYPE TEXT,
    ALTER COLUMN name         TYPE TEXT;"""

# Partial index on phytochemicals.smiles speeds up the EXCEPT clause in Phase 2.
_IDX_SMILES = """\
CREATE INDEX IF NOT EXISTS idx_phytochemicals_smiles
    ON phytochemicals (smiles)
 WHERE smiles IS NOT NULL;"""

# ── Core INSERT SELECT ────────────────────────────────────────────────────────
#
# CTE `new_smiles`:
#   Computes the DISTINCT SMILES values present in staging but NOT yet in
#   phytochemicals.  EXCEPT is efficient with the partial index above.
#
# Main SELECT:
#   JOINs staging back to new_smiles so only the ~867K target compounds are
#   aggregated (not all 58M rows scanned for the CTE).
#   • name        — MIN() gives deterministic alphabetically-first non-null value.
#   • source_plant — string_agg DISTINCT merges all unique organism names.
#   • iupac_name  — string_agg DISTINCT merges all unique synonym values.
#   • pubchem_cid — first valid integer CID; regex guard prevents cast errors.
#   • COALESCE for name ensures the NOT NULL constraint is never violated.

_INSERT_SQL = f"""\
WITH new_smiles AS (
    SELECT DISTINCT smiles
      FROM staging_compounds
     WHERE smiles IS NOT NULL
       AND smiles NOT IN {_NA_SQL}
    EXCEPT
    SELECT smiles
      FROM phytochemicals
     WHERE smiles IS NOT NULL
)
INSERT INTO phytochemicals
    (id, name, smiles, source_plant, iupac_name, pubchem_cid)
SELECT
    gen_random_uuid(),
    COALESCE(
        MIN(s.name) FILTER (WHERE s.name IS NOT NULL),
        'Unknown'
    ),
    s.smiles,
    NULLIF(
        string_agg(DISTINCT s.organism, '; ')
            FILTER (WHERE s.organism IS NOT NULL),
        ''
    ),
    NULLIF(
        string_agg(DISTINCT s.synonym, '; ')
            FILTER (WHERE s.synonym IS NOT NULL),
        ''
    ),
    (
        array_agg(
            CASE
                WHEN s.pubchem_cid ~ E'^[0-9]+(\\.[0-9]+)?$'
                THEN FLOOR(s.pubchem_cid::numeric)::integer
                ELSE NULL
            END
        ) FILTER (WHERE s.pubchem_cid IS NOT NULL)
    )[1]
  FROM staging_compounds s
  JOIN new_smiles ns ON s.smiles = ns.smiles
 GROUP BY s.smiles;"""

_DROP_STAGING = "DROP TABLE IF EXISTS staging_compounds;"

_COUNT_PENDING = """\
SELECT COUNT(*)
  FROM phytochemicals
 WHERE smiles IS NOT NULL
   AND molecular_weight IS NULL;"""

_SELECT_PENDING = """\
SELECT id, smiles
  FROM phytochemicals
 WHERE smiles IS NOT NULL
   AND molecular_weight IS NULL
 ORDER BY id;"""

_UPDATE_PROPS = """\
UPDATE phytochemicals
   SET molecular_weight = %s,
       logp             = %s,
       h_bond_donors    = %s,
       h_bond_acceptors = %s,
       tpsa             = %s,
       rotatable_bonds  = %s,
       lipinski_pass    = %s,
       inchikey         = %s
 WHERE id = %s;"""


# ── Dry-run estimation (no DB staging) ───────────────────────────────────────

def run_dry_run(csv_path: Path) -> None:
    """
    Estimate import impact by streaming the CSV directly with pandas.

    No staging table is created; the DB is queried once (read-only) to
    find existing SMILES.  No writes are performed at any stage.
    """
    print(f"\nPhase 1: counting rows and collecting unique SMILES (no DB writes) …")
    t = time.monotonic()

    total_rows = 0
    file_smiles: set[str] = set()

    for chunk in pd.read_csv(
        csv_path,
        chunksize=100_000,
        usecols=["smiles"],
        dtype=str,
        na_filter=False,   # keep raw strings; we filter via _NA_PY
    ):
        total_rows += len(chunk)
        for raw in chunk["smiles"]:
            s = raw.strip() if isinstance(raw, str) else ""
            if s and s not in _NA_PY:
                file_smiles.add(s)
        if total_rows % 5_000_000 == 0:
            print(
                f"  … {total_rows:,} rows read, "
                f"{len(file_smiles):,} unique SMILES so far"
            )

    scan_elapsed = time.monotonic() - t
    print(
        f"Phase 1: would COPY {total_rows:,} rows to staging  "
        f"({scan_elapsed:.1f}s)\n"
    )

    print("Phase 2: estimating new unique compounds …")
    conn = psycopg2.connect(**TARGET_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT smiles FROM phytochemicals WHERE smiles IS NOT NULL")
            db_smiles: set[str] = {row[0] for row in cur.fetchall()}
            cur.execute("SELECT COUNT(*) FROM phytochemicals")
            db_total: int = cur.fetchone()[0]
    finally:
        conn.close()

    already_in_db  = len(file_smiles & db_smiles)
    would_insert   = len(file_smiles - db_smiles)
    db_total_after = db_total + would_insert

    # Rough timing estimate at 100–300 SMILES/s
    lo_h = max(1, would_insert // 300 // 3600)
    hi_h = max(2, would_insert // 100 // 3600)

    print(f"  Unique SMILES in file    : {len(file_smiles):>10,}")
    print(f"  Already in database      : {already_in_db:>10,}")
    print(f"  Would insert as new      : {would_insert:>10,}")
    print(f"  Database total after     : {db_total_after:>10,}")
    print(f"\nPhase 3: would drop staging table")
    print(
        f"Phase 4: would enrich ~{would_insert:,} compounds with RDKit  "
        f"(estimated {lo_h}–{hi_h} hours)\n"
    )
    print("Dry-run complete — no changes written.")


# ── Phase 1 — Bulk load ───────────────────────────────────────────────────────

def run_load(csv_path: Path) -> int:
    """
    COPY csv_path into staging_compounds.

    Returns the number of rows loaded.
    """
    print(f"\nPhase 1: Bulk load into staging table")
    print(f"  File: {csv_path}  ({csv_path.stat().st_size / 1_073_741_824:.2f} GB)")

    conn = psycopg2.connect(**TARGET_DSN)
    conn.autocommit = False
    t = time.monotonic()

    try:
        with conn.cursor() as cur:
            cur.execute(_DDL_STAGING)
            cur.execute(_TRUNCATE_STAGING)
            conn.commit()
            print("  Staging table ready — starting COPY (this may take several minutes) …")

            # Binary-mode open: psycopg2 copy_expert streams bytes directly to
            # the PostgreSQL COPY protocol.  No Python row-by-row processing.
            with open(csv_path, "rb") as fh:
                cur.copy_expert(_COPY_SQL, fh)
            conn.commit()

            cur.execute("SELECT COUNT(*) FROM staging_compounds;")
            n = cur.fetchone()[0]
            elapsed = time.monotonic() - t
            print(f"  Loaded {n:,} rows in {elapsed:.1f}s  ({n / elapsed:,.0f} rows/s)")

            # Convert NA-like strings to NULL; only touches rows that need it.
            print("  Normalising NA values …")
            t2 = time.monotonic()
            cur.execute(_CLEAN_NA)
            updated = cur.rowcount
            conn.commit()
            print(f"  Cleaned {updated:,} rows containing NA values  "
                  f"({time.monotonic() - t2:.1f}s)")

    finally:
        conn.close()

    print(f"Phase 1 complete in {time.monotonic() - t:.1f}s\n")
    return n


# ── Phase 2 — Deduplicate and insert ─────────────────────────────────────────

def run_insert() -> int:
    """
    Aggregate staging_compounds by smiles and INSERT into phytochemicals.

    Returns the number of rows inserted.
    """
    print("Phase 2: Deduplicate and insert into phytochemicals")

    conn = psycopg2.connect(**TARGET_DSN)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # ── Widen source_plant (was String(512)) ──────────────────────────
            print("  Widening source_plant / name columns to TEXT …")
            try:
                cur.execute(_WIDEN_COLS)
                conn.commit()
            except Exception as exc:
                conn.rollback()
                # Columns may already be TEXT — that's fine.
                print(f"  (Column widen skipped: {exc!s:.80})")

            # ── Index for the EXCEPT clause ───────────────────────────────────
            print("  Ensuring index on phytochemicals(smiles) …")
            cur.execute(_IDX_SMILES)
            conn.commit()

            # ── Give aggregation more working memory ─────────────────────────
            cur.execute("SET work_mem = '1GB';")

            # ── Main insert — single long-running statement ───────────────────
            print("  Running GROUP BY / INSERT  "
                  "(expected 10–30 min for 58M rows → 867K groups) …")
            t = time.monotonic()
            cur.execute(_INSERT_SQL)
            inserted = cur.rowcount
            conn.commit()
            elapsed = time.monotonic() - t
            print(f"  Inserted {inserted:,} unique compounds in {elapsed:.1f}s")

    finally:
        conn.close()

    print(f"Phase 2 complete\n")
    return inserted


# ── Phase 3 — Drop staging table ─────────────────────────────────────────────

def run_drop_staging() -> None:
    print("Phase 3: Dropping staging table …")
    conn = psycopg2.connect(**TARGET_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(_DROP_STAGING)
        conn.commit()
        print("  staging_compounds dropped.\n")
    finally:
        conn.close()


# ── Phase 4 — RDKit enrichment ────────────────────────────────────────────────

def run_rdkit_enrichment() -> tuple[int, int]:
    """
    Compute molecular descriptors + InChIKey for every row with SMILES but
    no molecular_weight (i.e. newly inserted rows).

    Uses keyset pagination (id > last_id) so each batch is an independent
    transaction — no named cursor, no cross-commit cursor invalidation.
    Safe to interrupt and resume: re-running --skip-load picks up where
    enrichment stopped because it only targets rows where MW IS NULL.

    Returns (enriched, failed).
    """
    print("Phase 4: RDKit enrichment  (MW, logP, Lipinski, InChIKey)")

    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, rdMolDescriptors
        from rdkit.Chem.inchi import MolToInchiKey
    except ImportError as exc:
        print(f"  RDKit unavailable ({exc}) — skipping enrichment.")
        print("  Re-run with RDKit available, or use --skip-load to run only Phase 4.")
        return 0, 0

    BATCH_SIZE = 1_000

    conn = psycopg2.connect(**TARGET_DSN)
    conn.autocommit = False

    with conn.cursor() as cur:
        cur.execute(_COUNT_PENDING)
        total = cur.fetchone()[0]

    if total == 0:
        print("  Nothing to enrich — all rows already have molecular_weight.")
        conn.close()
        return 0, 0

    lo_min = total // 300 // 60
    hi_min = total // 100 // 60
    print(f"  {total:,} rows to enrich  (estimated {lo_min}–{hi_min} min)")

    enriched          = 0
    failed            = 0
    inchikey_set      = 0
    inchikey_conflict = 0
    last_id           = None
    t_start           = time.monotonic()

    try:
        while True:
            # ── Fetch next page ───────────────────────────────────────────────
            with conn.cursor() as cur:
                if last_id is None:
                    cur.execute(
                        "SELECT id, smiles FROM phytochemicals"
                        " WHERE smiles IS NOT NULL AND molecular_weight IS NULL"
                        " ORDER BY id LIMIT %s",
                        (BATCH_SIZE,),
                    )
                else:
                    cur.execute(
                        "SELECT id, smiles FROM phytochemicals"
                        " WHERE smiles IS NOT NULL AND molecular_weight IS NULL"
                        "   AND id > %s"
                        " ORDER BY id LIMIT %s",
                        (str(last_id), BATCH_SIZE),
                    )
                rows = cur.fetchall()

            if not rows:
                break

            # ── Compute properties ────────────────────────────────────────────
            updates: list[tuple] = []
            for row_id, smiles in rows:
                try:
                    with suppress_stderr():
                        mol = Chem.MolFromSmiles(smiles)
                    if mol is None:
                        failed  += 1
                        last_id  = row_id
                        continue

                    mw   = Descriptors.MolWt(mol)
                    logp = Descriptors.MolLogP(mol)
                    hbd  = rdMolDescriptors.CalcNumHBD(mol)
                    hba  = rdMolDescriptors.CalcNumHBA(mol)
                    tpsa = Descriptors.TPSA(mol)
                    rb   = rdMolDescriptors.CalcNumRotatableBonds(mol)
                    lip  = bool(mw < 500 and logp < 5 and hbd <= 5 and hba <= 10)

                    try:
                        inchikey = MolToInchiKey(mol)
                    except Exception:
                        inchikey = None

                    updates.append((
                        round(mw, 3), round(logp, 3), hbd, hba,
                        round(tpsa, 3), rb, lip, inchikey,
                        str(row_id),
                    ))
                    last_id = row_id

                except Exception:
                    failed  += 1
                    last_id  = row_id

            # ── Part 1: commit RDKit properties (no unique constraints) ──────
            if updates:
                with conn.cursor() as cur:
                    cur.executemany(
                        "UPDATE phytochemicals SET"
                        "  molecular_weight = %s,"
                        "  logp             = %s,"
                        "  h_bond_donors    = %s,"
                        "  h_bond_acceptors = %s,"
                        "  tpsa             = %s,"
                        "  rotatable_bonds  = %s,"
                        "  lipinski_pass    = %s"
                        " WHERE id = %s",
                        [(u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[8])
                         for u in updates],
                    )
                conn.commit()
                enriched += len(updates)

            # ── Part 2: inchikey via savepoints ───────────────────────────────
            # Each row gets its own SAVEPOINT so a UniqueViolation (same
            # molecule with different SMILES, or same InChIKey in this batch)
            # rolls back only that one update.  All other inchikeys and all
            # property updates from Part 1 are unaffected.
            with conn.cursor() as cur:
                for u in updates:
                    new_inchikey = u[7]
                    row_id       = u[8]
                    if not new_inchikey:
                        continue
                    cur.execute("SAVEPOINT ik")
                    try:
                        cur.execute(
                            "UPDATE phytochemicals SET inchikey = %s"
                            " WHERE id = %s",
                            (new_inchikey, row_id),
                        )
                        cur.execute("RELEASE SAVEPOINT ik")
                        inchikey_set += 1
                    except psycopg2.errors.UniqueViolation:
                        cur.execute("ROLLBACK TO SAVEPOINT ik")
                        inchikey_conflict += 1
            conn.commit()

            # ── Progress ──────────────────────────────────────────────────────
            processed = enriched + failed
            if processed % 5_000 < BATCH_SIZE:
                elapsed = time.monotonic() - t_start
                pct     = processed * 100 / total if total else 100
                rate    = processed / elapsed if elapsed else 0
                eta_min = (total - processed) / rate / 60 if rate else 0
                print(
                    f"  enriched {enriched:>8,} / {total:,}"
                    f"  ({pct:.1f}%)  failed {failed:,}"
                    f"  {rate:,.0f} rows/s  ETA {eta_min:.0f} min"
                )

    finally:
        conn.close()

    elapsed = time.monotonic() - t_start
    print(
        f"  Done — enriched {enriched:,}, failed {failed:,}"
        f"  ({elapsed / 60:.1f} min)\n"
        f"  Inchikeys set:    {inchikey_set:>10,}\n"
        f"  Inchikey skipped: {inchikey_conflict:>10,}"
        f"  (left NULL due to duplicates — properties still updated)\n"
    )
    return enriched, failed


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Bulk-import 58M-row phytochemical CSV into phytodiscover "
            "using a PostgreSQL staging table for deduplication."
        )
    )
    parser.add_argument(
        "--file",
        required=True,
        metavar="PATH",
        help="Path to the CSV file (smiles, name, organism, synonym, pubchem_cid)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Count rows and estimate inserts without writing to the database. "
            "Phase 1 counts lines; Phase 2 queries distinct new SMILES."
        ),
    )
    parser.add_argument(
        "--skip-load",
        action="store_true",
        help=(
            "Skip Phases 1-3 (COPY + SQL dedup + drop staging). "
            "Runs only Phase 4 (RDKit enrichment). "
            "Use this if the import completed but enrichment was interrupted."
        ),
    )
    args = parser.parse_args()

    csv_path = Path(args.file)
    if not csv_path.exists():
        sys.exit(f"File not found: {csv_path}")

    size_gb = csv_path.stat().st_size / 1_073_741_824

    if args.dry_run:
        mode = "DRY RUN — no database writes"
    elif args.skip_load:
        mode = "ENRICHMENT ONLY — skip Phases 1-3"
    else:
        mode = "FULL IMPORT — all 4 phases"

    print("=" * 70)
    print("  PhytoDiscover — combined compound import")
    print(f"  File  : {csv_path}  ({size_gb:.2f} GB)")
    print(f"  Mode  : {mode}")
    if not args.dry_run:
        print("  Note  : Safe to re-run — existing SMILES are excluded automatically.")
    if not args.dry_run and not args.skip_load:
        print("  Steps : COPY → NA cleanup → SQL dedup/insert → RDKit enrichment")
        print("  Time  : expect 30–120 min (hardware-dependent)")
    print("=" * 70)

    t_total = time.monotonic()

    # ── Dry-run: estimate only, no staging table ──────────────────────────────

    if args.dry_run:
        run_dry_run(csv_path)
        return

    # ── Phases 1-3 ────────────────────────────────────────────────────────────

    if not args.skip_load:
        rows_loaded = run_load(csv_path)
        inserted    = run_insert()
        run_drop_staging()

    # ── Phase 4 ───────────────────────────────────────────────────────────────

    enriched, failed = run_rdkit_enrichment()

    total_elapsed = time.monotonic() - t_total
    print("=" * 70)
    if not args.skip_load:
        print(f"  Rows loaded (staging)  : {rows_loaded:>10,}")
        print(f"  Unique compounds added : {inserted:>10,}")
    print(f"  Enriched with RDKit    : {enriched:>10,}")
    print(f"  Skipped (bad SMILES)   : {failed:>10,}")
    print(f"  Total runtime          : {total_elapsed / 60:>9.1f} min")
    print("=" * 70)


if __name__ == "__main__":
    main()
