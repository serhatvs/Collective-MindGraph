# Architecture

The system is a single monorepo deployed with Docker Compose. Every business workflow crosses MQTT topics only; there are no agent-to-agent business HTTP calls.

## Infrastructure

- `mosquitto`: MQTT broker
- `postgres`: source of truth for sessions, transcripts, graph nodes, and snapshots

## Agents

- `session-controller-agent`: session lifecycle
- `frame-aggregator-agent`: frame buffering and segment creation
- `stt-agent`: segment to transcript
- `llm-tree-orchestrator-agent`: transcript to tree proposal
- `consistency-agent`: rule enforcement and deterministic repair
- `graph-writer-agent`: approved tree writes and session-state updates
- `snapshot-agent`: periodic graph hashing
- `dashboard`: read-only operations UI

## Mock Services

- `mock-stt`: deterministic text recovery from base64 payloads
- `mock-llm`: strict JSON tree proposals, including intentional invalid-parent cases for override testing

## Core Flow

`audio/frame -> audio.segment.created -> stt.transcript.created -> tree.proposal.created -> tree.approved -> snapshot.hash`

## State Ownership

- MQTT carries all business events
- Postgres stores durable state
- Dashboard keeps heartbeats in memory and reads durable state from Postgres
