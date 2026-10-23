"""Shared application logging setup; no prompt, API key or provider body is logged."""

import logging


def configure_logging(level: str) -> None:
    logger = logging.getLogger("sched_copilot")
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
    logger.propagate = False
