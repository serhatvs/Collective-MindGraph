from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

from psycopg import connect
from psycopg.rows import dict_row


class MindGraphStore:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @contextmanager
    def connection(self) -> Iterator[Any]:
        with connect(self._dsn, row_factory=dict_row) as conn:
            yield conn

    def ping(self) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            row = cur.fetchone()
            return bool(row and row["ok"] == 1)

    def start_session(self, session_id: str, device_id: str, started_at: datetime) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (session_id, device_id, status, started_at, updated_at)
                VALUES (%s, %s, 'active', %s, NOW())
                ON CONFLICT (session_id) DO UPDATE
                SET status = 'active',
                    device_id = EXCLUDED.device_id,
                    started_at = LEAST(sessions.started_at, EXCLUDED.started_at),
                    stopped_at = NULL,
                    updated_at = NOW()
                WHERE sessions.status <> 'active'
                RETURNING session_id
                """,
                (session_id, device_id, started_at),
            )
            row = cur.fetchone()
            cur.execute(
                """
                INSERT INTO session_state (session_id)
                VALUES (%s)
                ON CONFLICT (session_id) DO NOTHING
                """,
                (session_id,),
            )
            conn.commit()
            return row is not None

    def stop_session(self, session_id: str, stopped_at: datetime) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sessions
                SET status = 'stopped', stopped_at = %s, updated_at = NOW()
                WHERE session_id = %s AND status <> 'stopped'
                RETURNING session_id
                """,
                (stopped_at, session_id),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.*, ss.current_main_tail_node_id, ss.main_branch_summary, ss.last_snapshot_at
                FROM sessions s
                LEFT JOIN session_state ss ON ss.session_id = s.session_id
                WHERE s.session_id = %s
                """,
                (session_id,),
            )
            return cur.fetchone()

    def list_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.*, ss.current_main_tail_node_id, ss.main_branch_summary, ss.last_snapshot_at
                FROM sessions s
                LEFT JOIN session_state ss ON ss.session_id = s.session_id
                ORDER BY s.updated_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            return list(cur.fetchall())

    def list_active_sessions(self) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.*, ss.current_main_tail_node_id, ss.main_branch_summary, ss.last_snapshot_at
                FROM sessions s
                LEFT JOIN session_state ss ON ss.session_id = s.session_id
                WHERE s.status = 'active'
                ORDER BY s.updated_at DESC
                """
            )
            return list(cur.fetchall())

    def insert_transcript(
        self,
        *,
        transcript_id: str,
        event_id: str,
        session_id: str,
        device_id: str,
        segment_id: str,
        text: str,
        confidence: float,
        created_at: datetime,
    ) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO transcripts (
                    transcript_id, event_id, session_id, device_id, segment_id, text, confidence, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING transcript_id
                """,
                (transcript_id, event_id, session_id, device_id, segment_id, text, confidence, created_at),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None

    def fetch_recent_nodes(self, session_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_id, transcript_id, parent_node_id, branch_type, branch_slot, node_text, created_at
                FROM graph_nodes
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, limit),
            )
            return list(cur.fetchall())

    def fetch_all_nodes(self, session_id: str) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_id, transcript_id, parent_node_id, branch_type, branch_slot, node_text, override_reason, created_at
                FROM graph_nodes
                WHERE session_id = %s
                ORDER BY created_at ASC
                """,
                (session_id,),
            )
            return list(cur.fetchall())

    def insert_graph_node(
        self,
        *,
        node_id: str,
        event_id: str,
        session_id: str,
        transcript_id: str,
        parent_node_id: str | None,
        branch_type: str,
        branch_slot: int | None,
        node_text: str,
        override_reason: str,
        created_at: datetime,
    ) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO graph_nodes (
                    node_id, event_id, session_id, transcript_id, parent_node_id,
                    branch_type, branch_slot, node_text, override_reason, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING node_id
                """,
                (
                    node_id,
                    event_id,
                    session_id,
                    transcript_id,
                    parent_node_id,
                    branch_type,
                    branch_slot,
                    node_text,
                    override_reason,
                    created_at,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None

    def update_session_state(
        self,
        *,
        session_id: str,
        current_main_tail_node_id: str | None,
        main_branch_summary: str,
        last_snapshot_at: datetime | None = None,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO session_state (session_id, current_main_tail_node_id, main_branch_summary, last_snapshot_at, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (session_id) DO UPDATE
                SET current_main_tail_node_id = EXCLUDED.current_main_tail_node_id,
                    main_branch_summary = EXCLUDED.main_branch_summary,
                    last_snapshot_at = COALESCE(EXCLUDED.last_snapshot_at, session_state.last_snapshot_at),
                    updated_at = NOW()
                """,
                (session_id, current_main_tail_node_id, main_branch_summary, last_snapshot_at),
            )
            conn.commit()

    def mark_snapshot_time(self, session_id: str, at: datetime) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE session_state
                SET last_snapshot_at = %s, updated_at = NOW()
                WHERE session_id = %s
                """,
                (at, session_id),
            )
            conn.commit()

    def store_snapshot(
        self,
        *,
        snapshot_id: str,
        event_id: str,
        session_id: str,
        snapshot_bucket_ts: datetime,
        node_count: int,
        hash_sha256: str,
        created_at: datetime,
    ) -> bool:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO snapshots (
                    snapshot_id, event_id, session_id, snapshot_bucket_ts, node_count, hash_sha256, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (session_id, snapshot_bucket_ts) DO UPDATE
                SET snapshot_id = EXCLUDED.snapshot_id,
                    event_id = EXCLUDED.event_id,
                    node_count = EXCLUDED.node_count,
                    hash_sha256 = EXCLUDED.hash_sha256,
                    created_at = EXCLUDED.created_at,
                    inserted_at = NOW()
                WHERE snapshots.node_count <> EXCLUDED.node_count
                    OR snapshots.hash_sha256 <> EXCLUDED.hash_sha256
                RETURNING snapshot_id
                """,
                (snapshot_id, event_id, session_id, snapshot_bucket_ts, node_count, hash_sha256, created_at),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None

    def latest_snapshot(self, session_id: str | None = None) -> dict[str, Any] | None:
        query = """
            SELECT snapshot_id, session_id, snapshot_bucket_ts, node_count, hash_sha256, created_at
            FROM snapshots
            {where_clause}
            ORDER BY created_at DESC
            LIMIT 1
        """
        params: tuple[Any, ...] = ()
        where_clause = ""
        if session_id:
            where_clause = "WHERE session_id = %s"
            params = (session_id,)
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query.format(where_clause=where_clause), params)
            return cur.fetchone()

    def latest_transcripts(self, session_id: str, limit: int = 10) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT transcript_id, segment_id, text, confidence, created_at
                FROM transcripts
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, limit),
            )
            return list(cur.fetchall())

    def latest_nodes(self, session_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_id, transcript_id, parent_node_id, branch_type, branch_slot, node_text, override_reason, created_at
                FROM graph_nodes
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, limit),
            )
            return list(cur.fetchall())
