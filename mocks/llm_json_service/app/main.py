from __future__ import annotations

import uvicorn
from fastapi import FastAPI


app = FastAPI(title="Mock LLM JSON Service")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/generate")
def generate(request: dict[str, object]) -> dict[str, object]:
    transcript = request.get("transcript", {})
    transcript_dict = transcript if isinstance(transcript, dict) else {}
    text = str(transcript_dict.get("text", ""))
    current_main_tail_node_id = request.get("current_main_tail_node_id")
    candidate_parent_id = current_main_tail_node_id
    branch_preference = "main"
    rationale = "default main-branch continuation"
    if "side" in text.lower():
        branch_preference = "side"
        rationale = "keyword side triggered a side-branch preference"
    if "override" in text.lower() or "invalid" in text.lower():
        candidate_parent_id = "missing-node"
        branch_preference = "main"
        rationale = "intentionally invalid parent for deterministic override testing"
    return {
        "candidate_parent_id": candidate_parent_id,
        "branch_preference": branch_preference,
        "node_text": text,
        "rationale": rationale,
    }


def main() -> None:
    uvicorn.run(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
