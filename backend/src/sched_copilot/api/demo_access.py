"""Server-owned, process-local demo administrator sessions."""

import hmac
import secrets
from time import monotonic

from fastapi import HTTPException, Request
from pydantic import BaseModel

COOKIE = "sched_demo_admin"
SESSION_SECONDS = 8 * 60 * 60


class LoginRequest(BaseModel):
    password: str


def is_admin(request: Request) -> bool:
    token = request.cookies.get(COOKIE, "")
    expires = request.app.state.demo_sessions.get(token, 0)
    if expires <= monotonic():
        request.app.state.demo_sessions.pop(token, None)
        return False
    return True


def require_write_access(request: Request):
    if not request.app.state.settings.demo_mode:
        yield
        return
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        yield
        return
    if request.url.path in {
        "/api/demo/login",
        "/api/demo/logout",
        "/api/sales/processing-estimate",
    }:
        yield
        return
    # JSON-only writes plus an explicit header prevent cross-site form submissions.
    # Demo locking is a frontend convenience; writes do not require a login cookie.
    if request.headers.get("X-Demo-Write") != "1":
        raise HTTPException(status_code=403, detail="演示模式：无操作权限")
    with request.app.state.demo_write_lock:
        yield


def new_session(request: Request, password: str) -> str:
    expected = request.app.state.settings.demo_admin_password
    if not hmac.compare_digest(password.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="管理员密码错误")
    token = secrets.token_urlsafe(32)
    sessions = request.app.state.demo_sessions
    now = monotonic()
    for old in list(sessions):
        if sessions[old] <= now:
            del sessions[old]
    sessions[token] = now + SESSION_SECONDS
    return token
