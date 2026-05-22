import secrets
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.session import UserSession

SESSION_COOKIE_NAME = "pd_session"
SESSION_TOKEN_LENGTH = 32  # 32 bytes = 64 hex chars


def create_session(db: Session, display_name: str = "Researcher") -> UserSession:
    token = secrets.token_hex(SESSION_TOKEN_LENGTH)
    session = UserSession(
        session_token=token,
        display_name=display_name,
        created_at=datetime.utcnow(),
        last_active=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, token: str) -> UserSession | None:
    if not token:
        return None
    session = (
        db.query(UserSession)
        .filter(UserSession.session_token == token)
        .first()
    )
    if session:
        session.last_active = datetime.utcnow()
        db.commit()
    return session


def get_or_create_session(db: Session, token: str | None) -> UserSession:
    if token:
        session = get_session(db, token)
        if session:
            return session
    return create_session(db)
