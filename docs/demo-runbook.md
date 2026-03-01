# Demo Runbook

## Start Core Stack

```powershell
docker compose up --build
```

Dashboard:

`http://localhost:8000`

## Run Transcript-Only Backbone

```powershell
docker compose --profile sim run --rm transcript-fixture-publisher
```

Expected result:

- session appears in dashboard
- transcripts are visible
- graph nodes are written
- snapshot hash is created

## Run Segment Pipeline

```powershell
docker compose --profile sim run --rm segment-fixture-publisher
```

Expected result:

- mock STT emits transcripts
- reasoning pipeline continues automatically

## Run Frame Pipeline

```powershell
docker compose --profile sim run --rm edge-frame-sim
```

Expected result:

- frame aggregator emits segments
- one utterance flushes by silence timeout
- one utterance flushes by `speech_final`
- invalid mock LLM parent is repaired deterministically

## Stop Stack

```powershell
docker compose down -v
```
