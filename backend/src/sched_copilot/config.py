"""Resolve runtime configuration once at the composition root."""

import os
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _load_local_env() -> None:
    """Load simple root .env values without overriding the shell environment."""
    path = REPOSITORY_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


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
        _load_local_env()
        return cls(
            Path(os.getenv("SCHED_DB_PATH") or REPOSITORY_ROOT / ".data/injection_molding.sqlite3"),
            Path(os.getenv("SCHED_FRONTEND_DIR") or REPOSITORY_ROOT / "frontend/dist"),
            os.getenv("SCHED_LOG_LEVEL", "INFO").upper(),
        )
