from __future__ import annotations

import threading
from typing import Any

from shared.common.events import EventEnvelope, Topics
from shared.common.mqtt import MqttService


class DashboardState:
    def __init__(self) -> None:
        self._heartbeats: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._mqtt: MqttService | None = None

    def start(self, mqtt: MqttService) -> None:
        self._mqtt = mqtt
        self._mqtt.start()

    def stop(self) -> None:
        if self._mqtt:
            self._mqtt.stop()

    def handle_event(self, topic: str, envelope: EventEnvelope) -> None:
        if topic != Topics.AGENT_HEARTBEAT:
            return
        with self._lock:
            self._heartbeats[envelope.payload["agent_name"]] = envelope.payload

    def heartbeats(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(self._heartbeats.values(), key=lambda item: item["agent_name"])

