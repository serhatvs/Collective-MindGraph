from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(slots=True)
class Settings:
    app_name: str
    mqtt_host: str
    mqtt_port: int
    mqtt_qos: int
    postgres_dsn: str
    heartbeat_interval_seconds: float
    snapshot_interval_seconds: float
    frame_silence_timeout_seconds: float
    llm_service_url: str
    stt_service_url: str
    dashboard_port: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_name=os.getenv("APP_NAME", "app"),
            mqtt_host=os.getenv("MQTT_HOST", "localhost"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            mqtt_qos=int(os.getenv("MQTT_QOS", "1")),
            postgres_dsn=os.getenv(
                "POSTGRES_DSN",
                "postgresql://postgres:postgres@localhost:5432/collective_mindgraph",
            ),
            heartbeat_interval_seconds=float(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "5")),
            snapshot_interval_seconds=float(os.getenv("SNAPSHOT_INTERVAL_SECONDS", "10")),
            frame_silence_timeout_seconds=float(os.getenv("FRAME_SILENCE_TIMEOUT_SECONDS", "1.2")),
            llm_service_url=os.getenv("LLM_SERVICE_URL", "http://localhost:8081"),
            stt_service_url=os.getenv("STT_SERVICE_URL", "http://localhost:8082"),
            dashboard_port=int(os.getenv("DASHBOARD_PORT", "8000")),
        )

