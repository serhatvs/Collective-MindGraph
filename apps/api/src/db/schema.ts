export const schemaSql = `
CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  metadata TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  created_tx_hash TEXT NOT NULL,
  last_snapshot_index INTEGER NOT NULL DEFAULT 0,
  last_snapshot_hash TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  stream_id TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  parent_id INTEGER,
  branch_type TEXT NOT NULL,
  suggested_score REAL,
  suggested_parent_id INTEGER,
  suggested_branch_type TEXT NOT NULL,
  classification TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  placement_source TEXT NOT NULL DEFAULT 'heuristic',
  heuristic_parent_id INTEGER,
  heuristic_branch_type TEXT NOT NULL DEFAULT 'main',
  heuristic_score REAL NOT NULL DEFAULT 0,
  ai_rationale TEXT,
  ai_model TEXT,
  PRIMARY KEY (stream_id, node_id),
  FOREIGN KEY (stream_id) REFERENCES streams (id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  stream_id TEXT NOT NULL,
  snapshot_index INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (stream_id, snapshot_index),
  FOREIGN KEY (stream_id) REFERENCES streams (id)
);

CREATE TABLE IF NOT EXISTS node_enrichment_jobs (
  stream_id TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (stream_id, node_id),
  FOREIGN KEY (stream_id, node_id) REFERENCES nodes (stream_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_stream_parent ON nodes (stream_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_stream_created ON snapshots (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status_next_attempt ON node_enrichment_jobs (status, next_attempt_at);
`;
