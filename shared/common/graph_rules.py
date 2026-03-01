from __future__ import annotations

import hashlib
from typing import Any

from shared.common.serialization import json_dumps


def index_nodes(nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {node["node_id"]: node for node in nodes}


def child_slots(nodes: list[dict[str, Any]], parent_node_id: str) -> tuple[bool, list[int]]:
    has_main = False
    side_slots: list[int] = []
    for node in nodes:
        if node["parent_node_id"] != parent_node_id:
            continue
        if node["branch_type"] == "main":
            has_main = True
        elif node["branch_type"] == "side" and node["branch_slot"] in (1, 2):
            side_slots.append(int(node["branch_slot"]))
    return has_main, sorted(side_slots)


def find_root(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
    for node in nodes:
        if node["branch_type"] == "root":
            return node
    return None


def find_main_tail(nodes: list[dict[str, Any]]) -> str | None:
    root = find_root(nodes)
    if not root:
        return None
    by_parent = {node["parent_node_id"]: node for node in nodes if node["branch_type"] == "main"}
    current = root["node_id"]
    while current in by_parent:
        current = by_parent[current]["node_id"]
    return current


def main_branch_texts(nodes: list[dict[str, Any]]) -> list[str]:
    root = find_root(nodes)
    if not root:
        return []
    main_nodes_by_parent = {node["parent_node_id"]: node for node in nodes if node["branch_type"] == "main"}
    texts = [root["node_text"]]
    current = root["node_id"]
    while current in main_nodes_by_parent:
        child = main_nodes_by_parent[current]
        texts.append(child["node_text"])
        current = child["node_id"]
    return texts


def build_main_branch_summary(nodes: list[dict[str, Any]]) -> str:
    texts = main_branch_texts(nodes)[-5:]
    summary = " | ".join(texts)
    return summary[:600]


def would_create_cycle(nodes_by_id: dict[str, dict[str, Any]], parent_node_id: str | None, node_id: str) -> bool:
    current = parent_node_id
    while current:
        if current == node_id:
            return True
        parent = nodes_by_id.get(current)
        current = parent["parent_node_id"] if parent else None
    return False


def choose_attachment(
    *,
    nodes: list[dict[str, Any]],
    candidate_parent_id: str | None,
    branch_preference: str,
    node_id: str,
    current_main_tail_node_id: str | None,
) -> dict[str, Any]:
    if not nodes:
        return {
            "parent_node_id": None,
            "branch_type": "root",
            "branch_slot": None,
            "override_reason": "root_node",
        }

    nodes_by_id = index_nodes(nodes)
    main_tail = current_main_tail_node_id or find_main_tail(nodes)
    override_reason = ""

    parent_id = candidate_parent_id
    if not parent_id or parent_id not in nodes_by_id or would_create_cycle(nodes_by_id, parent_id, node_id):
        parent_id = main_tail
        override_reason = "parent_repaired"

    if not parent_id or parent_id not in nodes_by_id:
        root = find_root(nodes)
        parent_id = root["node_id"] if root else None
        override_reason = "fallback_root"

    if not parent_id:
        return {
            "parent_node_id": None,
            "branch_type": "root",
            "branch_slot": None,
            "override_reason": "recovered_root",
        }

    has_main, side_slots = child_slots(nodes, parent_id)
    if branch_preference == "main" and not has_main:
        return {
            "parent_node_id": parent_id,
            "branch_type": "main",
            "branch_slot": None,
            "override_reason": override_reason,
        }

    for slot in (1, 2):
        if slot not in side_slots:
            reason = override_reason
            if not reason and branch_preference != "side":
                reason = "branch_repaired_to_side"
            return {
                "parent_node_id": parent_id,
                "branch_type": "side",
                "branch_slot": slot,
                "override_reason": reason,
            }

    fallback_parent = main_tail if main_tail and main_tail in nodes_by_id else parent_id
    return {
        "parent_node_id": fallback_parent,
        "branch_type": "main",
        "branch_slot": None,
        "override_reason": override_reason or "parent_full_fallback_main_tail",
    }


def snapshot_hash(nodes: list[dict[str, Any]]) -> str:
    normalized = []
    for node in sorted(nodes, key=lambda item: (item["created_at"], item["node_id"])):
        normalized.append(
            {
                "node_id": node["node_id"],
                "parent_node_id": node["parent_node_id"],
                "branch_type": node["branch_type"],
                "branch_slot": node["branch_slot"],
                "node_text": node["node_text"],
            }
        )
    return hashlib.sha256(json_dumps(normalized).encode("utf-8")).hexdigest()
