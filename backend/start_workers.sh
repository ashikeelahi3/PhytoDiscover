#!/bin/bash
# Start multiple Celery workers for PhytoDiscover.
# Run from the backend/ directory: bash start_workers.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="$PROJECT_ROOT/logs"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -o allexport
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +o allexport
else
    echo "Warning: .env not found at $PROJECT_ROOT/.env"
fi

mkdir -p "$LOGS_DIR"

echo "Starting PhytoDiscover Celery workers..."

# Worker 1+2: docking queue (CPU-intensive, low concurrency)
celery -A app.celery_app worker \
    --loglevel=info \
    --concurrency=2 \
    --queues=docking \
    --hostname=docking-worker@%h \
    >> "$LOGS_DIR/worker_docking.log" 2>&1 &
DOCKING_PID=$!

# Worker 3: fast queue (validation, enrichment)
celery -A app.celery_app worker \
    --loglevel=info \
    --concurrency=4 \
    --queues=fast \
    --hostname=fast-worker@%h \
    >> "$LOGS_DIR/worker_fast.log" 2>&1 &
FAST_PID=$!

echo "Workers started (docking PID=$DOCKING_PID, fast PID=$FAST_PID). Logs: $LOGS_DIR"
echo "Monitor at http://localhost:5555"
wait
