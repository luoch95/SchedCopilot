"""Optional diagnostic context, independent of business state and external SDKs."""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
from time import monotonic
from uuid import uuid4

_current = ContextVar("diagnostic_run", default=None)
_parent = ContextVar("diagnostic_parent", default=None)


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def span(name, kind="chain"):
    run = _current.get()
    node = {
        "id": str(uuid4()),
        "name": name,
        "kind": kind,
        "parent_id": _parent.get(),
        "started_at": now(),
        "status": "success",
    }
    token = _parent.set(node["id"])
    started = monotonic()
    try:
        yield node
    except Exception as exc:
        node.update(status="failed", error_code=type(exc).__name__)
        raise
    finally:
        node.update(ended_at=now(), elapsed_ms=round((monotonic() - started) * 1000))
        _parent.reset(token)
        if run is not None:
            run["spans"].append(node)


def bind(**values):
    if (run := _current.get()) is not None:
        run.update(values)


def observed(business_type):
    def decorate(function):
        @wraps(function)
        def execute(self, *args, **kwargs):
            sink = getattr(self, "telemetry", None)
            if sink is None:
                return function(self, *args, **kwargs)
            run = {
                "id": str(uuid4()),
                "business_type": business_type,
                "started_at": now(),
                "status": "running",
                "spans": [],
            }
            token = _current.set(run)
            parent_token = _parent.set(None)
            started = monotonic()
            try:
                result = function(self, *args, **kwargs)
                run["status"] = run.get("outcome", "completed")
                return result
            except Exception as exc:
                run.update(status="failed", error_code=type(exc).__name__)
                raise
            finally:
                run.pop("outcome", None)
                run.update(ended_at=now(), elapsed_ms=round((monotonic() - started) * 1000))
                modes = {node.get("mode") for node in run["spans"]}
                run["mode"] = (
                    "fallback"
                    if "fallback" in modes
                    else (
                        "live"
                        if "live" in modes or any(n["kind"] == "llm" for n in run["spans"])
                        else "rules"
                    )
                )
                models = [n for n in run["spans"] if n["kind"] == "llm"]
                run["model_calls"] = len(models)
                for key in ("input_tokens", "output_tokens"):
                    values = [n[key] for n in models if key in n]
                    run[key] = sum(values) if values and len(values) == len(models) else None
                _current.reset(token)
                _parent.reset(parent_token)
                try:
                    sink.record(run)
                except Exception:
                    # Diagnostics must never replace a business result or exception.
                    pass

        return execute

    return decorate
