from dashboard.app.db_reader import build_dashboard_context
from typing import Any, cast


class FakeStore:
    def list_sessions(self, limit: int = 20) -> list[dict[str, object]]:
        return [{"session_id": "session-1", "device_id": "device-1", "status": "active"}]

    def latest_transcripts(self, session_id: str, limit: int = 10) -> list[dict[str, object]]:
        return [{"text": "hello"}]

    def latest_nodes(self, session_id: str, limit: int = 20) -> list[dict[str, object]]:
        return [{"node_text": "root"}]

    def latest_snapshot(self, session_id: str) -> dict[str, object]:
        return {"hash_sha256": "abc", "node_count": 1}


def test_build_dashboard_context_uses_latest_session_data() -> None:
    context = build_dashboard_context(FakeStore())
    selected_session = cast(dict[str, Any], context["selected_session"])
    transcripts = cast(list[dict[str, Any]], context["transcripts"])
    nodes = cast(list[dict[str, Any]], context["nodes"])
    latest_snapshot = cast(dict[str, Any], context["latest_snapshot"])
    assert selected_session["session_id"] == "session-1"
    assert transcripts[0]["text"] == "hello"
    assert nodes[0]["node_text"] == "root"
    assert latest_snapshot["hash_sha256"] == "abc"
