from __future__ import annotations

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import EventEnvelope, Topics
from shared.common.graph_rules import build_main_branch_summary, find_main_tail
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    store = MindGraphStore(settings.postgres_dsn)

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic != Topics.TREE_APPROVED:
            return
        payload = envelope.payload
        inserted = store.insert_graph_node(
            node_id=payload["node_id"],
            event_id=envelope.event_id,
            session_id=envelope.session_id,
            transcript_id=payload["transcript_id"],
            parent_node_id=payload.get("parent_node_id"),
            branch_type=payload["branch_type"],
            branch_slot=payload.get("branch_slot"),
            node_text=payload["node_text"],
            override_reason=payload.get("override_reason", ""),
            created_at=envelope.created_at,
        )
        if not inserted:
            logger.info("Duplicate approved node ignored for transcript %s", payload["transcript_id"])
            return
        nodes = store.fetch_all_nodes(envelope.session_id)
        store.update_session_state(
            session_id=envelope.session_id,
            current_main_tail_node_id=find_main_tail(nodes),
            main_branch_summary=build_main_branch_summary(nodes),
        )
        heartbeat.touch()

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.TREE_APPROVED],
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
    logger.info("Graph writer agent started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()
