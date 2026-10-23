from datetime import datetime, timezone

from sched_copilot.domain.time_display import production_time


def test_shop_floor_time_converts_to_beijing_time_across_midnight():
    assert production_time(datetime(2026, 10, 18, 23, 15, tzinfo=timezone.utc)) == (
        "2026年10月19日 07:15"
    )
