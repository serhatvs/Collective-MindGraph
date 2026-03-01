from __future__ import annotations

from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import EventEnvelope, Topics, build_event
from shared.common.graph_rules import choose_attachment
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    store = MindGraphStore(settings.postgres_dsn)

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic != Topics.TREE_PROPOSAL_CREATED:
            return
        nodes = store.fetch_all_nodes(envelope.session_id)
        session = store.get_session(envelope.session_id) or {}
        node_id = new_entity_id("node")
        attachment = choose_attachment(
            nodes=nodes,
            candidate_parent_id=envelope.payload.get("candidate_parent_id"),
            branch_preference=str(envelope.payload.get("branch_preference", "main")),
            node_id=node_id,
            current_main_tail_node_id=session.get("current_main_tail_node_id"),
        )
        approved_event = build_event(
            Topics.TREE_APPROVED,
            session_id=envelope.session_id,
            device_id=envelope.device_id,
            payload={
                "proposal_id": envelope.payload["proposal_id"],
                "transcript_id": envelope.payload["transcript_id"],
                "node_id": node_id,
                "parent_node_id": attachment["parent_node_id"],
                "branch_type": attachment["branch_type"],
                "branch_slot": attachment["branch_slot"],
                "node_text": envelope.payload["node_text"],
                "override_reason": attachment["override_reason"],
            },
            trace_id=envelope.trace_id,
            causation_id=envelope.event_id,
        )
        mqtt.publish(Topics.TREE_APPROVED, approved_event)
        heartbeat.touch()

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.TREE_PROPOSAL_CREATED],
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
    logger.info("Consistency agent started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()

