"""One request, one workflow; progress is emitted by the actual Agent boundaries."""

import asyncio
import json
import logging
from threading import Event, Thread

from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from ..application.errors import ApplicationError
from ..domain.errors import RuleViolation
from .errors import STATUS

logger = logging.getLogger(__name__)


class WorkflowCancelled(BaseException):
    """Control flow that must escape Agent exception/fallback handlers."""


def workflow_stream(execute):
    closed = Event()

    async def chunks():
        events = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def enqueue(event):
            if not closed.is_set():
                loop.call_soon_threadsafe(events.put_nowait, event)

        def emit(event):
            if closed.is_set():
                raise WorkflowCancelled()
            enqueue(event)

        def worker():
            try:
                emit({"type": "result", "data": execute(emit)})
            except WorkflowCancelled:
                pass
            except ApplicationError as exc:
                enqueue(
                    {
                        "type": "error",
                        "status": STATUS[type(exc)],
                        "code": exc.code,
                        "detail": str(exc),
                    }
                )
            except RuleViolation as exc:
                enqueue(
                    {"type": "error", "status": 409, "code": "rule_violation", "detail": str(exc)}
                )
            except Exception as exc:
                logger.warning("Workflow stream failed: %s", type(exc).__name__)
                enqueue(
                    {
                        "type": "error",
                        "status": 500,
                        "code": "workflow_stream_failed",
                        "detail": "执行中断，请检查后台后重新生成方案。",
                    }
                )
            finally:
                enqueue(None)

        Thread(target=worker, daemon=True).start()
        try:
            while not closed.is_set():
                try:
                    event = await asyncio.wait_for(events.get(), timeout=5)
                except TimeoutError:
                    yield '{"type":"heartbeat"}\n'
                    continue
                if event is None:
                    break
                yield json.dumps(jsonable_encoder(event), ensure_ascii=False) + "\n"
        finally:
            # Stop at the next real progress/quality boundary after disconnect.
            closed.set()

    return StreamingResponse(
        chunks(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
