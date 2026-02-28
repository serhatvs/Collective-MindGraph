import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { createStream } from "../api";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while creating the stream.";
}

export function CreateStreamPage() {
  const navigate = useNavigate();
  const [metadata, setMetadata] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      const stream = await createStream(metadata.trim() || undefined);
      navigate(`/streams/${stream.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="hero-card">
      <div>
        <p className="eyebrow">Demo flow</p>
        <h2>Start a live room session</h2>
      </div>
      <p className="hero-copy">
        Create the on-chain stream first, then type live discussion text into the session page. Every 60 seconds the
        current buffer becomes a graph node. Ten seconds after a chunk lands, the backend commits a canonical snapshot
        hash to Monad.
      </p>

      <label className="field">
        <span>Metadata (optional)</span>
        <input
          value={metadata}
          onChange={(event) => setMetadata(event.target.value)}
          placeholder="collective-mindgraph-mvp"
        />
      </label>

      <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void handleSubmit()}>
        {isSubmitting ? "Creating stream..." : "Create Stream"}
      </button>

      {error ? <p className="status status--error">{error}</p> : null}
    </section>
  );
}
