import { computeSnapshotHash, type BranchKind, type SnapshotReason, type SnapshotRecord, type StreamDetail } from "@cmg/shared";
import { startTransition, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { acceptHeuristic, addNode, commitStream, getStreamDetail, overrideNode } from "../api";
import { TreeView } from "../components/TreeView";

const CHUNK_INTERVAL_SECONDS = 60;
const COMMIT_DELAY_SECONDS = 10;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function buildExplorerHref(snapshot: SnapshotRecord) {
  const baseUrl = import.meta.env.VITE_EXPLORER_TX_BASE_URL;
  return baseUrl ? `${baseUrl}${snapshot.txHash}` : null;
}

export function StreamPage() {
  const { streamId = "" } = useParams();
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [buffer, setBuffer] = useState("");
  const [chunkCountdown, setChunkCountdown] = useState(CHUNK_INTERVAL_SECONDS);
  const [commitCountdown, setCommitCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyNodeId, setBusyNodeId] = useState<number | null>(null);
  const [busyNodeAction, setBusyNodeAction] = useState<"override" | "accept" | null>(null);
  const [isCommitPending, setIsCommitPending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const bufferRef = useRef(buffer);
  const chunkCountdownRef = useRef(CHUNK_INTERVAL_SECONDS);
  const commitCountdownRef = useRef<number | null>(null);

  function resetChunkCountdown() {
    chunkCountdownRef.current = CHUNK_INTERVAL_SECONDS;
    setChunkCountdown(CHUNK_INTERVAL_SECONDS);
  }

  function clearCommitCountdown() {
    commitCountdownRef.current = null;
    setCommitCountdown(null);
  }

  function restartCommitCountdown() {
    commitCountdownRef.current = COMMIT_DELAY_SECONDS;
    setCommitCountdown(COMMIT_DELAY_SECONDS);
  }

  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  async function refreshStream(): Promise<StreamDetail | null> {
    if (!streamId) {
      return null;
    }

    try {
      const nextDetail = await getStreamDetail(streamId);
      setError(null);
      startTransition(() => {
        setDetail(nextDetail);
      });
      return nextDetail;
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function flushBuffer() {
    const text = bufferRef.current.trim();
    if (!streamId || detail?.stream.status !== "active" || text.length === 0) {
      resetChunkCountdown();
      return { flushed: false, nextDetail: detail };
    }

    bufferRef.current = "";
    setBuffer("");

    try {
      await addNode(streamId, text);
      setError(null);
      const nextDetail = await refreshStream();
      return { flushed: true, nextDetail };
    } catch (flushError) {
      setError(getErrorMessage(flushError));
      setBuffer((current) => {
        const restored = current ? `${text}\n${current}` : text;
        bufferRef.current = restored;
        return restored;
      });
      return { flushed: false, nextDetail: detail };
    } finally {
      resetChunkCountdown();
    }
  }

  async function runCommit(reason: SnapshotReason) {
    if (!streamId || detail?.stream.status === "ended") {
      return null;
    }

    if (reason === "manual") {
      setIsCommitPending(true);
    }

    if (reason === "final") {
      setIsEnding(true);
    }

    try {
      const result = await commitStream(streamId, reason);
      clearCommitCountdown();
      setError(null);
      await refreshStream();
      return result;
    } catch (commitError) {
      setError(getErrorMessage(commitError));
      return null;
    } finally {
      setIsCommitPending(false);
      setIsEnding(false);
    }
  }

  async function handleOverride(nodeId: number, parentId: number, branchKind: BranchKind) {
    if (!streamId) {
      return;
    }

    setBusyNodeId(nodeId);
    setBusyNodeAction("override");

    try {
      await overrideNode(streamId, nodeId, { parentId, branchKind });
      setError(null);
      await refreshStream();
    } catch (overrideError) {
      setError(getErrorMessage(overrideError));
    } finally {
      setBusyNodeId(null);
      setBusyNodeAction(null);
    }
  }

  async function handleAcceptHeuristic(nodeId: number) {
    if (!streamId) {
      return;
    }

    setBusyNodeId(nodeId);
    setBusyNodeAction("accept");

    try {
      await acceptHeuristic(streamId, nodeId);
      setError(null);
      await refreshStream();
    } catch (acceptError) {
      setError(getErrorMessage(acceptError));
    } finally {
      setBusyNodeId(null);
      setBusyNodeAction(null);
    }
  }

  useEffect(() => {
    void refreshStream();
  }, [streamId]);

  useEffect(() => {
    if (!streamId || detail?.stream.status === "ended") {
      return;
    }

    const pollId = window.setInterval(() => {
      void refreshStream();
    }, 2_000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [streamId, detail?.stream.status]);

  useEffect(() => {
    if (!streamId || detail?.stream.status === "ended") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if ((detail?.ai.pendingCount ?? 0) > 0) {
        return;
      }

      const nextCountdown = chunkCountdownRef.current - 1;
      if (nextCountdown <= 0) {
        resetChunkCountdown();
        void flushBuffer();
        return;
      }

      chunkCountdownRef.current = nextCountdown;
      setChunkCountdown(nextCountdown);
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [streamId, detail?.stream.status, detail?.ai.pendingCount]);

  const currentGraphHash = detail && detail.nodes.length > 0 ? computeSnapshotHash(detail.nodes) : null;
  const autoCommitEligible =
    !!detail &&
    detail.stream.status === "active" &&
    !detail.ai.commitBlocked &&
    currentGraphHash !== null &&
    currentGraphHash !== detail.stream.lastSnapshotHash;
  const autoCommitKey = autoCommitEligible ? `${currentGraphHash}:${detail!.stream.lastSnapshotHash ?? "none"}` : null;

  useEffect(() => {
    if (!autoCommitKey) {
      clearCommitCountdown();
      return;
    }

    restartCommitCountdown();
  }, [autoCommitKey]);

  useEffect(() => {
    if (!streamId || detail?.stream.status === "ended") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (commitCountdownRef.current === null) {
        return;
      }

      const nextCountdown = commitCountdownRef.current - 1;
      if (nextCountdown <= 0) {
        clearCommitCountdown();
        void runCommit("auto");
        return;
      }

      commitCountdownRef.current = nextCountdown;
      setCommitCountdown(nextCountdown);
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [streamId, detail?.stream.status]);

  async function handleManualCommit() {
    if (!streamId || !detail || detail.stream.status === "ended") {
      return;
    }

    setIsCommitPending(true);

    try {
      const needsFlush = bufferRef.current.trim().length > 0;
      const flushResult = needsFlush ? await flushBuffer() : { flushed: false, nextDetail: detail };
      const currentDetail = flushResult.nextDetail ?? detail;

      if (needsFlush && !flushResult.flushed) {
        return;
      }

      if (currentDetail.ai.commitBlocked) {
        setError("Waiting for AI enrichment before commit.");
        return;
      }

      await runCommit("manual");
    } finally {
      setIsCommitPending(false);
    }
  }

  async function handleEndSession() {
    if (!detail || detail.stream.status === "ended") {
      return;
    }

    setIsEnding(true);

    try {
      const needsFlush = bufferRef.current.trim().length > 0;
      const flushResult = needsFlush ? await flushBuffer() : { flushed: false, nextDetail: detail };
      const currentDetail = flushResult.nextDetail ?? detail;

      if (needsFlush && !flushResult.flushed) {
        return;
      }

      if (currentDetail.ai.commitBlocked) {
        setError("Final commit is blocked until AI enrichment completes or failed nodes accept the heuristic placement.");
        return;
      }

      await runCommit("final");
    } finally {
      setIsEnding(false);
    }
  }

  if (!streamId) {
    return (
      <section className="hero-card">
        <p className="status status--error">Stream id is missing.</p>
        <Link className="secondary-button" to="/">
          Back home
        </Link>
      </section>
    );
  }

  if (isLoading && !detail) {
    return <section className="hero-card">Loading stream...</section>;
  }

  if (!detail) {
    return (
      <section className="hero-card">
        <p className="status status--error">{error ?? "Unable to load the stream."}</p>
        <Link className="secondary-button" to="/">
          Back home
        </Link>
      </section>
    );
  }

  const sessionLocked = detail.stream.status === "ended";
  const isAiPending = detail.ai.pendingCount > 0;
  const inputDisabled = sessionLocked || !detail.limits.canAddNode;
  const commitDisabled = sessionLocked || isCommitPending || detail.ai.commitBlocked;
  const finalDisabled = sessionLocked || isEnding || detail.ai.commitBlocked;
  const commitMessage = detail.ai.failedCount > 0
    ? "Resolve failed AI nodes to unblock commits."
    : detail.ai.pendingCount > 0
      ? "Waiting for AI enrichment to finish before commit."
      : null;

  return (
    <div className="session-grid">
      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Stream #{detail.stream.id}</p>
            <h2>Live discussion buffer</h2>
          </div>
          <span className={`status-chip status-chip--${detail.stream.status}`}>{detail.stream.status}</span>
        </div>

        <div className="metric-strip">
          <div className="metric-card">
            <span>Chunk in</span>
            <strong>{isAiPending ? "Paused for AI" : `${chunkCountdown}s`}</strong>
          </div>
          <div className="metric-card">
            <span>Commit when stable</span>
            <strong>
              {detail.ai.failedCount > 0
                ? "Blocked"
                : detail.ai.pendingCount > 0
                  ? "Waiting for AI"
                  : commitCountdown === null
                    ? "Waiting"
                    : `${commitCountdown}s`}
            </strong>
          </div>
          <div className="metric-card">
            <span>AI queue</span>
            <strong>
              {detail.ai.pendingCount} pending / {detail.ai.failedCount} failed
            </strong>
          </div>
        </div>

        <label className="field">
          <span>Type room notes or discussion text</span>
          <textarea
            rows={12}
            value={buffer}
            onChange={(event) => setBuffer(event.target.value)}
            disabled={inputDisabled}
            placeholder="Type live discussion text here. Every 60 seconds the current buffer becomes a node."
          />
        </label>

        <div className="action-row">
          <button className="secondary-button" type="button" disabled={commitDisabled} onClick={() => void handleManualCommit()}>
            {isCommitPending ? "Committing..." : "Commit now"}
          </button>
          <button className="primary-button" type="button" disabled={finalDisabled} onClick={() => void handleEndSession()}>
            {isEnding ? "Ending..." : "End session"}
          </button>
        </div>

        {commitMessage ? <p className="status status--warning">{commitMessage}</p> : null}
        {inputDisabled && !sessionLocked ? (
          <p className="status status--warning">The stream hit the 50 node demo limit. No more chunks can be added.</p>
        ) : null}
        {error ? <p className="status status--error">{error}</p> : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Argument tree</p>
            <h2>Live structure</h2>
          </div>
        </div>

        <TreeView
          nodes={detail.nodes}
          disabled={sessionLocked}
          busyNodeId={busyNodeId}
          busyNodeAction={busyNodeAction}
          onOverride={handleOverride}
          onAcceptHeuristic={handleAcceptHeuristic}
        />
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Snapshots</p>
            <h2>On-chain commits</h2>
          </div>
        </div>

        {detail.snapshots.length === 0 ? (
          <p className="empty-state">No snapshots committed yet.</p>
        ) : (
          <ul className="snapshot-list">
            {detail.snapshots.map((snapshot) => {
              const explorerHref = buildExplorerHref(snapshot);

              return (
                <li key={`${snapshot.streamId}-${snapshot.snapshotIndex}`} className="snapshot-card">
                  <div className="snapshot-card__header">
                    <strong>#{snapshot.snapshotIndex}</strong>
                    <span className={`branch-pill branch-pill--${snapshot.reason}`}>{snapshot.reason}</span>
                  </div>
                  <p className="snapshot-hash">{snapshot.snapshotHash}</p>
                  <p className="node-meta">{formatDateTime(snapshot.createdAt)}</p>
                  {explorerHref ? (
                    <a href={explorerHref} target="_blank" rel="noreferrer">
                      {snapshot.txHash}
                    </a>
                  ) : (
                    <p className="snapshot-hash">{snapshot.txHash}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
