from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "phytodiscover",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.docking_task"],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Concurrency and reliability
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,

    # Two queues:
    # "docking" — long-running docking jobs (concurrency 2-3)
    # "fast"    — short tasks like SMILES validation (concurrency 4)
    task_routes={
        "run_docking_job":       {"queue": "docking"},
        "validate_smiles_batch": {"queue": "fast"},
        "enrich_compounds":      {"queue": "fast"},
    },

    # Result expiry — keep results for 7 days
    result_expires=604800,

    # Restart worker process after 50 tasks to prevent memory leaks
    worker_max_tasks_per_child=50,

    # Retry settings
    task_default_retry_delay=30,
    task_max_retries=3,

    # Monitoring (required by Flower)
    worker_send_task_events=True,
    task_send_sent_event=True,
)

if __name__ == "__main__":
    celery_app.start()
