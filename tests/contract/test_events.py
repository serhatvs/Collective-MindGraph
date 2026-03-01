from shared.common.events import Topics, build_event


def test_build_event_uses_expected_envelope() -> None:
    event = build_event(
        Topics.STT_TRANSCRIPT_CREATED,
        session_id="session-1",
        device_id="device-1",
        payload={"text": "hello"},
    )
    assert event.event_type == Topics.STT_TRANSCRIPT_CREATED
    assert event.event_version == 1
    assert event.session_id == "session-1"
    assert event.device_id == "device-1"
    assert event.payload == {"text": "hello"}
    assert event.event_id
    assert event.trace_id

