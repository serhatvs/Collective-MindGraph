from __future__ import annotations

from datetime import datetime
from typing import Any

from shared.common.events import EventEnvelope, Topics, build_event


def _parse_timestamp(value: str | None, fallback: datetime) -> datetime:
    if not value:
        return fallback
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def handle_start(service: Any, envelope: EventEnvelope) -> None:
    started_at = _parse_timestamp(envelope.payload.get("started_at"), envelope.created_at)
    inserted = service.store.start_session(envelope.session_id, envelope.device_id, started_at)
    if not inserted:
        service.logger.info("Ignored duplicate session start for %s", envelope.session_id)
        return
    event = build_event(
        Topics.SESSION_STARTED,
        session_id=envelope.session_id,
        device_id=envelope.device_id,
        payload={
            "session_id": envelope.session_id,
            "device_id": envelope.device_id,
            "status": "active",
            "started_at": started_at.isoformat(),
        },
        trace_id=envelope.trace_id,
        causation_id=envelope.event_id,
    )
    service.mqtt.publish(Topics.SESSION_STARTED, event)
    service.heartbeat.touch()


def handle_stop(service: Any, envelope: EventEnvelope) -> None:
    stopped_at = _parse_timestamp(envelope.payload.get("stopped_at"), envelope.created_at)
    updated = service.store.stop_session(envelope.session_id, stopped_at)
    if not updated:
        service.logger.info("Ignored duplicate session stop for %s", envelope.session_id)
        return
    event = build_event(
        Topics.SESSION_STOPPED,
        session_id=envelope.session_id,
        device_id=envelope.device_id,
        payload={
            "session_id": envelope.session_id,
            "device_id": envelope.device_id,
            "status": "stopped",
            "stopped_at": stopped_at.isoformat(),
        },
        trace_id=envelope.trace_id,
        causation_id=envelope.event_id,
    )
    service.mqtt.publish(Topics.SESSION_STOPPED, event)
    service.heartbeat.touch()
