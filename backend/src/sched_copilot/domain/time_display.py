"""Human-readable shop-floor times; wire timestamps retain timezone information."""

from datetime import datetime, timedelta, timezone


def production_time(value: datetime) -> str:
    local = value.astimezone(timezone(timedelta(hours=8)))
    return f"{local.year}年{local.month}月{local.day}日 {local:%H:%M}"
