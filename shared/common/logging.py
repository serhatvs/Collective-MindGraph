from __future__ import annotations

import logging
import sys


def configure_logging(service_name: str) -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format=f"%(asctime)s | {service_name} | %(levelname)s | %(message)s",
        stream=sys.stdout,
        force=True,
    )
    return logging.getLogger(service_name)

