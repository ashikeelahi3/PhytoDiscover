from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.phytochemical import Phytochemical
from app.services.rdkit_service import validate_smiles

router = APIRouter()


# ── Request / response models ─────────────────────────────────────────────────

class SmilesValidateRequest(BaseModel):
    smiles: list[str]


class PlantCompound(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    smiles: Optional[str]
    source_plant: Optional[str]


class PlantRequest(BaseModel):
    plant_name: str


class EnrichRequest(BaseModel):
    batch_size: int = Field(100, ge=1, le=500)


class EnrichResponse(BaseModel):
    enriched: int
    failed: int
    remaining: int


# ── POST /validate ────────────────────────────────────────────────────────────

@router.post("/validate")
def validate_batch(body: SmilesValidateRequest) -> list[dict]:
    if not body.smiles:
        return []
    return [validate_smiles(s) for s in body.smiles]


# ── POST /from-plant ──────────────────────────────────────────────────────────

@router.post("/from-plant", response_model=list[PlantCompound])
def from_plant(
    body: PlantRequest,
    db: Session = Depends(get_db),
) -> list[PlantCompound]:
    rows = db.scalars(
        select(Phytochemical)
        .where(
            Phytochemical.source_plant.ilike(f"%{body.plant_name}%"),
            Phytochemical.smiles.isnot(None),
        )
        .limit(200)
    ).all()
    return rows


# ── POST /enrich ──────────────────────────────────────────────────────────────

@router.post("/enrich", response_model=EnrichResponse)
def enrich_batch(
    body: EnrichRequest,
    db: Session = Depends(get_db),
) -> EnrichResponse:
    _pending_filter = (
        Phytochemical.smiles.isnot(None),
        Phytochemical.molecular_weight.is_(None),
    )

    # Count BEFORE processing so the caller knows total pending pre-batch
    remaining = db.scalar(
        select(func.count(Phytochemical.id)).where(*_pending_filter)
    )

    rows = db.scalars(
        select(Phytochemical).where(*_pending_filter).limit(body.batch_size)
    ).all()

    enriched = failed = 0

    for compound in rows:
        result = validate_smiles(compound.smiles)
        if not result["is_valid"]:
            failed += 1
            continue

        compound.molecular_weight = result["molecular_weight"]
        compound.logp             = result["logp"]
        compound.h_bond_donors    = result["h_bond_donors"]
        compound.h_bond_acceptors = result["h_bond_acceptors"]
        compound.tpsa             = result["tpsa"]
        compound.rotatable_bonds  = result["rotatable_bonds"]
        compound.lipinski_pass    = result["lipinski_pass"]
        enriched += 1

    db.commit()

    return EnrichResponse(enriched=enriched, failed=failed, remaining=remaining)
