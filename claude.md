# PhytoDiscover — Claude Code project context

## What this project is
A phytochemical-based drug discovery platform. Users search a plant compound 
database, select targets, configure molecular docking, and view binding 
affinity results.

## Tech stack
- Frontend: Vanilla HTML/CSS/JS (single-file pages, no build step)
- Backend: FastAPI + SQLAlchemy 2.x + Alembic + Pydantic v2
- Queue: Celery + Redis (broker and result backend)
- Database: PostgreSQL 16
- Scientific tools: RDKit, AutoDock Vina, MGLTools, BioPython

## Existing scientific pipeline files (do not modify these)
These three files already exist in backend/ and must never be overwritten:
- protein_&_chain_selection.py — protein download, chain selection, grid box, PDBQT conversion
- drug_collection_and_processing.py — ligand collection from PubChem, SMILES, or plant DB
- docking_function.py — runs AutoDock Vina, parses binding affinity scores

## The pathway variable (critical concept)
Every docking job gets its own isolated workspace directory.
directory_creation(path) creates it and returns the path as `pathway`.
This pathway variable is passed into every subsequent function call.
The 7 subdirectories created at job dispatch (in docking.py _SUBDIRS):
  protein_pdb_files/    — cleaned protein PDB
  protein_pdbqt_files/  — docking-ready protein PDBQT
  protien_pdbqt_files/  — same, typo spelling required by directory_creation()
  drug_pdb_files/       — ligand PDB structures
  drug_pdbqt_files/     — docking-ready ligand PDBQT
  output_files_1/       — raw docking pose output per protein
  output_files_2/       — binding affinity score matrix CSV
  configuration_file/   — Vina .txt config files written by calculate_grid_box_*()

## Database tables
- phytochemicals — compound library (12,663 unique records, 4,010 plant species)
- proteins — cached PDB/AlphaFold structures with chain and grid metadata
- docking_jobs — one row per job, holds pathway, status, celery_task_id
- results — one row per ligand per job, holds binding_score, rmsd, h_bonds

## Job status flow
pending → preparing → docking → parsing → done (or failed at any stage)

## Project folder structure
phytodiscover/
  backend/
    app/
      routers/         — one file per FastAPI router
      models/          — SQLAlchemy ORM models
      schemas/         — Pydantic v2 schemas
      services/        — business logic, pipeline wrappers
      tasks/           — Celery tasks
    alembic/           — database migrations
    tests/
  frontend/
    pages/             — one HTML file per page
    static/css/
    static/js/

## Frontend design principles
Target users: biologists and statisticians — NOT software engineers.
Design rules:
- Every button must have a clear text label, no icon-only buttons
- Every page has one obvious "next step" action, visually prominent
- No jargon in UI text — use plain English:
    "Search compounds" not "Query database"
    "Start docking" not "Dispatch job"
    "View results" not "GET /api/docking/results"
- Error messages must explain what to do, not what went wrong technically
- Loading states must show progress text, not just a spinner
- Forms must show examples in placeholder text
- Color scheme: dark background (#0f1117), teal accent (#14b8a6),
  white text, subtle borders (#1e2433)
- Font: IBM Plex Mono for data values, Inter for all other text
- Mobile-friendly but optimized for desktop lab computer use
- Sidebar navigation always visible with current page highlighted
- Every page has a clear title and one-line description of what to do

## Frontend tech
Vanilla HTML + CSS + JavaScript, no frameworks, no build step.
One self-contained .html file per page — CSS and JS inline.
All API calls use fetch() with BASE_URL = "http://localhost:8000"
All pages live in frontend/pages/

## Frontend — current state
Vanilla HTML/CSS/JS (single-file pages, no build step, no framework).
The existing pages are structurally complete with layout, CSS, and 
sidebar/topbar/toast system already built.

Current task: replace showToast() stub functions with real fetch() 
calls to the FastAPI backend. Do not change layout or styling.

## Frontend — future migration (not yet)
Will migrate to React/Next.js after the full backend pipeline is 
working end-to-end. Do not generate React code until explicitly asked.

## Frontend pages (existing files — do not recreate from scratch)
1. search.html    — wire to GET /api/compounds/search
2. smiles.html    — wire to POST /api/smiles/validate
3. docking.html   — wire to GET /api/protein/{id}, POST /api/docking/dispatch
4. queue.html     — wire to ws://…/ws/jobs/{job_id}
5. results.html   — wire to GET /api/docking/results/{job_id}

## Port allocation
phytochem_db old API  →  port 8000  (stopped permanently, use 8001 if needed)
phytodiscover FastAPI →  port 8000  (primary server)
phytodiscover Celery  →  no port (worker process)
phytodiscover Flower  →  port 5555  (Celery monitor)
Redis                 →  port 6379
PostgreSQL            →  port 5432  (serves BOTH databases)

## Data source (critical — read carefully)
Phytochemical data lives in a SEPARATE existing database called 
phytochem_db on the same PostgreSQL server.

Source DB columns (exact names as stored):
  phytochemical_name  → name
  miles               → smiles  (field named "miles" due to original typo)
  plant_name          → source_plant
  plant_part          → plant_family
  phytochemical_identifier → pubchem_cid
  synonyms            → iupac_name

SMILES strings are stored in a column called "miles" (not "smiles") 
in phytochem_db. Always use "miles" when querying the source.

Do NOT import from CSV. Migrate from phytochem_db → phytodiscover 
using scripts/migrate_from_phytochem_db.py.
RDKit properties (MW, logP, Lipinski etc.) are NULL after migration 
and get computed in a second pass by the same script.

## API structure
All REST endpoints under /api/
- /api/compounds/  — search, get, export
- /api/smiles/     — validate, from-plant
- /api/protein/    — fetch by PDB/AF id, chains, gridbox
- /api/docking/    — dispatch, jobs, results
- /ws/jobs/{job_id} — WebSocket for live Celery status events

## PostgreSQL setup
Local Mac development: Docker PostgreSQL runs on port 5433
  (port 5432 is occupied by Homebrew PostgreSQL serving phytochem_db)
  DATABASE_URL=postgresql://phyto:password@localhost:5433/phytodiscover

Ubuntu server deployment: Docker PostgreSQL runs on port 5432
  (no Homebrew conflict on server)
  DATABASE_URL=postgresql://phyto:password@localhost:5432/phytodiscover

The migration script reads from phytochem_db on port 5432 (Homebrew)
and writes to phytodiscover on port 5433 (Docker) — two different ports.

## Database connection details (exact)

Source database (phytochem_db — read only, never modify):
  host: localhost
  port: 5432
  database: phytochem_db
  user: mdfahimfaysal
  password: not required (peer auth)

Target database (phytodiscover — active development):
  host: localhost
  port: 5433
  database: phytodiscover
  user: phyto
  password: from POSTGRES_PASSWORD in .env

DATABASE_URL in .env:
  postgresql://phyto:password@localhost:5433/phytodiscover

The migration script reads from port 5432 and writes to port 5433.
Never mix these up — writing to phytochem_db would corrupt source data.

## Known quirks in the original pipeline files (do not fix in pipeline files)

### Typo in directory_creation() — "protien_pdbqt_files"
The original directory_creation() function in protein_&_chain_selection.py
creates a folder called "protien_pdbqt_files" (letters transposed — typo in
original code). Our canonical name is "protein_pdbqt_files".
Always create BOTH spellings so every part of the pipeline finds what it needs:
  os.makedirs(f"{pathway}/protein_pdbqt_files", exist_ok=True)
  os.makedirs(f"{pathway}/protien_pdbqt_files", exist_ok=True)
Never rely on just one spelling. This is handled in app/routers/docking.py.

### Hardcoded Vina path in docking_function.py
docking_function.py contains:  vina_dir = Path("/home/kaderi/Feroj/first/vinas")
This is a hardcoded Linux developer path. It is overridden in the Celery task
before optimized_docking() is called:
  docking_mod.vina_dir = Path(get_settings().VINA_PATH)
VINA_PATH must be set in .env. Default (Mac Homebrew): /usr/local/bin/vina

## Production upgrade — current phase
Working on: Alembic auto-migrations, Celery scaling,
session-based isolation, Next.js frontend, 3D pose viewer.

New frontend: frontend-next/ (Next.js 14, TypeScript, Tailwind)
Old frontend: frontend/ (keep intact for reference, do not delete)

Session system: cookie-based (pd_session), no login required.
Each browser session sees only its own docking jobs.

Next.js proxies /api/* and /ws/* to FastAPI at localhost:8000.
NEXT_PUBLIC_API_URL=http://localhost:8000 in frontend-next/.env.local

Do not add authentication (no login/password system).
Do not build ADMET properties — that is the next release.

## Key rules for Claude Code
1. Never modify the three scientific pipeline files
2. Always use SQLAlchemy 2.x mapped_column style (not Column)
3. Always use Pydantic v2 model_validator style (not validator)
4. RDKit must be imported inside try/except — it raises on invalid SMILES
5. Every Celery task must publish status to Redis channel job_status:{job_id}
6. pathway is always an absolute path string, never relative
7. Use UUID primary keys on all tables
8. conda install rdkit via conda-forge — never pip install rdkit