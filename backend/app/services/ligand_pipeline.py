"""
Ligand preparation pipeline.

Bypasses drug_collection_and_processing.py entirely due to bugs in the
original file (typo path "drug_pdb_filesf", missing os.sep in path
concatenation). All 3D structure generation and PDBQT conversion is done
directly with RDKit + obabel (or meeko as fallback).
"""

import logging

logger = logging.getLogger(__name__)


class LigandPrepError(Exception):
    pass


def run_ligand_preparation(
    job_id: str,
    payload: dict,
    pathway: str,
    db,
) -> int:
    """
    Orchestrates the full ligand preparation pipeline.

    payload keys:
      compound_ids: list[str]  — UUIDs of phytochemicals in DB
      smiles_list:  list[str]  — direct SMILES strings
      plant_name:   str | None — plant name for DB lookup

    Returns count of ligands successfully prepared (PDBQT files).
    Raises LigandPrepError if no ligands were prepared.
    """
    import shutil
    import subprocess
    from pathlib import Path

    from rdkit import Chem
    from rdkit.Chem import AllChem

    from app.models.phytochemical import Phytochemical

    compound_ids = payload.get("compound_ids", [])
    smiles_list  = payload.get("smiles_list", [])
    plant_name   = payload.get("plant_name")

    drug_pdb_dir   = Path(pathway) / "drug_pdb_files"
    drug_pdbqt_dir = Path(pathway) / "drug_pdbqt_files"
    drug_pdb_dir.mkdir(exist_ok=True)
    drug_pdbqt_dir.mkdir(exist_ok=True)

    # Collect all (name, smiles) pairs to process
    all_smiles = []

    if plant_name:
        logger.info(f"[{job_id}] Looking up compounds for plant: {plant_name}")
        records = (
            db.query(Phytochemical)
            .filter(
                Phytochemical.source_plant.ilike(f"%{plant_name}%"),
                Phytochemical.smiles.isnot(None),
            )
            .limit(20)
            .all()
        )
        all_smiles.extend([(r.name, r.smiles) for r in records])

    if compound_ids:
        logger.info(f"[{job_id}] Fetching SMILES for {len(compound_ids)} compounds")
        records = (
            db.query(Phytochemical)
            .filter(
                Phytochemical.id.in_(compound_ids),
                Phytochemical.smiles.isnot(None),
            )
            .all()
        )
        all_smiles.extend([(r.name, r.smiles) for r in records])

    if smiles_list:
        all_smiles.extend([(f"compound_{i}", s) for i, s in enumerate(smiles_list)])

    if not all_smiles:
        raise LigandPrepError(f"No SMILES found for job {job_id}")

    logger.info(f"[{job_id}] Processing {len(all_smiles)} SMILES")

    obabel = shutil.which("obabel")
    prepared = 0

    for name, smiles in all_smiles:
        safe_name = "".join(
            c if c.isalnum() or c in "-_" else "_" for c in str(name)
        )[:50]

        pdb_path   = drug_pdb_dir   / f"{safe_name}.pdb"
        pdbqt_path = drug_pdbqt_dir / f"{safe_name}.pdbqt"

        try:
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                logger.warning(f"[{job_id}] Invalid SMILES for {name} — skipping")
                continue

            mol = Chem.AddHs(mol)
            params = AllChem.ETKDGv3()
            params.randomSeed = 42
            if AllChem.EmbedMolecule(mol, params) == -1:
                logger.warning(f"[{job_id}] Could not embed {name} — skipping")
                continue

            AllChem.MMFFOptimizeMolecule(mol)

            writer = Chem.PDBWriter(str(pdb_path))
            writer.write(mol)
            writer.close()

            if obabel:
                result = subprocess.run(
                    [obabel, str(pdb_path), "-O", str(pdbqt_path),
                     "--partialcharge", "gasteiger"],
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0 and pdbqt_path.exists():
                    prepared += 1
                    logger.info(f"[{job_id}] ✓ {name} prepared via obabel")
                else:
                    logger.warning(
                        f"[{job_id}] obabel failed for {name}: {result.stderr[:100]}"
                    )
            else:
                from meeko import MoleculePreparation
                preparator = MoleculePreparation()
                preparator.prepare(mol)
                preparator.write_pdbqt_file(str(pdbqt_path))
                if pdbqt_path.exists():
                    prepared += 1
                    logger.info(f"[{job_id}] ✓ {name} prepared via meeko")

        except Exception as e:
            logger.warning(f"[{job_id}] Failed to prepare {name}: {e}")
            continue

    logger.info(f"[{job_id}] Ligand preparation complete: {prepared} ligands")

    if prepared == 0:
        raise LigandPrepError(
            f"No ligands were prepared for job {job_id}. "
            "Check that SMILES strings are valid."
        )

    return prepared
