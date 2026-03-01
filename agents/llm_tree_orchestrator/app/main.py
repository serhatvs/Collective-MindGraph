from __future__ import annotations

from datetime import datetime

import httpx

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import EventEnvelope, Topics, build_event
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def json_ready(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    store = MindGraphStore(settings.postgres_dsn)

    def ensure_transcript_record(envelope: EventEnvelope) -> None:
        payload = envelope.payload
        store.insert_transcript(
            transcript_id=payload["transcript_id"],
            event_id=envelope.event_id,
            session_id=envelope.session_id,
            device_id=envelope.device_id,
            segment_id=payload["segment_id"],
            text=payload["text"],
            confidence=float(payload.get("confidence", 0.0)),
            created_at=envelope.created_at,
        )

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic != Topics.STT_TRANSCRIPT_CREATED:
            return
        ensure_transcript_record(envelope)
        session = store.get_session(envelope.session_id) or {}
        recent_nodes = store.fetch_recent_nodes(envelope.session_id, limit=20)
        request = {
            "session_id": envelope.session_id,
            "device_id": envelope.device_id,
            "transcript": envelope.payload,
            "recent_nodes": recent_nodes,
            "main_branch_summary": session.get("main_branch_summary", ""),
            "current_main_tail_node_id": session.get("current_main_tail_node_id"),
        }
        response = httpx.post(f"{settings.llm_service_url}/generate", json=json_ready(request), timeout=10.0)
        response.raise_for_status()
        llm_result = response.json()
        proposal_event = build_event(
            Topics.TREE_PROPOSAL_CREATED,
            session_id=envelope.session_id,
            device_id=envelope.device_id,
            payload={
                "proposal_id": new_entity_id("proposal"),
                "transcript_id": envelope.payload["transcript_id"],
                "candidate_parent_id": llm_result.get("candidate_parent_id"),
                "branch_preference": llm_result.get("branch_preference", "main"),
                "node_text": llm_result.get("node_text", envelope.payload["text"]),
                "rationale": llm_result.get("rationale", "mock llm output"),
            },
            trace_id=envelope.trace_id,
            causation_id=envelope.event_id,
        )
        mqtt.publish(Topics.TREE_PROPOSAL_CREATED, proposal_event)
        heartbeat.touch()

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.STT_TRANSCRIPT_CREATED],
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
    logger.info("LLM tree orchestrator started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()
