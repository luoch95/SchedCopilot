"""One request, one workflow; progress is emitted by the actual Agent boundaries."""

import json
import logging
from queue import Empty, Queue
from threading import Event, Thread

from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from ..application.errors import ApplicationError
from ..domain.errors import RuleViolation
from .errors import STATUS

logger = logging.getLogger(__name__)


def workflow_stream(execute):
    events = Queue()
    closed = Event()

    def emit(event):
        if not closed.is_set():
            events.put(event)

    def worker():
        try:
            emit({"type": "result", "data": execute(emit)})
        except ApplicationError as exc:
            emit(
                {"type": "error", "status": STATUS[type(exc)], "code": exc.code, "detail": str(exc)}
            )
        except RuleViolation as exc:
            emit({"type": "error", "status": 409, "code": "rule_violation", "detail": str(exc)})
        except Exception as exc:
            logger.warning("Workflow stream failed: %s", type(exc).__name__)
            emit(
                {
                    "type": "error",
                    "status": 500,
                    "code": "workflow_stream_failed",
                    "detail": "执行中断，请检查后台后重新生成方案。",
                }
            )
        finally:
            events.put(None)

    def chunks():
        Thread(target=worker, daemon=True).start()
        try:
            while not closed.is_set():
                try:
                    event = events.get(timeout=5)
                except Empty:
                    yield '{"type":"heartbeat"}\n'
                    continue
                if event is None:
                    break
                yield json.dumps(jsonable_encoder(event), ensure_ascii=False) + "\n"
        finally:
            # A disconnected client never starts a second workflow automatically.
            closed.set()

    return StreamingResponse(
        chunks(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
