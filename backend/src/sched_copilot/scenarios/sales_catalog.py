"""Stable synthetic product parameters; not real customer or workshop data."""

from ..domain.products import Product


def demo_products() -> tuple[Product, ...]:
    return (
        Product("P-DEMO-001", "仪表外壳", "ABS", 2, 45, 10),
        Product("P-DEMO-002", "连接器护套", "PA66", 4, 30, 15),
        Product("P-DEMO-003", "密封端盖", "PP", 1, 35, 12),
    )
