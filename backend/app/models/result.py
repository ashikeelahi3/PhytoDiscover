import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

if TYPE_CHECKING:
    from .docking_job import DockingJob


class Result(Base):
    __tablename__ = "results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Foreign key
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("docking_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # The ligand name as emitted by AutoDock Vina output
    compound_name: Mapped[str] = mapped_column(String(512), nullable=False)

    # Docking scores
    binding_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rmsd_lower: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rmsd_upper: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    h_bond_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Path to the best pose file produced by docking_function.py
    pose_file: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    job: Mapped["DockingJob"] = relationship("DockingJob", back_populates="results")
