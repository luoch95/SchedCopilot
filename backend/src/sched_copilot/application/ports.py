"""Dependencies required by use cases; adapters implement these contracts."""

from collections.abc import Callable
from typing import Protocol

from ..domain.models import CandidatePlan, Machine, MachineFailure, Schedule
from .contracts import WorkflowOutcome

EventSelector = Callable[[Schedule, tuple[MachineFailure, ...]], MachineFailure]
Analyzer = Callable[..., dict[str, str]]
WorkflowRunner = Callable[..., WorkflowOutcome]


class DecisionRepository(Protocol):
    def production_snapshot(self) -> dict | None: ...

    def workflow_session(self, workflow_id: str) -> dict | None: ...

    def manual_draft(self, draft_id: str | None = None) -> dict | None: ...

    def manual_simulation(self, simulation_id: str) -> dict | None: ...

    def save_manual_draft(
        self,
        payload: dict,
        expected_revision: int | None = None,
        candidate: CandidatePlan | None = None,
    ) -> dict: ...

    def fault_analysis(self, revision: int) -> dict | None: ...

    def fault_review(self, revision: int, fingerprint: str) -> dict | None: ...

    def submit_fault_review(
        self, simulation_id: str, candidate_id: str, reason: str, request_id: str
    ) -> dict: ...

    def review_fault(self, review_id: str, action: str, reason: str) -> dict: ...

    def submit_assessment_review(self, workflow_id: str, reason: str, request_id: str) -> dict: ...

    def workflow_simulation_id(self, workflow_id: str) -> str | None: ...

    def latest_workflow(self) -> tuple[dict, str | None] | None: ...

    def attach_workflow_simulation(self, workflow_id: str, simulation_id: str | None) -> None: ...

    def plan_metadata(self, version: int, event_revision: int | None = None) -> dict: ...

    def operation_labels(self, schedule: Schedule) -> dict: ...

    def published_orders(self) -> tuple: ...

    def active_event(self) -> tuple[MachineFailure, int] | None: ...

    def snapshot(self) -> tuple[Schedule, MachineFailure, int]: ...

    def history(self) -> list[dict]: ...

    def event_cancelled(self, revision: int) -> bool: ...

    def cancel_event(
        self, expected_revision: int, fingerprint: str, target_revision: int | None = None
    ) -> None: ...

    def event_history(self) -> list[dict]: ...

    def failure_windows(self) -> tuple[MachineFailure, ...]: ...

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
        approval_simulation_id: str | None = None,
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
