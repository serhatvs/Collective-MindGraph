from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import EventEnvelope, Topics, build_event
from shared.common.graph_rules import snapshot_hash
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def floor_bucket(now: datetime, interval_seconds: float) -> datetime:
    interval = int(interval_seconds)
    epoch = int(now.timestamp())
    bucket = epoch - (epoch % interval)
    return datetime.fromtimestamp(bucket, tz=timezone.utc)


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    store = MindGraphStore(settings.postgres_dsn)
    active_sessions = {
        row["session_id"]: row["device_id"]
        for row in store.list_active_sessions()
    }
    lock = threading.Lock()

    def emit_snapshot(session_id: str, device_id: str, *, trace_id: str | None = None, causation_id: str | None = None) -> None:
        nodes = store.fetch_all_nodes(session_id)
        now = datetime.now(timezone.utc)
        bucket = floor_bucket(now, settings.snapshot_interval_seconds)
        snapshot_event = build_event(
            Topics.SNAPSHOT_HASH,
            session_id=session_id,
            device_id=device_id,
            payload={
                "snapshot_id": new_entity_id("snapshot"),
                "node_count": len(nodes),
                "hash_sha256": snapshot_hash(nodes),
                "snapshot_bucket_ts": bucket.isoformat(),
            },
            trace_id=trace_id,
            causation_id=causation_id,
        )
        stored = store.store_snapshot(
            snapshot_id=snapshot_event.payload["snapshot_id"],
            event_id=snapshot_event.event_id,
            session_id=session_id,
            snapshot_bucket_ts=bucket,
            node_count=snapshot_event.payload["node_count"],
            hash_sha256=snapshot_event.payload["hash_sha256"],
            created_at=snapshot_event.created_at,
        )
        if not stored:
            return
        store.mark_snapshot_time(session_id, now)
        mqtt.publish(Topics.SNAPSHOT_HASH, snapshot_event)
        heartbeat.touch()

    def ticker() -> None:
        while True:
            with lock:
                current_sessions = list(active_sessions.items())
            for session_id, device_id in current_sessions:
                emit_snapshot(session_id, device_id)
            time.sleep(settings.snapshot_interval_seconds)

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic == Topics.SESSION_STARTED:
            with lock:
                active_sessions[envelope.session_id] = envelope.device_id
            return
        if topic == Topics.SESSION_STOPPED:
            emit_snapshot(envelope.session_id, envelope.device_id, trace_id=envelope.trace_id, causation_id=envelope.event_id)
            with lock:
                active_sessions.pop(envelope.session_id, None)

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.SESSION_STARTED, Topics.SESSION_STOPPED],
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
    threading.Thread(target=ticker, daemon=True).start()
    logger.info("Snapshot agent started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()
