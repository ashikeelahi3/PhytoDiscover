from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.protein import GridMode, ProteinSource


class ProteinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    protein_code: str
    source: ProteinSource
    af_model_version: Optional[str]
    selected_chain: Optional[str]
    metadata_json: Optional[dict[str, Any]]
    pdb_path: Optional[str]
    pdbqt_path: Optional[str]
    grid_mode: Optional[GridMode]
    grid_params_json: Optional[dict[str, Any]]
    cached_at: Optional[datetime]


class ProteinCreate(BaseModel):
    protein_code: str
    source: ProteinSource
    chain: Optional[str] = None
