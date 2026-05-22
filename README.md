# PhytoDiscover

A phytochemical-based drug discovery platform. Users search a plant compound
database, select protein targets, configure molecular docking, and view
binding affinity results.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JS |
| API | FastAPI + Uvicorn |
| ORM | SQLAlchemy 2.x + Alembic |
| Database | PostgreSQL 16 |
| Queue | Celery + Redis |
| Science | RDKit, AutoDock Vina, MGLTools, BioPython, Meeko |

## Quick start

### 1. Create the conda environment

```bash
conda env create -f environment.yml
conda activate phytodiscover
```

### 2. Configure environment variables

```bash
cp .env.example .env
# edit .env with your local DATABASE_URL, REDIS_URL, WORKSPACE_BASE_PATH
```

### 3. Start backing services

```bash
docker compose up db redis -d
```

### 4. Run database migrations

```bash
cd backend
alembic upgrade head
```

### 5. Start the API server

```bash
uvicorn app.main:app --reload
```

### 6. Start the Celery worker

```bash
celery -A app.tasks.worker worker --loglevel=info
```

## Running with Docker Compose (full stack)

```bash
docker compose up --build
```

API will be available at `http://localhost:8000`.

## Project layout

```
backend/
  app/
    routers/    — FastAPI route handlers (one file per resource)
    models/     — SQLAlchemy ORM models
    schemas/    — Pydantic v2 request/response schemas
    services/   — business logic and pipeline wrappers
    tasks/      — Celery task definitions
  alembic/      — database migrations
  tests/
  docking_function.py              — AutoDock Vina runner (do not modify)
  drug_collection_and_processing.py — ligand collection (do not modify)
  protein_&_chain_selection.py      — protein prep (do not modify)

frontend/
  pages/        — one HTML file per page
  static/css/
  static/js/

scripts/        — utility / seed scripts
```

## Running tests

```bash
cd backend
pytest tests/
```
