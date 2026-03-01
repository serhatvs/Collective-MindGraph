# Event Contracts

All business events use the shared JSON envelope:

- `event_id`
- `event_type`
- `event_version`
- `trace_id`
- `causation_id`
- `session_id`
- `device_id`
- `created_at`
- `payload`

## Topics

| Topic | Producer | Consumer | Payload |
| --- | --- | --- | --- |
| `session.control.start` | simulator / edge | session-controller-agent | `session_id`, `device_id`, `started_at` |
| `session.control.stop` | simulator / edge | session-controller-agent | `session_id`, `device_id`, `stopped_at` |
| `session.started` | session-controller-agent | snapshot-agent, dashboard | `session_id`, `device_id`, `status`, `started_at` |
| `session.stopped` | session-controller-agent | frame-aggregator-agent, snapshot-agent, dashboard | `session_id`, `device_id`, `status`, `stopped_at` |
| `audio/frame` | edge-frame-sim / ESP32 | frame-aggregator-agent | `frame_seq`, `frame_ms`, `encoding`, `vad_active`, `speech_final`, `audio_b64` |
| `audio.segment.created` | frame-aggregator-agent / simulator | stt-agent | `segment_id`, `encoding`, `started_at`, `ended_at`, `audio_b64` |
| `stt.transcript.created` | stt-agent / simulator | llm-tree-orchestrator-agent, dashboard | `transcript_id`, `segment_id`, `text`, `confidence` |
| `tree.proposal.created` | llm-tree-orchestrator-agent | consistency-agent | `proposal_id`, `transcript_id`, `candidate_parent_id`, `branch_preference`, `node_text`, `rationale` |
| `tree.approved` | consistency-agent | graph-writer-agent, dashboard | `proposal_id`, `transcript_id`, `node_id`, `parent_node_id`, `branch_type`, `branch_slot`, `node_text`, `override_reason` |
| `snapshot.hash` | snapshot-agent | dashboard | `snapshot_id`, `node_count`, `hash_sha256`, `snapshot_bucket_ts` |
| `agent.heartbeat` | all long-running services | dashboard | `agent_name`, `status`, `last_processed_at`, `version` |
