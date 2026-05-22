import csv
import io
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.phytochemical import Phytochemical
from app.schemas.phytochemical import CompoundStats, PhytochemicalOut

router = APIRouter()

_CSV_FIELDS = [
    "id", "name", "smiles", "source_plant", "plant_family",
    "molecular_weight", "logp", "h_bond_donors",
    "h_bond_acceptors", "lipinski_pass",
]


def _build_filters(
    name: Optional[str],
    source_plant: Optional[str],
    min_mw: Optional[float],
    max_mw: Optional[float],
    max_logp: Optional[float],
    lipinski_pass: Optional[bool],
    has_smiles: Optional[bool],
) -> list:
    filters = []

    if name is not None:
        filters.append(Phytochemical.name.ilike(f"%{name}%"))

    if source_plant is not None:
        filters.append(Phytochemical.source_plant.ilike(f"%{source_plant}%"))

    if min_mw is not None:
        filters.append(Phytochemical.molecular_weight.isnot(None))
        filters.append(Phytochemical.molecular_weight >= min_mw)

    if max_mw is not None:
        filters.append(Phytochemical.molecular_weight.isnot(None))
        filters.append(Phytochemical.molecular_weight <= max_mw)

    if max_logp is not None:
        filters.append(Phytochemical.logp.isnot(None))
        filters.append(Phytochemical.logp <= max_logp)

    if lipinski_pass is not None:
        filters.append(Phytochemical.lipinski_pass == lipinski_pass)

    if has_smiles is True:
        filters.append(Phytochemical.smiles.isnot(None))
    elif has_smiles is False:
        filters.append(Phytochemical.smiles.is_(None))

    return filters


# ── GET /search ───────────────────────────────────────────────────────────────

@router.get("/search", response_model=list[PhytochemicalOut])
def search_compounds(
    response: Response,
    name: Optional[str] = Query(None),
    source_plant: Optional[str] = Query(None),
    min_mw: Optional[float] = Query(None),
    max_mw: Optional[float] = Query(None),
    max_logp: Optional[float] = Query(None),
    lipinski_pass: Optional[bool] = Query(None),
    has_smiles: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[PhytochemicalOut]:
    filters = _build_filters(
        name, source_plant, min_mw, max_mw, max_logp, lipinski_pass, has_smiles
    )

    total = db.scalar(
        select(func.count(Phytochemical.id)).where(*filters)
    )
    response.headers["X-Total-Count"] = str(total)

    rows = db.scalars(
        select(Phytochemical).where(*filters).offset(skip).limit(limit)
    ).all()

    return rows


# ── GET /stats ────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=CompoundStats)
def compound_stats(db: Session = Depends(get_db)) -> CompoundStats:
    row = db.execute(
        select(
            func.count().label("total"),
            func.count(Phytochemical.smiles).label("with_smiles"),
            func.count(Phytochemical.molecular_weight).label("with_rdkit_props"),
            func.count(
                case((Phytochemical.lipinski_pass.is_(True), 1))
            ).label("lipinski_pass"),
        )
    ).one()

    return CompoundStats(
        total=row.total,
        with_smiles=row.with_smiles,
        with_rdkit_props=row.with_rdkit_props,
        lipinski_pass=row.lipinski_pass,
    )


# ── GET /export/csv ───────────────────────────────────────────────────────────

@router.get("/export/csv")
def export_csv(
    name: Optional[str] = Query(None),
    source_plant: Optional[str] = Query(None),
    min_mw: Optional[float] = Query(None),
    max_mw: Optional[float] = Query(None),
    max_logp: Optional[float] = Query(None),
    lipinski_pass: Optional[bool] = Query(None),
    has_smiles: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    filters = _build_filters(
        name, source_plant, min_mw, max_mw, max_logp, lipinski_pass, has_smiles
    )
    rows = db.scalars(select(Phytochemical).where(*filters)).all()

    def _generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS)
        writer.writeheader()
        yield buf.getvalue()

        for compound in rows:
            buf.seek(0)
            buf.truncate(0)
            writer.writerow({
                "id": str(compound.id),
                "name": compound.name,
                "smiles": compound.smiles,
                "source_plant": compound.source_plant,
                "plant_family": compound.plant_family,
                "molecular_weight": compound.molecular_weight,
                "logp": compound.logp,
                "h_bond_donors": compound.h_bond_donors,
                "h_bond_acceptors": compound.h_bond_acceptors,
                "lipinski_pass": compound.lipinski_pass,
            })
            yield buf.getvalue()

    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="phytochemicals.csv"'},
    )


# ── GET /{compound_id} ────────────────────────────────────────────────────────
# Must be declared last — FastAPI matches routes top-to-bottom and this
# path pattern would otherwise capture "stats" and "export" as UUIDs.

@router.get("/{compound_id}", response_model=PhytochemicalOut)
def get_compound(compound_id: UUID, db: Session = Depends(get_db)) -> PhytochemicalOut:
    compound = db.get(Phytochemical, compound_id)
    if compound is None:
        raise HTTPException(status_code=404, detail="Compound not found")
    return compound
