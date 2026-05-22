from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DockingJobCreate(BaseModel):
    protein_code: str
    chain: str
    compound_ids: list[UUID] = Field(default_factory=list)
    smiles_list: list[str] = Field(default_factory=list)
    plant_name: Optional[str] = None
    grid_mode: str = "blind"
    grid_params: dict[str, Any] = Field(default_factory=dict)


class DockingJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    compound_id: UUID
    protein_id: UUID
    pathway: str
    celery_task_id: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    compound_name: str
    binding_score: Optional[float]
    rmsd_lower: Optional[float]
    rmsd_upper: Optional[float]
    h_bond_count: Optional[int]
    pose_file: Optional[str]
    created_at: datetime
