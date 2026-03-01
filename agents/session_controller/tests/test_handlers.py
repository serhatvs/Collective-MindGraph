from datetime import datetime, timezone

from agents.session_controller.app.handlers import handle_start, handle_stop
from shared.common.events import EventEnvelope, Topics


class FakeStore:
    def __init__(self) -> None:
        self.started: list[tuple[str, str, datetime]] = []
        self.stopped: list[tuple[str, datetime]] = []

    def start_session(self, session_id: str, device_id: str, started_at: datetime) -> bool:
        self.started.append((session_id, device_id, started_at))
        return True

    def stop_session(self, session_id: str, stopped_at: datetime) -> bool:
        self.stopped.append((session_id, stopped_at))
        return True


class FakeMqtt:
    def __init__(self) -> None:
        self.messages: list[tuple[str, EventEnvelope]] = []

    def publish(self, topic: str, envelope: EventEnvelope) -> None:
        self.messages.append((topic, envelope))


class FakeHeartbeat:
    def __init__(self) -> None:
        self.touched = 0

    def touch(self) -> None:
        self.touched += 1


class FakeLogger:
    def info(self, message: str, *args: object) -> None:
        return None


class FakeService:
    def __init__(self) -> None:
        self.store = FakeStore()
        self.mqtt = FakeMqtt()
        self.heartbeat = FakeHeartbeat()
        self.logger = FakeLogger()


def test_handle_start_publishes_session_started() -> None:
    service = FakeService()
    envelope = EventEnvelope(
        event_type=Topics.SESSION_CONTROL_START,
        session_id="session-1",
        device_id="device-1",
        created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
        payload={"started_at": "2026-03-01T00:00:00+00:00"},
    )
    handle_start(service, envelope)
    assert service.store.started[0][0] == "session-1"
    assert service.mqtt.messages[0][0] == Topics.SESSION_STARTED
    assert service.mqtt.messages[0][1].payload["status"] == "active"
    assert service.heartbeat.touched == 1


def test_handle_stop_publishes_session_stopped() -> None:
    service = FakeService()
    envelope = EventEnvelope(
        event_type=Topics.SESSION_CONTROL_STOP,
        session_id="session-1",
        device_id="device-1",
        created_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
        payload={"stopped_at": "2026-03-01T00:01:00+00:00"},
    )
    handle_stop(service, envelope)
    assert service.store.stopped[0][0] == "session-1"
    assert service.mqtt.messages[0][0] == Topics.SESSION_STOPPED
    assert service.mqtt.messages[0][1].payload["status"] == "stopped"
    assert service.heartbeat.touched == 1

