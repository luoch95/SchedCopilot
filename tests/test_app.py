from pathlib import Path

from streamlit.testing.v1 import AppTest


def test_workbench_loads_and_records_rejection(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "streamlit_app.py"
    monkeypatch.chdir(tmp_path)
    app = AppTest.from_file(str(script)).run(timeout=30)
    assert not app.exception
    assert app.title[0].value == "Schedule Copilot"
    assert app.metric[0].value == "3"
    app.text_input[0].set_value("等待现场确认").run()
    app.button(key="decide").click().run()
    assert not app.exception
    assert "已记录拒绝" in app.info[0].value


def test_workbench_publish_survives_rerun(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[1] / "streamlit_app.py"
    monkeypatch.chdir(tmp_path)
    app = AppTest.from_file(str(script)).run(timeout=30)
    app.text_input[0].set_value("接受延期，等待维修").run()
    app.radio[0].set_value("确认发布").run()
    app.button(key="decide").click().run()
    assert not app.exception
    assert app.metric[1].value == "2"
    app.run()
    assert not app.exception
    assert app.metric[1].value == "2"
