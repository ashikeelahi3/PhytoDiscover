import logging
import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.routers import compounds, docking, protein, sessions, smiles, websocket

logger = logging.getLogger(__name__)

_PRODUCTION_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:8000",
]

app = FastAPI(
    title="PhytoDiscover API",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
_settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _settings.DEBUG else _PRODUCTION_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(compounds.router, prefix="/api/compounds", tags=["compounds"])
app.include_router(smiles.router,    prefix="/api/smiles",    tags=["smiles"])
app.include_router(protein.router,   prefix="/api/protein",   tags=["protein"])
app.include_router(docking.router,   prefix="/api/docking",   tags=["docking"])
app.include_router(sessions.router,  prefix="/api/session",   tags=["session"])
app.include_router(websocket.router, prefix="/ws",            tags=["websocket"])


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    import subprocess
    import sys
    from pathlib import Path
    from app.database import SessionLocal

    # Step 1: Run alembic upgrade head automatically
    try:
        backend_dir = Path(__file__).parents[1]
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(backend_dir),
            capture_output=True,
            text=True,
            env={**os.environ},
            timeout=60,
        )
        if result.returncode == 0:
            logger.info("Alembic migrations applied successfully")
            if result.stdout.strip():
                logger.info("Migration output: %s", result.stdout.strip())
        else:
            logger.error("Alembic migration failed: %s", result.stderr)
    except Exception as e:
        logger.error("Could not run Alembic: %s", e)

    # Step 2: Verify DB connection
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        logger.info("Database connection verified")
    except Exception as e:
        logger.error("Database connection failed: %s", e)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["health"])
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}
