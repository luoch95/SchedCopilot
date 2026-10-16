"""Resolve runtime configuration once at the composition root."""

import os
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    database_path: Path
    frontend_dir: Path
    log_level: str = "INFO"

    @property
    def llm_configured(self) -> bool:
        """Whether live Agent analysis has the minimum provider configuration."""
        return bool(os.getenv("LLM_API_KEY") and os.getenv("LLM_MODEL"))

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            Path(os.getenv("SCHED_DB_PATH") or REPOSITORY_ROOT / ".data/injection_molding.sqlite3"),
            Path(os.getenv("SCHED_FRONTEND_DIR") or REPOSITORY_ROOT / "frontend/dist"),
            os.getenv("SCHED_LOG_LEVEL", "INFO").upper(),
        )
