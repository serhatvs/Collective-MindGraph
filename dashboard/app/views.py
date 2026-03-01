from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from dashboard.app.db_reader import build_dashboard_context


def register_routes(app: FastAPI, templates: Jinja2Templates) -> None:
    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> HTMLResponse:
        context = build_dashboard_context(app.state.store)
        context["heartbeats"] = app.state.dashboard_state.heartbeats()
        context["request"] = request
        return templates.TemplateResponse("index.html", context)

    @app.get("/api/sessions")
    def api_sessions() -> list[dict[str, object]]:
        return app.state.store.list_sessions(limit=50)

    @app.get("/api/sessions/{session_id}")
    def api_session_detail(session_id: str) -> dict[str, object]:
        session = app.state.store.get_session(session_id)
        return {
            "session": session,
            "transcripts": app.state.store.latest_transcripts(session_id, limit=20),
            "nodes": app.state.store.latest_nodes(session_id, limit=50),
            "latest_snapshot": app.state.store.latest_snapshot(session_id),
        }

    @app.get("/api/snapshots/latest")
    def api_latest_snapshot() -> dict[str, object] | None:
        return app.state.store.latest_snapshot()

