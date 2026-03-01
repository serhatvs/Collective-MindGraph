from __future__ import annotations

import uvicorn
from fastapi import FastAPI

from shared.common.serialization import b64decode_bytes


app = FastAPI(title="Mock STT Service")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/transcribe")
def transcribe(request: dict[str, object]) -> dict[str, object]:
    raw_bytes = b64decode_bytes(str(request["audio_b64"]))
    try:
        text = raw_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        text = ""
    if not text:
        text = f"transcript for {request['segment_id']}"
    return {
        "text": text,
        "confidence": 0.98,
    }


def main() -> None:
    uvicorn.run(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()

