import { collectDescendantIds, getMainTrunkNodeIds, type BranchKind, type NodeRecord } from "@cmg/shared";
import { useEffect, useState } from "react";

function branchKindFromType(branchType: NodeRecord["branchType"]): BranchKind {
  return branchType === "main" ? "main" : "side";
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

const branchSortOrder: Record<NodeRecord["branchType"], number> = {
  main: 0,
  side1: 1,
  side2: 2
};

interface TreeViewProps {
  nodes: NodeRecord[];
  disabled: boolean;
  busyNodeId: number | null;
  busyNodeAction: "override" | "accept" | null;
  onOverride: (nodeId: number, parentId: number, branchKind: BranchKind) => Promise<void>;
  onAcceptHeuristic: (nodeId: number) => Promise<void>;
}

interface TreeNodeCardProps extends TreeViewProps {
  node: NodeRecord;
  childrenByParent: Map<number | null, NodeRecord[]>;
  trunkNodeIds: Set<number>;
}

function TreeNodeCard({
  node,
  nodes,
  disabled,
  busyNodeId,
  busyNodeAction,
  onOverride,
  onAcceptHeuristic,
  childrenByParent,
  trunkNodeIds
}: TreeNodeCardProps) {
  const [selectedParentId, setSelectedParentId] = useState(String(node.parentId ?? ""));
  const [selectedBranchKind, setSelectedBranchKind] = useState<BranchKind>(branchKindFromType(node.branchType));
  const descendants = collectDescendantIds(nodes, node.nodeId);
  const validParentOptions = nodes.filter((candidate) => candidate.nodeId !== node.nodeId && !descendants.has(candidate.nodeId));
  const children = childrenByParent.get(node.nodeId) ?? [];
  const isBusy = busyNodeId === node.nodeId;
  const isApplyingOverride = isBusy && busyNodeAction === "override";
  const isAcceptingHeuristic = isBusy && busyNodeAction === "accept";

  useEffect(() => {
    setSelectedParentId(String(node.parentId ?? ""));
    setSelectedBranchKind(branchKindFromType(node.branchType));
  }, [node.parentId, node.branchType]);

  async function handleApply() {
    await onOverride(node.nodeId, Number(selectedParentId), selectedBranchKind);
  }

  async function handleAcceptHeuristic() {
    await onAcceptHeuristic(node.nodeId);
  }

  return (
    <li className="tree-node">
      <article className={`node-card ${trunkNodeIds.has(node.nodeId) ? "node-card--trunk" : ""}`}>
        <div className="node-card__header">
          <div>
            <span className="node-badge">Node #{node.nodeId}</span>
            <p className="node-meta">{formatTimestamp(node.timestamp)}</p>
          </div>
          <div className="node-pill-group">
            <span className={`branch-pill branch-pill--${branchKindFromType(node.branchType)}`}>{node.branchType}</span>
            <span className={`branch-pill branch-pill--status-${node.aiStatus}`}>{node.aiStatus.replace("_", " ")}</span>
          </div>
        </div>

        <p className="node-text">{node.text}</p>

        {node.aiStatus === "pending" ? (
          <p className="status">AI analyzing this node. Placement may still change automatically.</p>
        ) : null}
        {node.aiStatus === "failed" ? (
          <p className="status status--warning">AI enrichment failed. Accept the heuristic placement to unblock commits.</p>
        ) : null}
        {node.placementSource === "manual" ? (
          <p className="status">Manual override locks placement. AI can only update metadata.</p>
        ) : null}

        <dl className="node-details">
          <div>
            <dt>Current parent</dt>
            <dd>{node.parentId === null ? "Root" : `#${node.parentId}`}</dd>
          </div>
          <div>
            <dt>Suggested parent</dt>
            <dd>{node.suggestedParentId === null ? "Root" : `#${node.suggestedParentId}`}</dd>
          </div>
          <div>
            <dt>Suggested branch</dt>
            <dd>{node.suggestedBranchType}</dd>
          </div>
          <div>
            <dt>AI confidence</dt>
            <dd>{node.suggestedScore === null ? "Waiting" : node.suggestedScore.toFixed(4)}</dd>
          </div>
          <div>
            <dt>Classification</dt>
            <dd>{node.classification ?? "Waiting"}</dd>
          </div>
          <div>
            <dt>Placement source</dt>
            <dd>{node.placementSource}</dd>
          </div>
        </dl>

        {node.aiRationale ? <p className="node-rationale">{node.aiRationale}</p> : null}

        {node.nodeId === 1 ? null : (
          <div className="override-row">
            <label className="field field--compact">
              <span>Parent</span>
              <select
                value={selectedParentId}
                onChange={(event) => setSelectedParentId(event.target.value)}
                disabled={disabled || isBusy}
              >
                {validParentOptions.map((candidate) => (
                  <option key={candidate.nodeId} value={candidate.nodeId}>
                    #{candidate.nodeId} {candidate.text.slice(0, 32)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--compact">
              <span>Branch</span>
              <select
                value={selectedBranchKind}
                onChange={(event) => setSelectedBranchKind(event.target.value as BranchKind)}
                disabled={disabled || isBusy}
              >
                <option value="main">main</option>
                <option value="side">side</option>
              </select>
            </label>

            <button className="secondary-button" type="button" disabled={disabled || isBusy} onClick={() => void handleApply()}>
              {isApplyingOverride ? "Applying..." : "Apply override"}
            </button>
          </div>
        )}

        {node.aiStatus === "failed" ? (
          <button className="secondary-button node-action-button" type="button" disabled={disabled || isBusy} onClick={() => void handleAcceptHeuristic()}>
            {isAcceptingHeuristic ? "Accepting..." : "Accept heuristic"}
          </button>
        ) : null}
      </article>

      {children.length > 0 ? (
        <ul className="tree-children">
          {children.map((child) => (
            <TreeNodeCard
              key={child.nodeId}
              node={child}
              nodes={nodes}
              disabled={disabled}
              busyNodeId={busyNodeId}
              busyNodeAction={busyNodeAction}
              onOverride={onOverride}
              onAcceptHeuristic={onAcceptHeuristic}
              childrenByParent={childrenByParent}
              trunkNodeIds={trunkNodeIds}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeView(props: TreeViewProps) {
  const childrenByParent = new Map<number | null, NodeRecord[]>();

  for (const node of [...props.nodes].sort(
    (left, right) => left.nodeId - right.nodeId || branchSortOrder[left.branchType] - branchSortOrder[right.branchType]
  )) {
    const key = node.parentId;
    const group = childrenByParent.get(key) ?? [];
    group.push(node);
    childrenByParent.set(key, group);
  }

  const roots = childrenByParent.get(null) ?? [];
  const trunkNodeIds = getMainTrunkNodeIds(props.nodes);

  if (roots.length === 0) {
    return <p className="empty-state">No nodes yet. Start typing and wait for the first 60 second chunk.</p>;
  }

  return (
    <ul className="tree-root">
      {roots.map((node) => (
        <TreeNodeCard
          key={node.nodeId}
          node={node}
          nodes={props.nodes}
          disabled={props.disabled}
          busyNodeId={props.busyNodeId}
          busyNodeAction={props.busyNodeAction}
          onOverride={props.onOverride}
          onAcceptHeuristic={props.onAcceptHeuristic}
          childrenByParent={childrenByParent}
          trunkNodeIds={trunkNodeIds}
        />
      ))}
    </ul>
  );
}
