"""
Wrapper around backend/protein_&_chain_selection.py.

The source file cannot be imported with a normal `import` statement because
its filename contains `&`.  importlib.import_module handles arbitrary module
names and is the standard workaround for this case.

This module must only be imported inside a Celery worker process, NOT at
FastAPI startup, because the pipeline depends on nglview (Jupyter) and on
module-level globals that are set during the docking task setup.
"""

import os
import sys
import types
import builtins
import importlib
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Add backend/ to sys.path so importlib can locate the pipeline file
sys.path.insert(0, str(Path(__file__).parents[2]))

# Patch AutoDockTools.Utilities24 to add the missing protein_preparation_likeADT
# submodule before importing protein_&_chain_selection, which does:
#   from AutoDockTools.Utilities24 import protein_preparation_likeADT
# That submodule does not exist in the Python 3 ADT port, so the import fails
# without this patch. The mock main() is a no-op; the real PDBQT conversion is
# handled by convert_protein_to_pdbqt() further below.
try:
    import AutoDockTools.Utilities24 as _adt_u24
    if not hasattr(_adt_u24, "protein_preparation_likeADT"):
        _mock = types.ModuleType("protein_preparation_likeADT")
        _mock.main = lambda **kwargs: None
        _adt_u24.protein_preparation_likeADT = _mock
        sys.modules["AutoDockTools.Utilities24.protein_preparation_likeADT"] = _mock
except Exception:
    pass

# Inject the names used as function default parameter values so Python can
# resolve them at import time (they are module-level globals in the pipeline
# file, but are not yet defined when the module is first exec'd).
_INJECTED_NAMES = {
    "three_d_structure": None,
    "updated_model":     None,
    "protein_id":        "",
    "pathway":           "",
    "separator":         os.sep,
}
for _name, _val in _INJECTED_NAMES.items():
    if not hasattr(builtins, _name):
        setattr(builtins, _name, _val)

_mod = importlib.import_module("protein_&_chain_selection")

# Remove the temporary builtins immediately — we only needed them long enough
# for the module's function definitions to be evaluated.
for _name in _INJECTED_NAMES:
    try:
        delattr(builtins, _name)
    except AttributeError:
        pass

protein_structure_calling    = _mod.protein_structure_calling
chain_list                   = _mod.chain_list
chain_selection              = _mod.chain_selection
chain_cleaning               = _mod.chain_cleaning
calculate_grid_box_bd        = _mod.calculate_grid_box_bd
calculate_grid_box_as        = _mod.calculate_grid_box_as
protein_saving               = _mod.protein_saving
# protein_preparation_automate now calls mock_module.main() → no-op.
# The real PDBQT conversion is done by convert_protein_to_pdbqt() below.
protein_preparation_automate = _mod.protein_preparation_automate


class ProteinPrepError(Exception):
    pass


def convert_protein_to_pdbqt(
    pdb_path: str,
    pdbqt_path: str,
    job_id: str,
) -> str:
    """
    Converts a cleaned protein PDB file to PDBQT format.
    Tries three methods in order:
      1. prepare_receptor (AutoDockTools)
      2. meeko + RDKit
      3. obabel
    Returns the pdbqt_path on success, raises ProteinPrepError if all fail.
    """
    import shutil
    import subprocess

    # ── Method 1: prepare_receptor (AutoDockTools) ────────────────────────
    prepare_receptor = shutil.which("prepare_receptor")
    if not prepare_receptor:
        try:
            import AutoDockTools
            adt_path = os.path.dirname(AutoDockTools.__file__)
            candidate = os.path.join(adt_path, "..", "..", "bin", "prepare_receptor")
            if os.path.exists(candidate):
                prepare_receptor = candidate
        except ImportError:
            pass

    if prepare_receptor:
        logger.info("[%s] Converting PDB to PDBQT via prepare_receptor", job_id)
        result = subprocess.run(
            [prepare_receptor, "-r", pdb_path, "-o", pdbqt_path, "-A", "hydrogens"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and os.path.exists(pdbqt_path):
            return pdbqt_path
        logger.warning("[%s] prepare_receptor failed: %s", job_id, result.stderr[:200])

    # ── Method 2: meeko + RDKit ───────────────────────────────────────────
    try:
        logger.info("[%s] Converting PDB to PDBQT via meeko", job_id)
        from meeko import MoleculePreparation
        from rdkit import Chem

        mol = Chem.MolFromPDBFile(pdb_path, removeHs=False)
        if mol is None:
            raise ValueError(f"RDKit could not read PDB file: {pdb_path}")

        mol = Chem.AddHs(mol, addCoords=True)

        preparator = MoleculePreparation()
        preparator.prepare(mol)
        preparator.write_pdbqt_file(pdbqt_path)

        if os.path.exists(pdbqt_path):
            logger.info("[%s] PDBQT written via meeko: %s", job_id, pdbqt_path)
            return pdbqt_path

    except Exception as e:
        logger.warning("[%s] meeko failed: %s", job_id, e)

    # ── Method 3: obabel (last resort) ───────────────────────────────────
    obabel = shutil.which("obabel")
    if obabel:
        logger.info("[%s] Converting PDB to PDBQT via obabel", job_id)
        result = subprocess.run(
            [obabel, pdb_path, "-O", pdbqt_path, "-xr", "--partialcharge", "gasteiger"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and os.path.exists(pdbqt_path):
            return pdbqt_path

    raise ProteinPrepError(
        f"Could not convert {pdb_path} to PDBQT. "
        "Tried prepare_receptor, meeko, and obabel — all failed."
    )


def run_protein_preparation(
    job_id: str,
    protein_code: str,
    chain: str,
    grid_mode: str,
    grid_params: dict,
    pathway: str,
) -> dict:
    """
    Orchestrates the full protein preparation pipeline.
    Each step is logged with the job_id prefix.
    Returns dict with pdb_path, pdbqt_path, grid_config.
    Raises ProteinPrepError on any failure.
    """
    try:
        logger.info(f"[{job_id}] Step 1: downloading protein {protein_code}")

        result = protein_structure_calling(id=protein_code)

        # Handle both tuple and single return value
        if isinstance(result, tuple):
            three_d_structure, protein_id = result
        else:
            three_d_structure = result
            protein_id = protein_code

        logger.info(f"[{job_id}] Got structure for {protein_id}")

        # Propagate return values into the module's global namespace so that
        # the pipeline functions (which read these as module-level globals)
        # see the correct structure and id for subsequent calls.
        _mod.three_d_structure = three_d_structure
        _mod.protein_id        = protein_id
        _mod.pathway           = pathway
        _mod.updated_model     = None   # set properly after chain_selection()

        logger.info(f"[{job_id}] Step 2: listing chains")
        try:
            chain_list(model_structure=three_d_structure)
        except Exception as e:
            logger.warning(f"[{job_id}] chain_list failed (non-fatal): {e}")

        logger.info(f"[{job_id}] Step 3: selecting chain {chain}")
        updated_model = chain_selection(chain_name=chain)
        logger.info(f"[{job_id}] updated_model type: {type(updated_model)}")

        # Update ALL module globals that subsequent functions need
        _mod.pathway       = pathway
        _mod.updated_model = updated_model
        _mod.protein_id    = protein_id
        _mod.separator     = os.sep
        logger.info(
            f"[{job_id}] Module globals updated: "
            f"pathway={pathway}, protein_id={protein_id}"
        )

        logger.info(f"[{job_id}] Step 4: cleaning chain")
        chain_cleaning(structure=updated_model)

        config_dir = os.path.join(pathway, "configuration_file")
        os.makedirs(config_dir, exist_ok=True)
        logger.info(f"[{job_id}] Created configuration_file/ directory")

        logger.info(f"[{job_id}] Step 5: calculating grid box ({grid_mode})")
        if grid_mode == "blind":
            calculate_grid_box_bd(protein=updated_model)
        elif grid_mode == "active_site":
            calculate_grid_box_as(
                x_coord=grid_params.get("x"),
                y_coord=grid_params.get("y"),
                z_coord=grid_params.get("z"),
                radius=grid_params.get("radius"),
            )
        else:
            raise ProteinPrepError(f"Unknown grid mode: {grid_mode}")

        logger.info(f"[{job_id}] Step 6: saving protein")
        from Bio.PDB import PDBIO

        pdb_save_dir = os.path.join(pathway, "protein_pdb_files")
        os.makedirs(pdb_save_dir, exist_ok=True)
        pdb_save_path = os.path.join(pdb_save_dir, f"{protein_id}.pdb")

        _io = PDBIO()
        _io.set_structure(updated_model)
        _io.save(pdb_save_path)
        logger.info(f"[{job_id}] Protein saved to {pdb_save_path}")

        logger.info(f"[{job_id}] Step 7: converting to PDBQT")
        pdbqt_save_dir = os.path.join(pathway, "protein_pdbqt_files")
        os.makedirs(pdbqt_save_dir, exist_ok=True)
        pdbqt_save_path = os.path.join(pdbqt_save_dir, f"{protein_id}.pdbqt")

        convert_protein_to_pdbqt(
            pdb_path=pdb_save_path,
            pdbqt_path=pdbqt_save_path,
            job_id=job_id,
        )

        logger.info(f"[{job_id}] Protein preparation complete")
        return {
            "pdb_path":    pdb_save_path,
            "pdbqt_path":  pdbqt_save_path,
            "grid_config": grid_params,
        }

    except ProteinPrepError:
        raise
    except Exception as e:
        raise ProteinPrepError(
            f"Protein preparation failed at job {job_id}: {str(e)}"
        ) from e
