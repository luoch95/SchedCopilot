"""Validated persisted scenario clock and original order deadlines."""

from pydantic import AwareDatetime, BaseModel, ConfigDict


class ScenarioModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class ScenarioOrder(ScenarioModel):
    id: str
    name: str
    due: AwareDatetime
    priority: int


class ScenarioContext(ScenarioModel):
    snapshot_time: AwareDatetime
    orders: tuple[ScenarioOrder, ...]
