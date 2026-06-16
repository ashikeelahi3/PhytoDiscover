# PhytoDiscover Server Deployment Guide

This document outlines the step-by-step instructions to deploy, configure, and run the PhytoDiscover full stack on a Linux server.

---

## 📋 1. Prerequisites

Ensure the server has the following components installed:

- **OS**: Linux (Ubuntu 20.04/22.04 LTS or similar)
- **Docker & Docker Compose**: To run PostgreSQL, Redis, and Flower services.
- **Node.js (v18+ / v20+) & npm**: To build and serve the Next.js frontend.
- **Python Package Manager**: `pixi` (highly recommended, handles dependencies cleanly) or a standard Conda/virtualenv setup.
- **Open Babel (`obabel`)**: Required for receptor preparation fallbacks.
- **AutoDock Vina**:
  - Instead of system-wide installation, we recommend downloading the official executable and placing it in the project's local `env/` directory.

---

## 🛠️ 2. Auto-Configuration & Dependency Check

PhytoDiscover includes an automated configuration and dependency checking script that automatically creates config files, generates secure secrets, checks system/database statuses, and auto-discovers correct service hosts/ports.

### Step A: Download AutoDock Vina
1. Create an `env` folder in the project root:
   ```bash
   mkdir -p env
   ```
2. Download the Vina binary for your OS (e.g. Linux x86_64) from the [Official AutoDock Vina Releases](https://github.com/ccsb-scripps/AutoDock-Vina/releases).
3. Place the downloaded binary inside the `env/` folder and name it `vina` (or `vina.exe` on Windows):
   ```bash
   # Path should be env/vina
   chmod +x env/vina
   ```

### Step B: Run the Dependency Checker
Execute the dependency checker script. It will automatically initialize your environment and configuration:
```bash
pixi run python backend/dependencies_check.py
# Or if using standard python:
python backend/dependencies_check.py
```

This script will automatically:
1. **Create `.env`**: Copy `.env.example` to `.env` if it doesn't exist.
2. **Configure `VINA_PATH`**: Auto-detect the `env/vina` binary and update `VINA_PATH` with its absolute path in `.env`.
3. **Generate `SECRET_KEY`**: Generate a secure, random cryptographic key for the backend app.
4. **Auto-Discover DB & Redis**: Attempt to connect to the database and Redis. If connections fail on default settings, it automatically attempts other common ports (e.g., `5432` vs `5433` for mapped Docker containers) or hostnames (e.g. `db` vs `localhost`) and updates `.env` with the successful connection string.
5. **Verify Workspace**: Check write access to the workspace directory and auto-generate required docking folders.

Once all checks print `[OK]` and the script ends with `[SUCCESS]`, your backend environment is fully ready.

---

## 🗄️ 3. Services and Database Setup

### A. Start Database & Redis
Spin up the backing Docker services in detached mode:
```bash
docker compose up -d
```
This starts PostgreSQL (exposed on host port `5433` by default to avoid conflicts), Redis (exposed on port `6379`), and Flower (exposed on port `5555`).

### B. Restore Database from SQL backup
Restore the database schema and pre-populated tables from the backup file:
```bash
# Recreate the phytodiscover database
docker exec -i phytodiscover-db-1 psql -U phyto -d postgres -c "DROP DATABASE IF EXISTS phytodiscover;"
docker exec -i phytodiscover-db-1 psql -U phyto -d postgres -c "CREATE DATABASE phytodiscover OWNER phyto;"

# Load the SQL backup
docker exec -i phytodiscover-db-1 psql -U phyto -d phytodiscover < backup/backup.sql
```
This fully populates the database schema, target tables, and inserts the phytochemical database (12,663 records) and target proteins.

---

## 🚀 4. Running the Stack

To run the processes on the server, you can use a process manager like **PM2** or configure systemd services. Here is how to run them:

### A. Celery Workers
Start the background Celery workers (using the startup script):
```bash
cd backend
bash start_workers.sh
cd ..
```

### B. FastAPI Backend
Run the backend application server:
```bash
cd backend
pixi run uvicorn app.main:app --host 127.0.0.1 --port 8000
# Or using standard virtualenv python:
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### C. Next.js Frontend
Configure `.env.local` for the frontend:
```bash
cd frontend-next
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
```
Build and start the Next.js app:
```bash
npm install
# To run development server:
npm run dev
# Or to run production build:
npm run build && npm run start -- -p 3000
```

---

## 📊 5. Monitoring & Status

Once the stack is running, you can access the following services:
- **Frontend App**: `http://localhost:3000`
- **FastAPI API Docs**: `http://localhost:8000/docs`
- **Celery Flower (Monitor)**: `http://localhost:5555`
