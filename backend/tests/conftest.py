"""Tests never contact a developer's model provider from a local .env file."""

import pytest


@pytest.fixture(autouse=True)
def isolate_workflow_models(monkeypatch):
    monkeypatch.setenv("SCHED_WORKFLOW_MODEL_MODE", "rules")
    monkeypatch.setenv("SCHED_DEMO_MODE", "0")
