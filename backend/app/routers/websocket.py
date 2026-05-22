import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.ws_manager import manager

router = APIRouter()


@router.websocket("/jobs/{job_id}")
async def job_status_ws(websocket: WebSocket, job_id: str) -> None:
    """
    WebSocket endpoint for live job status updates.
    Client connects to:  ws://host/ws/jobs/{job_id}

    Flow:
      1. Accept and register with ConnectionManager.
      2. Subscribe to Redis channel  job_status:{job_id}.
      3. Forward every Redis message to the WebSocket client.
      4. Send a keepalive {"type": "ping"} every 30 s while waiting.
      5. On disconnect: cancel Redis listener and clean up.

    If redis.asyncio is unavailable the connection is kept open with
    a ping every 5 s so the client doesn't time out.
    """
    await manager.connect(websocket, job_id)

    # Initialise to None so the finally block is always safe to reference them
    listener_task: asyncio.Task | None = None
    pubsub = None
    r = None

    try:
        try:
            import redis.asyncio as aioredis

            from app.config import get_settings

            r = aioredis.from_url(get_settings().REDIS_URL)
            pubsub = r.pubsub()
            await pubsub.subscribe(f"job_status:{job_id}")

            async def _redis_listener() -> None:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        data = message["data"]
                        if isinstance(data, bytes):
                            data = data.decode()
                        await manager.broadcast_from_redis(job_id, data)

            listener_task = asyncio.create_task(_redis_listener())

            # Keep the handler alive; send a keepalive ping on timeout
            while True:
                try:
                    await asyncio.wait_for(
                        websocket.receive_text(), timeout=30
                    )
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})

        except ImportError:
            # redis.asyncio not available — keepalive only mode
            while True:
                await asyncio.sleep(5)
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)
    except Exception:
        manager.disconnect(websocket, job_id)
    finally:
        if listener_task is not None:
            listener_task.cancel()
            try:
                await listener_task
            except asyncio.CancelledError:
                pass
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(f"job_status:{job_id}")
            except Exception:
                pass
        if r is not None:
            try:
                await r.aclose()
            except Exception:
                pass
