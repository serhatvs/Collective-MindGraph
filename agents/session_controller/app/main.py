from __future__ import annotations

from agents.session_controller.app.handlers import handle_start, handle_stop
from agents.session_controller.app.service import SessionControllerService
from shared.common.events import EventEnvelope, Topics
from shared.common.mqtt import MqttService


def main() -> None:
    service = SessionControllerService()

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic == Topics.SESSION_CONTROL_START:
            handle_start(service, envelope)
        elif topic == Topics.SESSION_CONTROL_STOP:
            handle_stop(service, envelope)

    service.mqtt = MqttService(
        client_id=service.settings.app_name,
        host=service.settings.mqtt_host,
        port=service.settings.mqtt_port,
        qos=service.settings.mqtt_qos,
        subscriptions=[Topics.SESSION_CONTROL_START, Topics.SESSION_CONTROL_STOP],
        on_event=on_event,
        logger=service.logger,
    )
    service.heartbeat = service.heartbeat.__class__(
        agent_name=service.settings.app_name,
        mqtt_service=service.mqtt,
        interval_seconds=service.settings.heartbeat_interval_seconds,
    )
    service.mqtt.start()
    service.heartbeat.start()
    service.logger.info("Session controller agent started")
    service.mqtt.serve_forever()


if __name__ == "__main__":
    main()
