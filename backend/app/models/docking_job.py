import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

if TYPE_CHECKING:
    from .phytochemical import Phytochemical
    from .protein import Protein
    from .result import Result


class JobStatus(str, enum.Enum):
    pending = "pending"
    preparing = "preparing"
    docking = "docking"
    parsing = "parsing"
    done = "done"
    failed = "failed"


class DockingJob(Base):
    __tablename__ = "docking_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Foreign keys
    compound_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("phytochemicals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    protein_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("proteins.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_sessions.id"), nullable=True, index=True
    )

    # Per-job isolated workspace directory (absolute path)
    pathway: Mapped[str] = mapped_column(Text, nullable=False)

    # Celery integration
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(155), nullable=True, index=True)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, name="job_status_enum"),
        nullable=False,
        default=JobStatus.pending,
        server_default=JobStatus.pending.value,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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
    compound: Mapped["Phytochemical"] = relationship(
        "Phytochemical", back_populates="docking_jobs"
    )
    protein: Mapped["Protein"] = relationship(
        "Protein", back_populates="docking_jobs"
    )
    results: Mapped[list["Result"]] = relationship(
        "Result", back_populates="job", cascade="all, delete-orphan"
    )
