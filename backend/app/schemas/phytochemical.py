from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PhytochemicalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    iupac_name: Optional[str]
    market_name: Optional[str]
    pubchem_cid: Optional[int]
    smiles: Optional[str]
    inchi: Optional[str]
    inchikey: Optional[str]
    molecular_weight: Optional[float]
    logp: Optional[float]
    h_bond_donors: Optional[int]
    h_bond_acceptors: Optional[int]
    tpsa: Optional[float]
    rotatable_bonds: Optional[int]
    lipinski_pass: Optional[bool]
    source_plant: Optional[str]
    plant_family: Optional[str]
    created_at: datetime
    updated_at: datetime


class PhytochemicalSearch(BaseModel):
    name: Optional[str] = None
    source_plant: Optional[str] = None
    min_mw: Optional[float] = None
    max_mw: Optional[float] = None
    max_logp: Optional[float] = None
    lipinski_pass: Optional[bool] = None
    has_smiles: Optional[bool] = None
    skip: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=500)


class CompoundStats(BaseModel):
    total: int
    with_smiles: int
    with_rdkit_props: int
    lipinski_pass: int
