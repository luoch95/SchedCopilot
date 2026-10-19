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
    workflow_model_mode: str = "rules"
    llm_timeout_seconds: float = 30
    llm_api_type: str = "chat_completions"

    def __post_init__(self):
        if self.workflow_model_mode not in {"rules", "auto", "live"}:
            raise ValueError("SCHED_WORKFLOW_MODEL_MODE 必须是 rules、auto 或 live")
        if not 1 <= self.llm_timeout_seconds <= 60:
            raise ValueError("LLM_TIMEOUT_SECONDS 必须在 1 到 60 秒之间")
        if self.llm_api_type not in {"chat_completions", "responses"}:
            raise ValueError("LLM_API_TYPE 必须是 chat_completions 或 responses")

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
            os.getenv("SCHED_WORKFLOW_MODEL_MODE", "auto"),
            float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
            os.getenv("LLM_API_TYPE", "chat_completions"),
        )
