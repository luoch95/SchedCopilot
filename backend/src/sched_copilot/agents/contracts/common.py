"""Shared wire contracts for the four-Agent boundary."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Refs = Annotated[list[Text], Field(min_length=1)]
AgentName = Literal["validation", "scheduling", "evaluation", "explanation"]
AgentStatus = Literal["success", "warning", "blocked", "failed"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class AgentContext(Contract):
    case_id: Text
    snapshot_id: Text
    event_version: Annotated[int, Field(ge=0)]
    current_plan_version: Text
    input_fingerprint: Text


class Evidence(Contract):
    context: AgentContext
    kind: Text
    content: JsonValue


class Notice(Contract):
    code: Text
    message: Text
    repair_hint: Text
    evidence_refs: list[Text]


class QualityIssue(Contract):
    code: Text
    message: Text
    repairable: bool


class QualityRound(Contract):
    round: Annotated[int, Field(ge=1, le=3)]
    issues: list[QualityIssue] = Field(default_factory=list)
    repair: Text | None = None


class QualityReport(Contract):
    version: Literal["AGD-V1.3-I1"] = "AGD-V1.3-I1"
    outcome: Literal["passed", "warning", "blocked", "failed"]
    round: Annotated[int, Field(ge=1, le=3)]
    issues: list[QualityIssue] = Field(default_factory=list)
    stop_reason: Text | None = None
    history: list[QualityRound] = Field(default_factory=list)


class Statement(Contract):
    text: Text
    evidence_refs: Refs


class AgentInput(Contract):
    context: AgentContext
    evidence_catalog: dict[Text, Evidence]


class ResultBase(Contract):
    prompt_version: Annotated[str, Field(pattern=r"^\d+\.\d+\.\d+$")]
    requirements_version: Annotated[str, Field(pattern=r"^V\d+\.\d+$")]
    context: AgentContext
    status: AgentStatus
    evidence_refs: list[Text]
    warnings: list[Notice]
    errors: list[Notice]
    quality: QualityReport | None = None
