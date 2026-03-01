from __future__ import annotations

from typing import Any


def build_dashboard_context(store: Any) -> dict[str, object]:
    sessions = store.list_sessions(limit=20)
    selected_session = sessions[0] if sessions else None
    transcripts = store.latest_transcripts(selected_session["session_id"], limit=10) if selected_session else []
    nodes = store.latest_nodes(selected_session["session_id"], limit=20) if selected_session else []
    latest_snapshot = store.latest_snapshot(selected_session["session_id"]) if selected_session else None
    return {
        "sessions": sessions,
        "selected_session": selected_session,
        "transcripts": transcripts,
        "nodes": nodes,
        "latest_snapshot": latest_snapshot,
    }
