from __future__ import annotations

import base64
import json
from typing import Any


def json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def json_loads(raw: str | bytes) -> Any:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def b64encode_bytes(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64decode_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"))
