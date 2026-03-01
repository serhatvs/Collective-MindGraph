from __future__ import annotations

import time

import httpx

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import EventEnvelope, Topics, build_event
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    store = MindGraphStore(settings.postgres_dsn)

    def transcribe_segment(envelope: EventEnvelope) -> dict[str, object]:
        request = {
            "session_id": envelope.session_id,
            "device_id": envelope.device_id,
            "segment_id": envelope.payload["segment_id"],
            "encoding": envelope.payload["encoding"],
            "audio_b64": envelope.payload["audio_b64"],
        }
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                response = httpx.post(f"{settings.stt_service_url}/transcribe", json=request, timeout=10.0)
                response.raise_for_status()
                return response.json()
            except Exception as exc:
                last_error = exc
                logger.warning("STT request attempt %s failed for %s: %s", attempt, request["segment_id"], exc)
                time.sleep(1)
        raise RuntimeError(f"STT failed for segment {request['segment_id']}: {last_error}")

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic != Topics.AUDIO_SEGMENT_CREATED:
            return
        payload = envelope.payload
        result = transcribe_segment(envelope)
        confidence_value = result.get("confidence", 0.0)
        confidence = float(confidence_value) if isinstance(confidence_value, (int, float, str)) else 0.0
        transcript_id = new_entity_id("transcript")
        inserted = store.insert_transcript(
            transcript_id=transcript_id,
            event_id=envelope.event_id,
            session_id=envelope.session_id,
            device_id=envelope.device_id,
            segment_id=payload["segment_id"],
            text=str(result.get("text", "")),
            confidence=confidence,
            created_at=envelope.created_at,
        )
        if not inserted:
            logger.info("Duplicate segment ignored: %s", payload["segment_id"])
            return
        transcript_event = build_event(
            Topics.STT_TRANSCRIPT_CREATED,
            session_id=envelope.session_id,
            device_id=envelope.device_id,
            payload={
                "transcript_id": transcript_id,
                "segment_id": payload["segment_id"],
                "text": str(result.get("text", "")),
                "confidence": confidence,
            },
            trace_id=envelope.trace_id,
            causation_id=envelope.event_id,
        )
        mqtt.publish(Topics.STT_TRANSCRIPT_CREATED, transcript_event)
        heartbeat.touch()

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.AUDIO_SEGMENT_CREATED],
        on_event=on_event,
        logger=logger,
    )
    heartbeat = HeartbeatPublisher(
        agent_name=settings.app_name,
        mqtt_service=mqtt,
        interval_seconds=settings.heartbeat_interval_seconds,
    )
    mqtt.start()
    heartbeat.start()
    logger.info("STT agent started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()
