"""Observe page arrivals without counting polling, assets, or health checks."""

from datetime import datetime, timedelta, timezone
from ipaddress import ip_address

from starlette.concurrency import run_in_threadpool

LOCAL = timezone(timedelta(hours=8))


def client_ip(request):
    forwarded = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
    for value in (forwarded, request.client.host if request.client else ""):
        try:
            address = ip_address(value)
            if address.version == 6 and address.ipv4_mapped:
                address = address.ipv4_mapped
            return str(address)
        except ValueError:
            continue
    return None


def install_visits(app, record):
    @app.middleware("http")
    async def track_visit(request, call_next):
        response = await call_next(request)
        if (
            request.method == "GET"
            and request.url.path in {"/", "/admin", "/api/visits"}
            and 200 <= response.status_code < 300
        ):
            ip = client_ip(request)
            if ip:
                await run_in_threadpool(record, ip, datetime.now(LOCAL).date().isoformat())
        return response
