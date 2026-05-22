from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.protein import GridMode, Protein, ProteinSource
from app.schemas.protein import ProteinOut
from app.services.protein_service import (
    compute_active_site_grid,
    compute_blind_grid,
    get_protein_metadata,
)

router = APIRouter()


# ── Request / response models ─────────────────────────────────────────────────

class GridboxRequest(BaseModel):
    protein_code: str
    chain: str
    mode: str = "blind"
    x_coord: Optional[float] = None
    y_coord: Optional[float] = None
    z_coord: Optional[float] = None
    radius: Optional[float] = None


# ── Shared helper ─────────────────────────────────────────────────────────────

def _get_or_create_protein(protein_code: str, db: Session) -> Protein:
    """
    Return the cached Protein row, creating it from the remote structure
    source if it does not exist yet.
    """
    code = protein_code.upper()

    protein = db.scalar(
        select(Protein).where(
            func.upper(Protein.protein_code) == code
        )
    )
    if protein is not None:
        return protein

    # Not cached — fetch metadata and persist
    metadata = get_protein_metadata(protein_code)

    source = (
        ProteinSource.PDB if len(protein_code) == 4
        else ProteinSource.AlphaFold
    )

    protein = Protein(
        protein_code=code,
        source=source,
        metadata_json=metadata,
        cached_at=datetime.now(timezone.utc),
    )
    db.add(protein)
    db.commit()
    db.refresh(protein)
    return protein


# ── GET /{protein_code} ───────────────────────────────────────────────────────

@router.get("/{protein_code}", response_model=ProteinOut)
def get_protein(protein_code: str, db: Session = Depends(get_db)) -> ProteinOut:
    try:
        return _get_or_create_protein(protein_code, db)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Could not fetch protein {protein_code} — "
                "check the PDB ID and try again"
            ),
        )


# ── GET /{protein_code}/chains ────────────────────────────────────────────────

@router.get("/{protein_code}/chains")
def get_chains(protein_code: str, db: Session = Depends(get_db)) -> dict:
    try:
        protein = _get_or_create_protein(protein_code, db)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Could not fetch protein {protein_code} — "
                "check the PDB ID and try again"
            ),
        )

    chains: list[str] = (protein.metadata_json or {}).get("chains", [])

    return {
        "protein_code": protein.protein_code,
        "chains": chains,
        "recommended": chains[0] if chains else None,
    }


# ── POST /gridbox ─────────────────────────────────────────────────────────────
# Declared before /{protein_code} routes so the literal path "gridbox"
# is not swallowed by the {protein_code} parameter.

@router.post("/gridbox")
def configure_gridbox(
    body: GridboxRequest,
    db: Session = Depends(get_db),
) -> dict:
    code = body.protein_code.upper()

    protein = db.scalar(
        select(Protein).where(func.upper(Protein.protein_code) == code)
    )
    if protein is None:
        raise HTTPException(
            status_code=404,
            detail=f"Protein {body.protein_code} not found — fetch it first via GET /api/protein/{body.protein_code}",
        )

    if body.mode == "blind":
        grid_params = compute_blind_grid(code, body.chain)

    elif body.mode == "active_site":
        if any(v is None for v in (body.x_coord, body.y_coord, body.z_coord, body.radius)):
            raise HTTPException(
                status_code=422,
                detail="All coordinates required for active site mode",
            )
        grid_params = compute_active_site_grid(
            body.x_coord, body.y_coord, body.z_coord, body.radius
        )

    else:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown mode {body.mode!r} — use 'blind' or 'active_site'",
        )

    # Persist the chain and grid configuration
    protein.selected_chain   = body.chain
    protein.grid_mode        = GridMode(body.mode)
    protein.grid_params_json = grid_params
    db.commit()

    return {
        "protein_code": protein.protein_code,
        "chain":        body.chain,
        "mode":         body.mode,
        "grid_params":  grid_params,
    }
