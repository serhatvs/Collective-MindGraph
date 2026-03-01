from datetime import datetime, timedelta, timezone

from shared.common.graph_rules import build_main_branch_summary, choose_attachment, find_main_tail, snapshot_hash


def make_node(
    node_id: str,
    *,
    parent_node_id: str | None,
    branch_type: str,
    branch_slot: int | None = None,
    node_text: str = "",
    created_offset: int = 0,
) -> dict[str, object]:
    return {
        "node_id": node_id,
        "transcript_id": f"transcript-{node_id}",
        "parent_node_id": parent_node_id,
        "branch_type": branch_type,
        "branch_slot": branch_slot,
        "node_text": node_text or node_id,
        "created_at": datetime(2026, 3, 1, tzinfo=timezone.utc) + timedelta(seconds=created_offset),
    }


def test_choose_attachment_returns_root_for_empty_graph() -> None:
    result = choose_attachment(
        nodes=[],
        candidate_parent_id=None,
        branch_preference="main",
        node_id="node-1",
        current_main_tail_node_id=None,
    )
    assert result["branch_type"] == "root"
    assert result["parent_node_id"] is None


def test_choose_attachment_prefers_main_when_available() -> None:
    nodes = [make_node("root", parent_node_id=None, branch_type="root")]
    result = choose_attachment(
        nodes=nodes,
        candidate_parent_id="root",
        branch_preference="main",
        node_id="node-1",
        current_main_tail_node_id="root",
    )
    assert result["branch_type"] == "main"
    assert result["parent_node_id"] == "root"
    assert result["branch_slot"] is None


def test_choose_attachment_repairs_to_side_when_main_already_taken() -> None:
    nodes = [
        make_node("root", parent_node_id=None, branch_type="root"),
        make_node("main-1", parent_node_id="root", branch_type="main"),
    ]
    result = choose_attachment(
        nodes=nodes,
        candidate_parent_id="root",
        branch_preference="main",
        node_id="node-2",
        current_main_tail_node_id="main-1",
    )
    assert result["branch_type"] == "side"
    assert result["branch_slot"] == 1
    assert result["override_reason"] == "branch_repaired_to_side"


def test_choose_attachment_repairs_invalid_parent_to_main_tail() -> None:
    nodes = [
        make_node("root", parent_node_id=None, branch_type="root"),
        make_node("main-1", parent_node_id="root", branch_type="main"),
    ]
    result = choose_attachment(
        nodes=nodes,
        candidate_parent_id="missing",
        branch_preference="main",
        node_id="node-3",
        current_main_tail_node_id="main-1",
    )
    assert result["parent_node_id"] == "main-1"


def test_main_branch_summary_uses_latest_five_main_nodes() -> None:
    nodes = [
        make_node("root", parent_node_id=None, branch_type="root", node_text="root"),
        make_node("n1", parent_node_id="root", branch_type="main", node_text="one"),
        make_node("n2", parent_node_id="n1", branch_type="main", node_text="two"),
        make_node("n3", parent_node_id="n2", branch_type="main", node_text="three"),
        make_node("n4", parent_node_id="n3", branch_type="main", node_text="four"),
        make_node("n5", parent_node_id="n4", branch_type="main", node_text="five"),
    ]
    assert find_main_tail(nodes) == "n5"
    assert build_main_branch_summary(nodes) == "one | two | three | four | five"


def test_snapshot_hash_is_deterministic() -> None:
    nodes_a = [
        make_node("root", parent_node_id=None, branch_type="root", node_text="root", created_offset=0),
        make_node("n1", parent_node_id="root", branch_type="main", node_text="one", created_offset=1),
    ]
    nodes_b = list(reversed(nodes_a))
    assert snapshot_hash(nodes_a) == snapshot_hash(nodes_b)

