from __future__ import annotations

import json
import time
from pathlib import Path

from shared.common.config import Settings
from shared.common.events import Topics, build_event
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService
from shared.common.serialization import b64encode_bytes


def chunk_text(text: str, parts: int = 3) -> list[str]:
    size = max(1, len(text) // parts)
    chunks = [text[index:index + size] for index in range(0, len(text), size)]
    return [chunk for chunk in chunks if chunk]


def main() -> None:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "frames" / "demo.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    mqtt = MqttService(
        client_id=settings.app_name,
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        qos=settings.mqtt_qos,
        logger=logger,
    )
    mqtt.start()
    session_id = fixture["session_id"]
    device_id = fixture["device_id"]
    mqtt.publish(
        Topics.SESSION_CONTROL_START,
        build_event(
            Topics.SESSION_CONTROL_START,
            session_id=session_id,
            device_id=device_id,
            payload={"session_id": session_id, "device_id": device_id, "started_at": None},
        ),
    )
    time.sleep(2)
    frame_seq = 1
    for utterance in fixture["utterances"]:
        chunks = chunk_text(utterance["text"], parts=4)
        for index, chunk in enumerate(chunks, start=1):
            speech_final = utterance["flush"] == "speech_final" and index == len(chunks)
            mqtt.publish(
                Topics.AUDIO_FRAME,
                build_event(
                    Topics.AUDIO_FRAME,
                    session_id=session_id,
                    device_id=device_id,
                    payload={
                        "frame_seq": frame_seq,
                        "frame_ms": 20,
                        "encoding": "wav_pcm16",
                        "vad_active": True,
                        "speech_final": speech_final,
                        "audio_b64": b64encode_bytes(chunk.encode("utf-8")),
                    },
                ),
            )
            frame_seq += 1
            time.sleep(0.1)
        time.sleep(1.5 if utterance["flush"] == "silence" else 0.5)
    time.sleep(2)
    mqtt.publish(
        Topics.SESSION_CONTROL_STOP,
        build_event(
            Topics.SESSION_CONTROL_STOP,
            session_id=session_id,
            device_id=device_id,
            payload={"session_id": session_id, "device_id": device_id, "stopped_at": None},
        ),
    )
    logger.info("Edge frame simulation completed for session %s", session_id)
    mqtt.stop()


if __name__ == "__main__":
    main()
