"""Human-readable names for production conditions exposed in reports."""

PRODUCTION_CONDITION_LABELS = {
    "shift_calendar": "班次日历",
    "material_availability": "物料可用性",
    "staffing": "人员配置",
    "mold_maintenance": "模具维护状态",
    "physical_mold_occupancy": "模具占用情况",
    "changeover_duration": "换型时长",
    "physical_mold_compatibility": "模具兼容性",
}


def production_condition_labels(items) -> list[str]:
    return [PRODUCTION_CONDITION_LABELS.get(item, item) for item in items]


def production_condition_limitation(text: str) -> str:
    """Describe unchecked conditions without claiming missing data or a failed assessment."""
    label = PRODUCTION_CONDITION_LABELS.get(text)
    return f"尚未核验的生产条件：{label}；执行前需人工确认。" if label else text
