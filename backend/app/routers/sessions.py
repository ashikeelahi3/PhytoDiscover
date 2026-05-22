from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.session import UserSession
from app.services.session_service import (
    SESSION_COOKIE_NAME,
    get_or_create_session,
)

router = APIRouter()

_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days in seconds


# ── Dependency ────────────────────────────────────────────────────────────────

async def get_current_session(
    response: Response,
    db: Session = Depends(get_db),
    pd_session: str | None = Cookie(default=None),
) -> UserSession:
    session = get_or_create_session(db, pd_session)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session.session_token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    return session


# ── Schemas ───────────────────────────────────────────────────────────────────

class SessionOut(BaseModel):
    session_id:   str
    display_name: str
    created_at:   str
    last_active:  str


class SessionPatch(BaseModel):
    display_name: str


def _session_out(s: UserSession) -> SessionOut:
    return SessionOut(
        session_id   = str(s.id),
        display_name = s.display_name,
        created_at   = s.created_at.isoformat(),
        last_active  = s.last_active.isoformat(),
    )


# ── GET /api/session/me ───────────────────────────────────────────────────────

@router.get("/me", response_model=SessionOut)
async def get_me(
    session: UserSession = Depends(get_current_session),
) -> SessionOut:
    return _session_out(session)


# ── PATCH /api/session/me ─────────────────────────────────────────────────────

@router.patch("/me", response_model=SessionOut)
async def patch_me(
    body: SessionPatch,
    db: Session = Depends(get_db),
    session: UserSession = Depends(get_current_session),
) -> SessionOut:
    session.display_name = body.display_name
    db.commit()
    db.refresh(session)
    return _session_out(session)


# ── DELETE /api/session/me ────────────────────────────────────────────────────

@router.delete("/me", status_code=204)
async def delete_me(response: Response) -> None:
    # Clear the cookie only — session data and job history are preserved
    response.delete_cookie(key=SESSION_COOKIE_NAME, samesite="lax")
