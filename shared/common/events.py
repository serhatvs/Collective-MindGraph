from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from shared.common.ids import new_uuid


class Topics:
    SESSION_CONTROL_START = "session.control.start"
    SESSION_CONTROL_STOP = "session.control.stop"
    SESSION_STARTED = "session.started"
    SESSION_STOPPED = "session.stopped"
    AUDIO_FRAME = "audio/frame"
    AUDIO_SEGMENT_CREATED = "audio.segment.created"
    STT_TRANSCRIPT_CREATED = "stt.transcript.created"
    TREE_PROPOSAL_CREATED = "tree.proposal.created"
    TREE_APPROVED = "tree.approved"
    SNAPSHOT_HASH = "snapshot.hash"
    AGENT_HEARTBEAT = "agent.heartbeat"


class EventEnvelope(BaseModel):
    event_id: str = Field(default_factory=new_uuid)
    event_type: str
    event_version: int = 1
    trace_id: str = Field(default_factory=new_uuid)
    causation_id: str | None = None
    session_id: str
    device_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any]


def build_event(
    event_type: str,
    session_id: str,
    device_id: str,
    payload: dict[str, Any],
    *,
    trace_id: str | None = None,
    causation_id: str | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        event_type=event_type,
        trace_id=trace_id or new_uuid(),
        causation_id=causation_id,
        session_id=session_id,
        device_id=device_id,
        payload=payload,
    )
