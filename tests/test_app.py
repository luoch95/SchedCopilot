from datetime import time
from pathlib import Path

from streamlit.testing.v1 import AppTest

from sched_copilot.scenario import demo_schedule
from sched_copilot.storage import DecisionStore

SCRIPT = Path(__file__).resolve().parents[1] / "streamlit_app.py"


def workbench(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return AppTest.from_file(str(SCRIPT)).run(timeout=30)


def test_workbench_loads_and_records_rejection(tmp_path, monkeypatch):
    app = workbench(tmp_path, monkeypatch)
    assert not app.exception
    assert app.title[0].value == "Schedule Copilot"
    assert app.metric[0].value == "3"
    app.button(key="generate").click().run()
    app.text_input(key="reason").set_value("等待现场确认").run()
    app.button(key="decide").click().run()
    assert not app.exception
    assert any("已记录拒绝" in item.value for item in app.info)


def test_workbench_publish_survives_rerun(tmp_path, monkeypatch):
    app = workbench(tmp_path, monkeypatch)
    app.button(key="generate").click().run()
    app.text_input(key="reason").set_value("接受延期，等待维修").run()
    app.radio(key="action").set_value("确认发布").run()
    app.button(key="decide").click().run()
    assert not app.exception
    assert app.metric[1].value == "2"
    app.run()
    assert not app.exception
    assert app.metric[1].value == "2"


def test_edit_discards_candidates_without_changing_plan_and_save_invalidates_revision(
    tmp_path, monkeypatch
):
    app = workbench(tmp_path, monkeypatch)
    app.button(key="generate").click().run()
    assert app.button(key="decide")
    store = DecisionStore(tmp_path / ".data/decisions.sqlite3", demo_schedule())
    revision = store.active_event()[1]
    app.time_input(key="failure_recovery").set_value(time(18)).run()
    assert not app.exception
    assert not any(button.key == "decide" for button in app.button)
    assert app.button(key="generate").disabled
    assert store.active_event()[1] == revision  # Editing is not saving.
    assert store.current() == demo_schedule()
    app.button(key="save_event").click().run()
    assert store.active_event()[1] == revision + 1
    assert store.current() == demo_schedule()
    assert not any(button.key == "decide" for button in app.button)
    app.button(key="generate").click().run()
    assert app.button(key="decide")


def test_unknown_recovery_shows_risk_without_candidate_and_preserves_controls(
    tmp_path, monkeypatch
):
    app = workbench(tmp_path, monkeypatch)
    app.checkbox(key="recovery_unknown").check().run()
    app.button(key="save_event").click().run()
    assert not app.exception
    assert app.button(key="generate").disabled
    assert any("补充预计恢复时间" in item.value for item in app.warning)
    assert not any(button.key == "decide" for button in app.button)
    app.checkbox(key="recovery_unknown").uncheck().run()
    app.button(key="save_event").click().run()
    app.button(key="generate").click().run()
    assert not app.exception
    assert app.button(key="decide")


def test_no_impact_machine_does_not_move_tasks(tmp_path, monkeypatch):
    app = workbench(tmp_path, monkeypatch)
    app.selectbox(key="failure_machine").set_value("M2").run()
    app.button(key="save_event").click().run()
    assert app.metric[0].value == "0"
    app.button(key="generate").click().run()
    assert not app.exception
    assert all(
        candidate.metrics.moved_operations == 0 for candidate in app.session_state.candidates
    )


def test_invalid_recovery_and_stale_reporting_do_not_hide_editor(tmp_path, monkeypatch):
    app = workbench(tmp_path, monkeypatch)
    app.time_input(key="failure_recovery").set_value(time(12)).run()
    assert app.button(key="save_event").disabled
    assert app.button(key="generate").disabled
    app.time_input(key="failure_recovery").set_value(time(18)).run()
    app.time_input(key="failure_start").set_value(time(14)).run()
    app.button(key="save_event").click().run()
    assert not app.exception
    assert any("报工状态过期" in item.value for item in app.error)
    assert app.button(key="generate").disabled
    assert app.time_input(key="failure_start")


def test_other_page_update_requires_reload_before_editing(tmp_path, monkeypatch):
    from dataclasses import replace
    from datetime import timedelta

    app = workbench(tmp_path, monkeypatch)
    app.button(key="generate").click().run()
    store = DecisionStore(tmp_path / ".data/decisions.sqlite3", demo_schedule())
    event, revision = store.active_event()
    updated = replace(event, recovered_at=event.recovered_at + timedelta(hours=1))
    store.record_event(updated, expected_revision=revision)
    app.run()
    assert app.button(key="save_event").disabled
    assert app.button(key="generate").disabled
    assert not any(button.key == "decide" for button in app.button)
    app.button(key="reload_event").click().run()
    assert not app.exception
    assert app.time_input(key="failure_recovery").value == time(18)
    assert not app.button(key="generate").disabled


def test_blank_source_blocks_save_and_can_be_corrected(tmp_path, monkeypatch):
    app = workbench(tmp_path, monkeypatch)
    app.text_input(key="failure_source").set_value(" ").run()
    assert app.button(key="save_event").disabled
    assert app.button(key="generate").disabled
    app.text_input(key="failure_source").set_value("维修班组确认").run()
    app.button(key="save_event").click().run()
    app.button(key="generate").click().run()
    assert not app.exception
    assert app.button(key="decide")


def test_gantt_failure_band_only_covers_the_failed_machine_row():
    from datetime import timedelta

    from sched_copilot.app import _gantt
    from sched_copilot.domain import MachineFailure
    from sched_copilot.scenario import EVENT_TIME

    event = MachineFailure("M2", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "test", EVENT_TIME)
    figure = _gantt(demo_schedule(), event)
    band = figure.layout.shapes[0]
    assert band.yref == "y"
    row = list(figure.layout.yaxis.categoryarray).index("M2")
    assert band.y0 == row - 0.4
    assert band.y1 == row + 0.4
    assert band.x0 == event.started_at.replace(tzinfo=None)
    assert band.x1 == event.recovered_at.replace(tzinfo=None)
