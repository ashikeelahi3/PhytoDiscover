import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

if TYPE_CHECKING:
    from .docking_job import DockingJob


class Phytochemical(Base):
    __tablename__ = "phytochemicals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Identity
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    iupac_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    market_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    pubchem_cid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Structure
    smiles: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    inchi: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    inchikey: Mapped[Optional[str]] = mapped_column(
        String(27), unique=True, index=True, nullable=True
    )

    # Physicochemical descriptors
    molecular_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    logp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    h_bond_donors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    h_bond_acceptors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tpsa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rotatable_bonds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    lipinski_pass: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Botanical origin
    source_plant: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    plant_family: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    docking_jobs: Mapped[list["DockingJob"]] = relationship(
        "DockingJob", back_populates="compound", cascade="all, delete-orphan"
    )
