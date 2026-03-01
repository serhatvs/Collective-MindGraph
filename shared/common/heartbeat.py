from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from shared.common.events import Topics, build_event


class HeartbeatPublisher:
    def __init__(self, *, agent_name: str, mqtt_service: Any, interval_seconds: float) -> None:
        self._agent_name = agent_name
        self._mqtt_service = mqtt_service
        self._interval_seconds = interval_seconds
        self._last_processed_at: datetime | None = None
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def touch(self) -> None:
        self._last_processed_at = datetime.now(timezone.utc)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=1)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            event = build_event(
                Topics.AGENT_HEARTBEAT,
                session_id="system",
                device_id=self._agent_name,
                payload={
                    "agent_name": self._agent_name,
                    "status": "ok",
                    "last_processed_at": self._last_processed_at.isoformat() if self._last_processed_at else None,
                    "version": "0.1.0",
                },
            )
            self._mqtt_service.publish(Topics.AGENT_HEARTBEAT, event)
            self._stop_event.wait(self._interval_seconds)
