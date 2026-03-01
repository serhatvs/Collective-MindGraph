# Collective MindGraph

Docker-first monorepo for a distributed multi-agent reasoning demo built around MQTT events, Postgres state, and isolated Python agent containers.

## Stack

- Mosquitto for the event bus
- Postgres for sessions, transcripts, graph nodes, and snapshots
- Python 3.11 agents and mocks
- FastAPI dashboard with Jinja templates

## Services

- `session-controller-agent`
- `frame-aggregator-agent`
- `stt-agent`
- `llm-tree-orchestrator-agent`
- `consistency-agent`
- `graph-writer-agent`
- `snapshot-agent`
- `dashboard`
- `mock-llm`
- `mock-stt`

## Quick Start

1. Copy `.env.example` to `.env` if you want to override defaults.
2. Start Docker Desktop or another Docker daemon.
3. Build and start the core stack:

```powershell
docker compose up --build
```

4. Open the dashboard:

`http://localhost:8000`

## Simulator Flows

Run each simulator as a one-shot container:

```powershell
docker compose --profile sim run --rm transcript-fixture-publisher
docker compose --profile sim run --rm segment-fixture-publisher
docker compose --profile sim run --rm edge-frame-sim
```

## Tests

Contract tests:

```powershell
pytest tests/contract agents/session_controller/tests dashboard/tests
```

Docker-backed integration tests:

```powershell
$env:RUN_DOCKER_TESTS="1"
pytest tests/integration
```

## Docs

- `docs/architecture.md`
- `docs/event-contracts.md`
- `docs/graph-rules.md`
- `docs/demo-runbook.md`
- `docs/milestones.md`
