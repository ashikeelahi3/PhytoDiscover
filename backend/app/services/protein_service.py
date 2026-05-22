"""
Protein structure fetching, metadata extraction, and grid-box calculation.

The pipeline file (backend/protein_&_chain_selection.py) cannot be imported
at module level: it imports nglview (Jupyter-only) and uses uninitialised
module-level globals as function default arguments.  The functions here
implement identical algorithms using BioPython + numpy directly.

When a Celery docking task runs, the pipeline functions are called in that
worker process where the globals have been set up by the task setup step.
"""

import warnings
from io import StringIO

import numpy as np
import requests
from Bio.PDB import MMCIF2Dict
from Bio.PDB.MMCIFParser import MMCIFParser
from Bio.PDB.PDBExceptions import PDBConstructionWarning
from fastapi import HTTPException

warnings.simplefilter("ignore", PDBConstructionWarning)

_RCSB_CIF_URL    = "https://files.rcsb.org/download/{code}.cif"
_AF_API_URL      = "https://alphafold.ebi.ac.uk/api/prediction/{code}"
_REQUEST_TIMEOUT = 30


# ── Internal helpers ──────────────────────────────────────────────────────────

def _fetch_pdb(pdb_id: str):
    """Download and parse a PDB/RCSB CIF structure."""
    resp = requests.get(_RCSB_CIF_URL.format(code=pdb_id), timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return MMCIFParser().get_structure(pdb_id, StringIO(resp.text))


def _fetch_alphafold(af_id: str):
    """Download and parse an AlphaFold CIF structure."""
    resp = requests.get(_AF_API_URL.format(code=af_id), timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    entries = resp.json()
    if not entries:
        raise ValueError(f"No AlphaFold entry for {af_id!r}")
    cif_url = entries[0]["cifUrl"]
    cif_resp = requests.get(cif_url, timeout=60)
    cif_resp.raise_for_status()
    return MMCIFParser().get_structure(af_id, StringIO(cif_resp.text))


def fetch_structure(protein_code: str):
    """
    Fetch a BioPython Structure object for protein_code.
    Tries RCSB first (4-char codes), then AlphaFold.
    Raises HTTPException(404) if neither source returns a structure.
    """
    code = protein_code.upper()
    try:
        return _fetch_pdb(code)
    except Exception:
        pass
    try:
        return _fetch_alphafold(protein_code)
    except Exception:
        pass
    raise HTTPException(
        status_code=404,
        detail=(
            f"Could not fetch protein {protein_code} — "
            "check the PDB ID and try again"
        ),
    )


# ── Public API ────────────────────────────────────────────────────────────────

def get_protein_metadata(protein_code: str) -> dict:
    """
    Downloads protein structure and extracts metadata.
    Returns dict with: chains, organism, resolution,
    method, title, chain_count, residue_count.
    Wraps all calls in try/except; raises HTTPException on failure.
    """
    structure = fetch_structure(protein_code)

    try:
        header      = structure.header
        model       = structure[0]
        chains      = [ch.id for ch in model.get_chains()]
        chain_count = len(chains)

        # Count only standard residues (ATOM records, not HETATM)
        residue_count = sum(
            1 for res in model.get_residues() if res.id[0] == " "
        )

        return {
            "chains":         chains,
            "chain_count":    chain_count,
            "residue_count":  residue_count,
            "organism":       header.get("organism") or "",
            "resolution":     header.get("resolution"),
            "method":         header.get("structure_method") or "",
            "title":          header.get("name") or "",
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse structure for {protein_code}: {exc}",
        ) from exc


def compute_blind_grid(protein_code: str, chain_name: str) -> dict:
    """
    Mirrors calculate_grid_box_bd() from the pipeline file.

    Downloads the structure, selects the requested chain, removes
    HETATM residues (mirrors chain_cleaning()), then computes the
    bounding-box grid with 3 Å padding on each side.

    Returns center_x/y/z and size_x/y/z as a dict.
    """
    structure  = fetch_structure(protein_code)
    model      = structure[0]

    if chain_name not in [ch.id for ch in model.get_chains()]:
        raise HTTPException(
            status_code=422,
            detail=f"Chain {chain_name!r} not found in {protein_code}",
        )

    chain = model[chain_name]

    # chain_cleaning equivalent: remove HETATM / water residues
    to_remove = [
        res.id for res in chain if res.id[0] != " "
    ]
    for rid in to_remove:
        chain.detach_child(rid)

    atoms = list(chain.get_atoms())
    if not atoms:
        raise HTTPException(
            status_code=422,
            detail=f"No ATOM records in chain {chain_name!r} of {protein_code}",
        )

    coords     = np.array([atom.coord for atom in atoms])
    min_coords = np.min(coords, axis=0)
    max_coords = np.max(coords, axis=0)
    center     = (min_coords + max_coords) / 2
    size       = max_coords - min_coords + 6.0  # 3 Å padding each side

    return {
        "center_x": round(float(center[0]), 3),
        "center_y": round(float(center[1]), 3),
        "center_z": round(float(center[2]), 3),
        "size_x":   round(float(size[0]), 3),
        "size_y":   round(float(size[1]), 3),
        "size_z":   round(float(size[2]), 3),
    }


def compute_active_site_grid(
    x_coord: float,
    y_coord: float,
    z_coord: float,
    radius: float,
) -> dict:
    """
    Mirrors calculate_grid_box_as() from the pipeline file.
    Returns center_x/y/z and size (2×radius cube) as a dict.
    """
    side = radius * 2
    return {
        "center_x": x_coord,
        "center_y": y_coord,
        "center_z": z_coord,
        "size_x":   side,
        "size_y":   side,
        "size_z":   side,
    }
