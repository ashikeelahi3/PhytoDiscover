import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import DateTime, Enum as SAEnum, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

if TYPE_CHECKING:
    from .docking_job import DockingJob


class ProteinSource(str, enum.Enum):
    PDB = "PDB"
    AlphaFold = "AlphaFold"


class GridMode(str, enum.Enum):
    blind = "blind"
    active_site = "active_site"


class Protein(Base):
    __tablename__ = "proteins"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Identifier — PDB code (e.g. "6LU7") or AlphaFold accession (e.g. "AF-P0DTD1")
    protein_code: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    source: Mapped[ProteinSource] = mapped_column(
        SAEnum(ProteinSource, name="protein_source_enum"), nullable=False
    )
    # Populated only for AlphaFold entries
    af_model_version: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # Chain selection made by the user / pipeline
    selected_chain: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)

    # Arbitrary metadata returned by the fetch step (resolution, organism, etc.)
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Cached file paths on disk
    pdb_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pdbqt_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Grid-box configuration
    grid_mode: Mapped[Optional[GridMode]] = mapped_column(
        SAEnum(GridMode, name="grid_mode_enum"), nullable=True
    )
    grid_params_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    cached_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    docking_jobs: Mapped[list["DockingJob"]] = relationship(
        "DockingJob", back_populates="protein", cascade="all, delete-orphan"
    )
