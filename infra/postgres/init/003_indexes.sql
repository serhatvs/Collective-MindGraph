CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_transcripts_session_created ON transcripts(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_session_created ON graph_nodes(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_parent ON graph_nodes(session_id, parent_node_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_session_created ON snapshots(session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_graph_nodes_main_child
    ON graph_nodes(parent_node_id)
    WHERE branch_type = 'main';

CREATE UNIQUE INDEX IF NOT EXISTS uq_graph_nodes_side_slot
    ON graph_nodes(parent_node_id, branch_slot)
    WHERE branch_type = 'side' AND branch_slot IN (1, 2);

