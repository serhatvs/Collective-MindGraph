# Milestones

## Current Status

- [x] Foundation: Docker Compose stack, Postgres schema, shared contracts, and heartbeats
- [x] Reasoning backbone: transcript fixture -> LLM -> consistency -> graph
- [x] Dashboard and snapshot hashing flow
- [x] STT path
- [x] Frame path
- [x] Simulator verification for transcript, segment, and frame flows
- [x] Regression fixes for MQTT callback publishing, LLM request serialization, and snapshot bucket updates

## MVP Exit Criteria

- [ ] A new developer can run one command to reset, start, and verify the full demo
- [ ] The transcript, segment, and frame flows pass in a repeatable Docker-backed test path
- [ ] The dashboard is usable for demoing and debugging without digging into logs first
- [ ] Failure states are visible enough to diagnose broken agents or stalled event flow quickly

## MVP Sprint Plan

### 1. Demo Reliability And Repeatability

Goal: make the happy-path demo deterministic and easy to rerun.

Issue 1: Add one-command demo runner

- Status: open
- Problem: the demo currently requires multiple manual commands and operator memory
- Scope:
  - add a single command entrypoint for reset/start/verify
  - run transcript, segment, and frame simulators in order
  - print a clear pass/fail summary with session names and key counts
- Acceptance criteria:
  - one command can be run from a clean checkout
  - the command exits non-zero on failure
  - the command prints enough detail to identify which flow failed

Issue 2: Add safe demo reset flow

- Status: open
- Problem: repeat runs currently append to the same sessions unless the operator resets state manually
- Scope:
  - add a documented reset command or script
  - clear demo data safely for local development
  - make reset behavior explicit before reruns
- Acceptance criteria:
  - there is one documented way to reset demo state
  - rerunning after reset produces fresh session state
  - the reset flow is safe for local use and easy to discover

Issue 3: Document demo data behavior

- Status: open
- Problem: it is not obvious whether repeated simulator runs should append or start fresh
- Scope:
  - document cumulative-run behavior vs fresh-run behavior
  - state when to use reset
  - document expected dashboard results for each case
- Acceptance criteria:
  - a new developer can predict what the dashboard should show after a repeat run
  - the docs explain when to reset and when not to reset

Issue 4: Preserve a known-good demo path

- Status: open
- Problem: a stable operator checklist is needed for repeatable demos
- Scope:
  - define the canonical demo sequence
  - include validation checkpoints after each simulator
  - keep the sequence aligned with integration coverage
- Acceptance criteria:
  - the repo contains one canonical demo path
  - the demo path matches the current simulator and dashboard behavior

### 2. Test Runner And CI

Goal: make validation available on any machine, not only on a host with Python tooling installed.

Issue 5: Add containerized test runner

- Status: open
- Problem: local validation currently depends on host Python tooling being installed
- Scope:
  - add a Docker-backed test command for contract and integration suites
  - document how to run tests without host Python
  - keep local and CI commands aligned
- Acceptance criteria:
  - tests can be run on a machine with Docker only
  - contract and integration test entrypoints are documented

Issue 6: Add CI pipeline for validation

- Status: open
- Problem: there is no automated gate for contract and integration regressions
- Scope:
  - run contract tests in CI
  - run Docker-backed integration tests in CI where feasible
  - fail the pipeline on broken simulator flows
- Acceptance criteria:
  - pull requests get automated feedback
  - failing contract or integration tests block the pipeline

Issue 7: Expand regression coverage

- Status: open
- Problem: recent fixes exposed gaps around repeat runs, snapshot behavior, and callback-driven flows
- Scope:
  - add coverage for repeat simulator runs
  - add coverage for stale-snapshot and same-bucket cases
  - add coverage for publish-from-callback behavior and downstream propagation
- Acceptance criteria:
  - the recent MQTT, LLM serialization, and snapshot regressions are covered by tests
  - repeat-run behavior is verified explicitly

Issue 8: Harden event handling semantics

- Status: open
- Problem: some flows still assume friendly timing and ordering
- Scope:
  - review duplicate handling across all agents
  - review ordering assumptions between session, segment, transcript, graph, and snapshot events
  - add safeguards where behavior still depends on timing luck
- Acceptance criteria:
  - duplicate and late-arriving events do not corrupt state
  - known ordering assumptions are documented or eliminated

### 3. Dashboard Demo Usability

Goal: let someone understand system state from the UI during a demo.

Issue 9: Add session selection in dashboard

- Status: open
- Problem: the dashboard always focuses on the newest session, which is weak for demos and debugging
- Scope:
  - add session selection UI
  - support viewing historical sessions without manual API calls
  - keep the default experience simple
- Acceptance criteria:
  - an operator can switch sessions from the dashboard UI
  - transcripts, nodes, and snapshot panels update for the selected session

Issue 10: Improve graph and snapshot presentation

- Status: open
- Problem: the current UI exposes data, but not the reasoning state clearly enough for a demo
- Scope:
  - surface snapshot metadata more clearly
  - show override reasons in the graph display
  - make branch structure easier to scan
- Acceptance criteria:
  - a viewer can tell why a node was attached where it was
  - snapshot and graph state are understandable without reading raw API output

Issue 11: Add refresh or live-update support

- Status: open
- Problem: operators currently need to reload manually to see changes
- Scope:
  - add periodic refresh or live updates
  - ensure updates are safe for local demo scale
  - keep the UI understandable during active event flow
- Acceptance criteria:
  - dashboard state updates during active simulator runs
  - the refresh behavior is predictable and documented

Issue 12: Add session filtering and search

- Status: open
- Problem: repeated runs make the session list harder to navigate
- Scope:
  - add filtering or search by session ID and device
  - keep the UI lightweight
- Acceptance criteria:
  - an operator can find a target session quickly during repeated demos

### 4. Operational Visibility

Goal: make broken flows diagnosable without reading container internals first.

Issue 13: Surface recent agent errors

- Status: open
- Problem: failures are mostly visible only in container logs
- Scope:
  - capture and expose recent processing errors
  - show which service failed and on which topic or operation
  - keep the error view compact and demo-friendly
- Acceptance criteria:
  - a broken flow can be identified from the dashboard or API without shelling into logs first

Issue 14: Expose last processed event timestamps

- Status: open
- Problem: heartbeat presence alone does not tell whether an agent is progressing
- Scope:
  - track last processed event timestamps per service
  - display them in the dashboard
  - distinguish healthy-idle from healthy-stuck as much as possible
- Acceptance criteria:
  - operators can see whether each service is still processing recent work

Issue 15: Add troubleshooting runbook

- Status: open
- Problem: there is no short failure-response guide for common demo breakages
- Scope:
  - document common failure modes
  - document key commands and expected outputs
  - include reset guidance and simulator checks
- Acceptance criteria:
  - a developer can recover from the most common local failures using repo docs only

Issue 16: Improve health and stuck-service detection

- Status: open
- Problem: services can be alive but not making progress
- Scope:
  - extend heartbeat semantics if needed
  - flag stale services
  - define thresholds for warning or unhealthy states
- Acceptance criteria:
  - obviously stalled services are distinguishable from healthy ones

## Near-Term After MVP

- [ ] Add snapshot history views instead of only latest-snapshot views
- [ ] Add export endpoints for transcripts, graph nodes, and snapshots
- [ ] Store richer provenance for graph decisions such as rationale and trace or causation references
- [ ] Package common developer commands behind PowerShell scripts or a task runner
- [ ] Add environment profiles for local demo, CI, and hardware integration

## Post-MVP / Stretch

- [ ] Replace `mock-stt` and `mock-llm` with real service adapters
- [ ] Add ESP32 or edge-audio integration beyond the simulator path
- [ ] Add graph visualization instead of flat node lists
- [ ] Add WebSocket or push-based dashboard updates
- [ ] Add dead-letter topics and replay tooling for failed events
- [ ] Add structured observability with metrics, traces, and centralized logs
- [ ] Add deployment manifests, secret handling, and production-ready configuration
- [ ] Add authentication and role separation if the dashboard leaves local/demo-only use
- [ ] Add retention, archival, and load or performance testing strategy

## Open Questions

- [ ] Should repeated simulator runs append to the same session history, or should demos default to fresh session IDs?
- [ ] Should snapshots be emitted only on interval or stop, or also after every graph mutation?
- [ ] Is ESP32 integration part of MVP, or explicitly post-MVP?
- [ ] Does MVP require a real STT or LLM path, or is the deterministic mocked demo sufficient?
