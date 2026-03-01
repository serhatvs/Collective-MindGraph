from __future__ import annotations

import threading

from shared.common.events import build_event
from shared.common.mqtt import MqttService


class FakePublishInfo:
    def __init__(self) -> None:
        self.wait_calls = 0

    def wait_for_publish(self) -> None:
        self.wait_calls += 1


class FakeClient:
    def __init__(self, info: FakePublishInfo) -> None:
        self.info = info
        self.published: list[tuple[str, str, int]] = []

    def publish(self, topic: str, payload: str, qos: int) -> FakePublishInfo:
        self.published.append((topic, payload, qos))
        return self.info


def make_service(info: FakePublishInfo) -> MqttService:
    service = MqttService(
        client_id="test-client",
        host="localhost",
        port=1883,
        qos=1,
    )
    service._client = FakeClient(info)  # type: ignore[assignment]
    service._connected.set()
    return service


def test_publish_waits_off_callback_thread() -> None:
    info = FakePublishInfo()
    service = make_service(info)
    service._network_thread_id = None

    service.publish(
        "topic/test",
        build_event(
            "topic.test",
            session_id="session-1",
            device_id="device-1",
            payload={"value": 1},
        ),
    )

    assert info.wait_calls == 1


def test_publish_skips_wait_on_callback_thread() -> None:
    info = FakePublishInfo()
    service = make_service(info)
    service._network_thread_id = threading.get_ident()

    service.publish(
        "topic/test",
        build_event(
            "topic.test",
            session_id="session-1",
            device_id="device-1",
            payload={"value": 1},
        ),
    )

    assert info.wait_calls == 0
