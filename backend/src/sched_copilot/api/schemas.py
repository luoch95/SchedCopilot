"""HTTP request validation. These models do not enter the business or storage layers."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from ..application.contracts import SnapshotVersion


class SnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_revision: int = Field(ge=1)
    baseline_fingerprint: str

    def version(self) -> SnapshotVersion:
        return SnapshotVersion(self.event_revision, self.baseline_fingerprint)


class EventRequest(SnapshotRequest):
    machine_id: str
    started_at: AwareDatetime
    recovered_at: AwareDatetime | None
    source: str = Field(min_length=1, max_length=200)


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    simulation_id: str
    candidate_id: str
    action: Literal["publish", "reject"]
    reason: str = Field(min_length=1, max_length=2000)
    request_id: str = Field(min_length=1, max_length=100)


class AnalysisRequest(SnapshotRequest):
    live: bool = False
    question: str = Field(default="设备故障后，应该如何比较方案？", min_length=1, max_length=2000)


class WorkflowRequest(SnapshotRequest):
    intent: Literal["generate_candidates", "re_evaluate", "explain", "validate"]
    question: str = Field(default="解释候选方案的取舍和风险", min_length=1, max_length=2000)
    workflow_id: str | None = Field(default=None, min_length=1, max_length=100)
    demo_fallback: bool = False

    @model_validator(mode="after")
    def check_demo(self):
        if self.demo_fallback and self.intent != "generate_candidates":
            raise ValueError("兜底演示仅支持生成候选方案")
        return self
