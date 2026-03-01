from __future__ import annotations

import json
import time
from pathlib import Path

from shared.common.config import Settings
from shared.common.events import Topics, build_event
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "transcripts" / "demo.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        logger=logger,
    )
    mqtt.start()
    session_id = fixture["session_id"]
    device_id = fixture["device_id"]
    mqtt.publish(
        Topics.SESSION_CONTROL_START,
        build_event(
            Topics.SESSION_CONTROL_START,
            session_id=session_id,
            device_id=device_id,
            payload={"session_id": session_id, "device_id": device_id, "started_at": None},
        ),
    )
    time.sleep(2)
    for item in fixture["items"]:
        mqtt.publish(
            Topics.STT_TRANSCRIPT_CREATED,
            build_event(
                Topics.STT_TRANSCRIPT_CREATED,
                session_id=session_id,
                device_id=device_id,
                payload={
                    "transcript_id": new_entity_id("transcript"),
                    "segment_id": new_entity_id("segment"),
                    "text": item["text"],
                    "confidence": item["confidence"],
                },
            ),
        )
        time.sleep(0.5)
    time.sleep(2)
    mqtt.publish(
        Topics.SESSION_CONTROL_STOP,
        build_event(
            Topics.SESSION_CONTROL_STOP,
            session_id=session_id,
            device_id=device_id,
            payload={"session_id": session_id, "device_id": device_id, "stopped_at": None},
        ),
    )
    logger.info("Transcript fixture published for session %s", session_id)
    mqtt.stop()


if __name__ == "__main__":
    main()
