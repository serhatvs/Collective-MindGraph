from __future__ import annotations

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


class SessionControllerService:
    def __init__(self) -> None:
        self.settings = Settings.from_env()
        self.logger = configure_logging(self.settings.app_name)
        self.store = MindGraphStore(self.settings.postgres_dsn)
        self.mqtt = MqttService(
            client_id=self.settings.app_name,
            host=self.settings.mqtt_host,
            port=self.settings.mqtt_port,
            qos=self.settings.mqtt_qos,
            subscriptions=[],
            logger=self.logger,
        )
        self.heartbeat = HeartbeatPublisher(
            agent_name=self.settings.app_name,
            mqtt_service=self.mqtt,
            interval_seconds=self.settings.heartbeat_interval_seconds,
        )

