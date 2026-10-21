"""Dependencies required by use cases; adapters implement these contracts."""

from collections.abc import Callable
from typing import Protocol

from ..domain.models import CandidatePlan, Machine, MachineFailure, Schedule
from .contracts import WorkflowOutcome

EventSelector = Callable[[Schedule, tuple[MachineFailure, ...]], MachineFailure]
Analyzer = Callable[..., dict[str, str]]
WorkflowRunner = Callable[..., WorkflowOutcome]


class DecisionRepository(Protocol):
    def workflow_simulation_id(self, workflow_id: str) -> str | None: ...

    def latest_workflow(self) -> tuple[dict, str | None] | None: ...

    def attach_workflow_simulation(self, workflow_id: str, simulation_id: str | None) -> None: ...

    def plan_metadata(self, version: int) -> dict: ...

    def operation_labels(self, schedule: Schedule) -> dict: ...

    def published_orders(self) -> tuple: ...

    def active_event(self) -> tuple[MachineFailure, int] | None: ...

    def snapshot(self) -> tuple[Schedule, MachineFailure, int]: ...

    def history(self) -> list[dict]: ...

    def event_history(self) -> list[dict]: ...

    def record_event(self, event: MachineFailure, expected_revision: int | None = None) -> int: ...

    def recover_event(
        self, choose_event: EventSelector, expected_revision: int | None = None
    ) -> int: ...

    def record_simulation(
        self, simulation_id: str, candidates: tuple[CandidatePlan, ...], event: MachineFailure
    ) -> None: ...

    def simulation(
        self, simulation_id: str
    ) -> tuple[tuple[CandidatePlan, ...], MachineFailure] | None: ...

    def decide(
        self,
        candidate: CandidatePlan,
        event: MachineFailure,
        machines: tuple[Machine, ...],
        action: str,
        reason: str,
        request_id: str,
    ) -> Schedule: ...


class InsertionRepository(Protocol):
    def submission(self, key: str, fingerprint: str) -> dict | None: ...

    def submit(
        self,
        values: dict,
        key: str,
        fingerprint: str,
        estimate: dict,
        plan_version: int,
        plan_fingerprint: str,
    ) -> dict: ...

    def pending(self) -> list[dict]: ...

    def get(self, request_id: str) -> dict | None: ...

    def save_assessment(self, request_id: str, result: dict) -> None: ...

    def records(
        self, status: str | None = None, assigned_planner: str | None = None
    ) -> list[dict]: ...

    def transition(
        self,
        request_id: str,
        action: str,
        reason: str,
        assessment_id: str | None,
        schedule=None,
        production=None,
    ) -> dict: ...
