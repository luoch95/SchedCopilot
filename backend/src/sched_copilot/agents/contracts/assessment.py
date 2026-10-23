"""Identify completed business findings eligible for an assessment conclusion."""

from .results import SchedulingResult


def is_business_conclusion(result):
    return (
        isinstance(result, SchedulingResult)
        and result.status == "blocked"
        and bool(result.errors)
        and all(e.code == "NO_FEASIBLE_CANDIDATE" for e in result.errors)
    )
