# PhytoDiscover Server Deployment Guide (Updated)

This document outlines the updated step-by-step instructions to deploy and run the PhytoDiscover full stack on a Linux server.

---

## 📋 1. Prerequisites

Ensure the server has the following components installed:

- **OS**: Linux (Ubuntu 20.04/22.04 LTS or similar)
- **Docker & Docker Compose**: To run PostgreSQL, Redis, and Flower services.
- **Anaconda (Recommended) / Miniconda**: For managing the Python environment and RDKit dependency. Anaconda is highly recommended over Miniconda as it comes pre-bundled with scientific packages like Scipy, avoiding dependency issues.
- **Node.js (v18+ / v20+) & npm**: To build and serve the Next.js frontend.
- **AutoDock Vina**:
  - The executable is typically located at `/usr/bin/vina`.
  - For local execution in this repository, the absolute path to the pre-bundled Linux executable is: `/home/chrom/Documents/GitHub/PhytoDiscover/autodock_vina_1_1_2_linux_x86/bin/vina`.

---

## 🛠️ 2. Environment Configuration

### A. Clone and Prepare Directories
Navigate to the project root:
```bash
cd /home/chrom/Documents/GitHub/PhytoDiscover
```

### B. Configure Backend `.env`
Copy the example environment file:
```bash
cp .env.example .env
```
Edit the `.env` file with server-specific values. The pre-configured local settings are:
- **`DATABASE_URL`**: `postgresql://phyto:changeme@localhost:5433/phytodiscover`
- **`WORKSPACE_BASE_PATH`**: `/home/chrom/Projects/PhytoDiscover-main/workspaces`
- **`VINA_PATH`**: `/home/chrom/Documents/GitHub/PhytoDiscover/vina/vina`

### C. Configure Next.js Frontend `.env.local`
Navigate to the frontend directory and configure `.env.local`:
```bash
cd frontend-next
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
cd ..
```

---

## 🗄️ 3. Services and Database Setup

### A. Start Database & Redis
Spin up the backing Docker services in detached mode:
```bash
docker compose up -d
```
This starts the `db` (on host port 5433), `redis` (on host port 6379), and `flower` (on host port 5555).

### B. Create and Configure Conda Environment
1. Create the conda environment containing scientific dependencies (such as RDKit):
   ```bash
   /home/chrom/miniconda3/bin/conda env create -f environment.yml
   ```
### C. Restore target database from SQL backup
Since the source database is not available on port 5432, restore the target database directly from the SQL backup file (`db-start/phytodiscover_backup_20260609.sql`):
```bash
docker exec -i phytodiscover-db-1 psql -U phyto -d postgres -c "DROP DATABASE IF EXISTS phytodiscover;"
docker exec -i phytodiscover-db-1 psql -U phyto -d postgres -c "CREATE DATABASE phytodiscover OWNER phyto;"
docker exec -i phytodiscover-db-1 psql -U phyto -d phytodiscover < backup/backup.sql
```
This fully populates the database schema, target tables, and inserts the 12,663 phytochemicals (fully enriched) and 10 proteins.

---

## 🚀 4. Running the Stack

On a server, it is recommended to run the processes using a process manager like **PM2** or as systemd services. Here is how to run them:

### A. Celery Workers
Start the background Celery workers (configured in `backend/start_workers.sh`):
```bash
cd backend
bash start_workers.sh
cd ..
```
*Note: `start_workers.sh` has been updated to prepend the Conda environment's bin folder to the environment `PATH` internally, so it runs correctly.*

### B. FastAPI Backend
Run the backend using Uvicorn:
```bash
cd backend
/home/chrom/miniconda3/envs/phytodiscover/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### C. Next.js Frontend
Start the Next.js frontend:
```bash
cd frontend-next
npm install
# Run development server
npm run dev
# Or run production build
npm run build && npm run start -- -p 3000
```

---

## 📊 5. Monitoring & Status

Once running, access the following endpoints:
- **Frontend App**: `http://localhost:3000`
- **FastAPI API Docs**: `http://localhost:8000/docs`
- **Celery Flower (Monitor)**: `http://localhost:5555`
