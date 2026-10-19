"""Product processing estimates, independent of scheduling or model calls."""

from dataclasses import dataclass

from .errors import RuleViolation


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    material: str
    units_per_cycle: int
    cycle_seconds: int
    buffer_percent: int

    def __post_init__(self):
        if self.units_per_cycle <= 0 or self.cycle_seconds <= 0 or self.buffer_percent < 0:
            raise RuleViolation("产品加工参数无效")

    def estimate(self, quantity: int) -> dict:
        if type(quantity) is not int or not 1 <= quantity <= 1_000_000:
            raise RuleViolation("数量必须是 1 至 1000000 的整数")
        cycles = (quantity + self.units_per_cycle - 1) // self.units_per_cycle
        seconds = cycles * self.cycle_seconds
        # Round only the final sum up to a whole minute, using integer arithmetic.
        hundredths = seconds * (100 + self.buffer_percent)
        return {
            "product_id": self.id,
            "quantity": quantity,
            "cycles": cycles,
            "theoretical_seconds": seconds,
            "buffer_percent": self.buffer_percent,
            "buffer_seconds": seconds * self.buffer_percent / 100,
            "planned_minutes": (hundredths + 5999) // 6000,
            "source": "模拟产品参数；冗余比例为演示经验值，非真实生产统计",
        }
