"""Read-only sales projections and processing estimates, without allocation details."""

from dataclasses import asdict
from math import ceil

from ..domain.errors import RuleViolation
from ..domain.products import Product
from .contracts import WorkbenchSnapshot


class SalesService:
    def __init__(self, products: tuple[Product, ...]):
        self.products = products

    def overview(self, snapshot: WorkbenchSnapshot) -> dict:
        completions = {}
        names = {
            op.order_id: snapshot.operation_labels[op.id]["order_display_name"]
            for op in snapshot.baseline.operations
            if op.id in snapshot.operation_labels
        }
        for operation in snapshot.baseline.operations:
            previous = completions.get(operation.order_id)
            if previous is None or operation.end > previous:
                completions[operation.order_id] = operation.end
        return {
            "plan_version": snapshot.baseline.version,
            "plan_fingerprint": snapshot.baseline.fingerprint,
            "snapshot_time": snapshot.snapshot_time,
            "source": "本地仿真排产计划；非真实生产记录",
            "products": [asdict(product) for product in self.products],
            "product_source": "固定模拟产品参数 v1；冗余比例为演示经验值",
            "orders": [
                {
                    "id": order.id,
                    "display_name": names.get(order.id, order.id),
                    "name": order.name,
                    "due": order.due,
                    "planned_completion": completions.get(order.id),
                    "lateness_minutes": (
                        max(0, ceil((completions[order.id] - order.due).total_seconds() / 60))
                        if order.id in completions
                        else None
                    ),
                }
                for order in snapshot.orders
            ],
        }

    def estimate(self, product_id: str, quantity: int) -> dict:
        product = next((item for item in self.products if item.id == product_id), None)
        if product is None:
            raise RuleViolation("产品不存在，请重新选择模拟产品")
        return product.estimate(quantity)
