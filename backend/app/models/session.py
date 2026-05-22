import uuid
from datetime import datetime

from sqlalchemy import DateTime, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    display_name: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Researcher"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    last_active: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
    metadata_json: Mapped[dict] = mapped_column(
        JSON, default=dict
    )
