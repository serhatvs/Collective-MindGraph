from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from shared.common.config import Settings
from shared.common.events import EventEnvelope, Topics, build_event
from shared.common.heartbeat import HeartbeatPublisher
from shared.common.ids import new_entity_id
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService
from shared.common.serialization import b64decode_bytes, b64encode_bytes


@dataclass
class FrameBuffer:
    session_id: str
    device_id: str
    encoding: str
    started_at: datetime
    last_at: datetime
    chunks: list[bytes] = field(default_factory=list)
    seen_frame_seq: set[int] = field(default_factory=set)


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    buffers: dict[str, FrameBuffer] = {}
    lock = threading.Lock()

    def buffer_key(session_id: str, device_id: str) -> str:
        return f"{session_id}:{device_id}"

    def flush_buffer(key: str, *, trace_id: str | None = None, causation_id: str | None = None) -> None:
        with lock:
            buffer = buffers.get(key)
            if not buffer or not buffer.chunks:
                return
            segment_bytes = b"".join(buffer.chunks)
            segment_event = build_event(
                Topics.AUDIO_SEGMENT_CREATED,
                session_id=buffer.session_id,
                device_id=buffer.device_id,
                payload={
                    "segment_id": new_entity_id("segment"),
                    "encoding": buffer.encoding,
                    "started_at": buffer.started_at.isoformat(),
                    "ended_at": buffer.last_at.isoformat(),
                    "audio_b64": b64encode_bytes(segment_bytes),
                },
                trace_id=trace_id,
                causation_id=causation_id,
            )
            buffers.pop(key, None)
        mqtt.publish(Topics.AUDIO_SEGMENT_CREATED, segment_event)
        heartbeat.touch()

    def flusher_loop() -> None:
        while True:
            now = datetime.now(timezone.utc)
            expired: list[str] = []
            with lock:
                for key, buffer in buffers.items():
                    if (now - buffer.last_at).total_seconds() >= settings.frame_silence_timeout_seconds:
                        expired.append(key)
            for key in expired:
                flush_buffer(key)
            time.sleep(0.25)

    def on_event(topic: str, envelope: EventEnvelope) -> None:
        if topic == Topics.SESSION_STOPPED:
            flush_buffer(buffer_key(envelope.session_id, envelope.device_id), trace_id=envelope.trace_id, causation_id=envelope.event_id)
            return
        if topic != Topics.AUDIO_FRAME:
            return
        payload = envelope.payload
        seq = int(payload["frame_seq"])
        key = buffer_key(envelope.session_id, envelope.device_id)
        with lock:
            buffer = buffers.get(key)
            if not buffer:
                buffer = FrameBuffer(
                    session_id=envelope.session_id,
                    device_id=envelope.device_id,
                    encoding=str(payload.get("encoding", "wav_pcm16")),
                    started_at=envelope.created_at,
                    last_at=envelope.created_at,
                )
                buffers[key] = buffer
            if seq in buffer.seen_frame_seq:
                logger.info("Duplicate frame ignored: %s", seq)
                return
            buffer.seen_frame_seq.add(seq)
            audio_b64 = str(payload.get("audio_b64", ""))
            if audio_b64:
                buffer.chunks.append(b64decode_bytes(audio_b64))
            buffer.last_at = envelope.created_at
            buffer.encoding = str(payload.get("encoding", buffer.encoding))
            should_flush = bool(payload.get("speech_final")) and bool(buffer.chunks)
        if should_flush:
            flush_buffer(key, trace_id=envelope.trace_id, causation_id=envelope.event_id)

    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        subscriptions=[Topics.AUDIO_FRAME, Topics.SESSION_STOPPED],
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
    threading.Thread(target=flusher_loop, daemon=True).start()
    logger.info("Frame aggregator agent started")
    mqtt.serve_forever()


if __name__ == "__main__":
    main()

