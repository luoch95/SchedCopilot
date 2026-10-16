"""Application workflows can be tested without an HTTP server."""

from dataclasses import replace
from datetime import timedelta

import pytest

from sched_copilot.application.contracts import Analyze, SnapshotVersion
from sched_copilot.application.errors import AnalysisUnavailable, SnapshotConflict
from sched_copilot.bootstrap import build_workbench
from sched_copilot.config import Settings
from sched_copilot.domain.errors import RuleViolation


@pytest.fixture
def service(tmp_path):
    return build_workbench(Settings(tmp_path / "test.sqlite3", tmp_path / "frontend"))


def version(service):
    state = service.workbench()
    return SnapshotVersion(state.event_revision, state.baseline.fingerprint)


def test_application_rejects_analysis_when_recovery_is_unknown(service):
    _, event, _ = service.repository.snapshot()
    service.repository.record_event(replace(event, recovered_at=None))
    with pytest.raises(RuleViolation, match="预计恢复时间"):
        service.analyze(Analyze(version(service), False, "分析交付"))


def test_application_discards_analysis_if_event_changes_during_execution(service):
    initial = version(service)

    def update_event(*args, **kwargs):
        _, event, revision = service.repository.snapshot()
        service.repository.record_event(
            replace(event, recovered_at=event.recovered_at + timedelta(hours=1)), revision
        )
        return {"plan_report": "This result belongs to the old event"}

    service.analyzer = update_event
    with pytest.raises(SnapshotConflict):
        service.analyze(Analyze(initial, False, "分析交付"))


def test_application_masks_provider_errors(service, caplog):
    def provider_failure(*args, **kwargs):
        raise RuntimeError("sensitive-provider-token")

    service.analyzer = provider_failure
    with pytest.raises(AnalysisUnavailable) as failure:
        service.analyze(Analyze(version(service), True, "分析交付"))
    assert "sensitive-provider-token" not in str(failure.value)
    assert "sensitive-provider-token" not in caplog.text
