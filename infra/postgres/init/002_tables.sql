CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'stopped')),
    started_at TIMESTAMPTZ NOT NULL,
    stopped_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_state (
    session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
    current_main_tail_node_id TEXT NULL,
    main_branch_summary TEXT NOT NULL DEFAULT '',
    last_snapshot_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcripts (
    transcript_id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    segment_id TEXT UNIQUE NOT NULL,
    text TEXT NOT NULL,
    confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    node_id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    transcript_id TEXT UNIQUE NOT NULL REFERENCES transcripts(transcript_id) ON DELETE CASCADE,
    parent_node_id TEXT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
    branch_type TEXT NOT NULL CHECK (branch_type IN ('root', 'main', 'side')),
    branch_slot SMALLINT NULL,
    node_text TEXT NOT NULL,
    override_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (branch_type = 'root' AND parent_node_id IS NULL AND branch_slot IS NULL)
        OR
        (branch_type = 'main' AND parent_node_id IS NOT NULL AND branch_slot IS NULL)
        OR
        (branch_type = 'side' AND parent_node_id IS NOT NULL AND branch_slot IN (1, 2))
    )
);

CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    snapshot_bucket_ts TIMESTAMPTZ NOT NULL,
    node_count INTEGER NOT NULL,
    hash_sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, snapshot_bucket_ts)
);

