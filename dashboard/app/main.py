from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from dashboard.app.mqtt_listener import DashboardState
from dashboard.app.views import register_routes
from shared.common.config import Settings
from shared.common.db import MindGraphStore
from shared.common.events import Topics
from shared.common.logging import configure_logging
from shared.common.mqtt import MqttService


def create_app() -> FastAPI:
    settings = Settings.from_env()
    logger = configure_logging(settings.app_name)
    app = FastAPI(title="Collective MindGraph Dashboard")
    app.state.settings = settings
    app.state.logger = logger
    app.state.store = MindGraphStore(settings.postgres_dsn)
    app.state.dashboard_state = DashboardState()

    templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))
    static_dir = Path(__file__).resolve().parent.parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    register_routes(app, templates)

    @app.on_event("startup")
    def startup() -> None:
        mqtt = MqttService(
            client_id=settings.app_name,
            host=settings.mqtt_host,
            port=settings.mqtt_port,
            qos=settings.mqtt_qos,
            subscriptions=[Topics.AGENT_HEARTBEAT],
            on_event=app.state.dashboard_state.handle_event,
            logger=logger,
        )
        app.state.dashboard_state.start(mqtt)
        logger.info("Dashboard started")

    @app.on_event("shutdown")
    def shutdown() -> None:
        app.state.dashboard_state.stop()

    return app


app = create_app()


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(app, host="0.0.0.0", port=settings.dashboard_port)


if __name__ == "__main__":
    main()

