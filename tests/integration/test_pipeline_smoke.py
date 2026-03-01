from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_DOCKER_TESTS = os.getenv("RUN_DOCKER_TESTS") == "1"

pytestmark = pytest.mark.skipif(not RUN_DOCKER_TESTS, reason="set RUN_DOCKER_TESTS=1 and ensure Docker daemon is running")


def compose(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", *args],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    )


def wait_for_dashboard(
    session_id: str,
    *,
    min_transcripts: int = 0,
    min_nodes: int = 0,
    require_snapshot: bool = False,
    timeout_seconds: float = 60.0,
) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    with httpx.Client(timeout=5.0) as client:
        while time.time() < deadline:
            try:
                response = client.get("http://localhost:8000/api/sessions")
                response.raise_for_status()
                sessions = response.json()
                if any(session["session_id"] == session_id for session in sessions):
                    detail = client.get(f"http://localhost:8000/api/sessions/{session_id}")
                    detail.raise_for_status()
                    payload = dict(detail.json())
                    transcripts = list(payload.get("transcripts") or [])
                    nodes = list(payload.get("nodes") or [])
                    latest_snapshot = payload.get("latest_snapshot")
                    snapshot_ready = not require_snapshot or (
                        latest_snapshot is not None and int(latest_snapshot["node_count"]) >= min_nodes
                    )
                    if len(transcripts) >= min_transcripts and len(nodes) >= min_nodes and snapshot_ready:
                        return payload
            except Exception:
                pass
            time.sleep(2)
    raise AssertionError(f"Timed out waiting for dashboard state for session {session_id}")


@pytest.fixture(autouse=True)
def cleanup_stack() -> Iterator[None]:
    try:
        yield
    finally:
        subprocess.run(["docker", "compose", "down", "-v"], cwd=REPO_ROOT, check=False, text=True, capture_output=True)


def test_it_reasoning_backbone() -> None:
    compose(
        "up",
        "-d",
        "--build",
        "postgres",
        "mosquitto",
        "mock-llm",
        "session-controller-agent",
        "llm-tree-orchestrator-agent",
        "consistency-agent",
        "graph-writer-agent",
        "snapshot-agent",
        "dashboard",
    )
    compose("--profile", "sim", "run", "--rm", "transcript-fixture-publisher")
    detail = wait_for_dashboard(
        "demo-session-transcript",
        min_transcripts=2,
        min_nodes=2,
        require_snapshot=True,
    )
    assert detail["latest_snapshot"] is not None
    assert len(detail["transcripts"]) == 2
    assert len(detail["nodes"]) == 2
    assert int(detail["latest_snapshot"]["node_count"]) == len(detail["nodes"])


def test_it_segment_pipeline() -> None:
    compose(
        "up",
        "-d",
        "--build",
        "postgres",
        "mosquitto",
        "mock-llm",
        "mock-stt",
        "session-controller-agent",
        "stt-agent",
        "llm-tree-orchestrator-agent",
        "consistency-agent",
        "graph-writer-agent",
        "snapshot-agent",
        "dashboard",
    )
    compose("--profile", "sim", "run", "--rm", "segment-fixture-publisher")
    detail = wait_for_dashboard(
        "demo-session-segment",
        min_transcripts=2,
        min_nodes=2,
        require_snapshot=True,
    )
    assert len(detail["transcripts"]) >= 1
    assert len(detail["nodes"]) >= 1
    assert detail["latest_snapshot"] is not None


def test_it_frame_pipeline() -> None:
    compose(
        "up",
        "-d",
        "--build",
        "postgres",
        "mosquitto",
        "mock-llm",
        "mock-stt",
        "session-controller-agent",
        "frame-aggregator-agent",
        "stt-agent",
        "llm-tree-orchestrator-agent",
        "consistency-agent",
        "graph-writer-agent",
        "snapshot-agent",
        "dashboard",
    )
    compose("--profile", "sim", "run", "--rm", "edge-frame-sim")
    detail = wait_for_dashboard(
        "demo-session-frame",
        min_transcripts=2,
        min_nodes=2,
        require_snapshot=True,
    )
    assert len(detail["transcripts"]) >= 1
    assert len(detail["nodes"]) >= 1
    assert detail["latest_snapshot"] is not None
