import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # job_id → list of active WebSocket connections
        self.active: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, job_id: str) -> None:
        await websocket.accept()
        self.active[job_id].append(websocket)

    def disconnect(self, websocket: WebSocket, job_id: str) -> None:
        try:
            self.active[job_id].remove(websocket)
        except ValueError:
            pass
        if not self.active.get(job_id):
            self.active.pop(job_id, None)

    async def send_status(self, job_id: str, message: dict) -> None:
        """Send a JSON message to every connection subscribed to job_id."""
        dead: list[WebSocket] = []
        for ws in list(self.active.get(job_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                self.active[job_id].remove(ws)
            except ValueError:
                pass

    async def broadcast_from_redis(self, job_id: str, raw: str) -> None:
        """Parse a raw Redis pub/sub payload and forward to all clients."""
        try:
            message = json.loads(raw)
            await self.send_status(job_id, message)
        except Exception:
            pass


# Singleton used across the app — import this instance everywhere
manager = ConnectionManager()
