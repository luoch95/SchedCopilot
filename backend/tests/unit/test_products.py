import pytest

from sched_copilot.domain.errors import RuleViolation
from sched_copilot.domain.products import Product


def test_partially_filled_cycle_is_not_truncated_and_rounding_is_applied_once():
    product = Product("P1", "demo", "ABS", 2, 45, 10)
    result = product.estimate(1)
    assert result["cycles"] == 1
    assert result["theoretical_seconds"] == 45
    assert result["buffer_seconds"] == 4.5
    assert result["planned_minutes"] == 1
    assert product.estimate(2) == {**result, "quantity": 2}
    assert product.estimate(3)["cycles"] == 2


@pytest.mark.parametrize("units, seconds, buffer", [(0, 45, 10), (2, 0, 10), (2, 45, -1)])
def test_invalid_master_data_is_rejected(units, seconds, buffer):
    with pytest.raises(RuleViolation):
        Product("P", "demo", "ABS", units, seconds, buffer)
