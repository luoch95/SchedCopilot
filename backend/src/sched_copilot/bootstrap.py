"""Composition root: wire concrete adapters into application ports."""

from datetime import timedelta

from .agents.workflow import run_analysis
from .application.workbench import WorkbenchService
from .config import Settings
from .domain.models import MachineFailure
from .infrastructure.sqlite_repository import DecisionStore
from .scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule


def build_workbench(settings: Settings) -> WorkbenchService:
    service = WorkbenchService(
        DecisionStore(settings.database_path, demo_schedule()),
        demo_machines(),
        demo_orders(),
        EVENT_TIME,
        MachineFailure(
            "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "计划员手动录入", EVENT_TIME
        ),
        run_analysis,
    )
    service.initialize()
    return service
