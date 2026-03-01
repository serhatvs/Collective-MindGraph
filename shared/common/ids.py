from __future__ import annotations

import uuid


def new_uuid() -> str:
    return str(uuid.uuid4())


def new_entity_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"

