"""Dependencies required by use cases; adapters implement these contracts."""

from collections.abc import Callable
from typing import Protocol

from ..domain.models import CandidatePlan, Machine, MachineFailure, Schedule

EventSelector = Callable[[Schedule, tuple[MachineFailure, ...]], MachineFailure]
Analyzer = Callable[..., dict[str, str]]


class DecisionRepository(Protocol):
    def active_event(self) -> tuple[MachineFailure, int] | None: ...

    def snapshot(self) -> tuple[Schedule, MachineFailure, int]: ...

    def history(self) -> list[dict]: ...

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
