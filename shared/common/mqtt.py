from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import paho.mqtt.client as mqtt

from shared.common.events import EventEnvelope
from shared.common.serialization import json_dumps, json_loads


MessageHandler = Callable[[str, EventEnvelope], None]


class MqttService:
    def __init__(
        self,
        *,
        client_id: str,
        host: str,
        port: int,
        qos: int,
        subscriptions: list[str] | None = None,
        on_event: MessageHandler | None = None,
        logger: Any = None,
    ) -> None:
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        self._host = host
        self._port = port
        self._qos = qos
        self._subscriptions = subscriptions or []
        self._on_event = on_event
        self._logger = logger
        self._connected = threading.Event()
        self._stopped = threading.Event()
        self._network_thread_id: int | None = None
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

    def _on_connect(self, client: mqtt.Client, userdata: Any, flags: Any, reason_code: Any, properties: Any) -> None:
        self._network_thread_id = threading.get_ident()
        self._connected.set()
        for topic in self._subscriptions:
            client.subscribe(topic, qos=self._qos)
        if self._logger:
            self._logger.info("Connected to MQTT on %s:%s", self._host, self._port)

    def _on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        if not self._on_event:
            return
        try:
            self._network_thread_id = threading.get_ident()
            envelope = EventEnvelope.model_validate(json_loads(msg.payload))
            self._on_event(msg.topic, envelope)
        except Exception as exc:
            if self._logger:
                self._logger.exception("Failed to process MQTT message on %s: %s", msg.topic, exc)

    def start(self) -> None:
        self._client.connect(self._host, self._port, keepalive=30)
        self._client.loop_start()
        if not self._connected.wait(timeout=10):
            raise RuntimeError(f"Timed out connecting to MQTT {self._host}:{self._port}")

    def publish(self, topic: str, envelope: EventEnvelope) -> None:
        if not self._connected.is_set():
            self.start()
        payload = json_dumps(envelope.model_dump(mode="json"))
        info = self._client.publish(topic, payload=payload, qos=self._qos)
        if self._network_thread_id != threading.get_ident():
            info.wait_for_publish()

    def serve_forever(self) -> None:
        try:
            while not self._stopped.is_set():
                time.sleep(0.5)
        finally:
            self.stop()

    def stop(self) -> None:
        self._stopped.set()
        try:
            self._client.loop_stop()
        finally:
            self._client.disconnect()
