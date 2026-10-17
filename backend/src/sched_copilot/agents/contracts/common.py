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
