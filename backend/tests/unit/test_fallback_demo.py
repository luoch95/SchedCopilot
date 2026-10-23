from concurrent.futures import ThreadPoolExecutor

from sched_copilot.infrastructure.fallback_demo import FallbackDemoGate


def test_demo_cooldown_survives_restart_and_expires_at_twenty_minutes(tmp_path):
    now = [1000]
    path = tmp_path / "demo.db"
    gate = FallbackDemoGate(path, clock=lambda: now[0])
    assert gate.status()["available"]
    gate.claim()
    restarted = FallbackDemoGate(path, clock=lambda: now[0])
    assert restarted.status()["remaining_seconds"] == 1200
    now[0] += 1200
    assert restarted.status()["available"]
    restarted.claim()
    assert restarted.status()["remaining_seconds"] == 1200


def test_concurrent_demo_requests_only_allow_one_claim(tmp_path):
    gate = FallbackDemoGate(tmp_path / "demo.db", clock=lambda: 1000)

    def attempt(_):
        return gate.claim()

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(attempt, range(8))) == 1
