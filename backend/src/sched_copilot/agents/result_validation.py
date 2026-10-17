"""Fail-closed validation at the model boundary; never execute model output."""

import json
from collections.abc import Iterator

from pydantic import BaseModel, ValidationError

from ..prompts import LoadedPrompt
from .contracts.inputs import (
    AgentRequest,
    EvaluationInput,
    ExplanationInput,
    SchedulingInput,
    ValidationInput,
)
from .contracts.results import (
    AgentResult,
    EvaluationResult,
    ExplanationResult,
    SchedulingResult,
    ValidationResult,
)

_INPUTS = {
    "validation": ValidationInput,
    "scheduling": SchedulingInput,
    "evaluation": EvaluationInput,
    "explanation": ExplanationInput,
}
_OUTPUTS = {
    "validation": ValidationResult,
    "scheduling": SchedulingResult,
    "evaluation": EvaluationResult,
    "explanation": ExplanationResult,
}


class AgentContractError(ValueError):
    """Safe diagnostic: do not expose raw model output or Pydantic input values."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _reject(code: str, message: str) -> None:
    raise AgentContractError(code, message)


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            _reject("INVALID_JSON", "JSON 包含重复字段。")
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    _reject("INVALID_JSON", "JSON 包含非标准数值。")


def _decode(raw: str) -> dict:
    try:
        data = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    except (ValueError, TypeError, RecursionError) as exc:
        if isinstance(exc, AgentContractError):
            raise
        raise AgentContractError("INVALID_JSON", "需要单个有效 JSON 对象。") from None
    if not isinstance(data, dict):
        _reject("INVALID_JSON", "需要单个有效 JSON 对象。")
    return data


def _references(value: object) -> Iterator[str]:
    # Inspect typed contract fields, not arbitrary keys inside JSON payloads.
    # Strategy parameters and evidence content are data, not reference schemas.
    if isinstance(value, BaseModel):
        for key in type(value).model_fields:
            child = getattr(value, key)
            if key == "evidence_catalog":
                continue
            if key == "evidence_refs":
                yield from child
            elif key.endswith("_ref") and child is not None:
                yield child
            elif key == "candidate_refs":
                yield from child.values()
            else:
                yield from _references(child)
    elif isinstance(value, list):
        for child in value:
            yield from _references(child)


def validate_request(raw: str, prompt: LoadedPrompt) -> AgentRequest:
    """Parse wire JSON, including timezone-aware timestamps in case snapshots."""
    data = _decode(raw)
    try:
        request = _INPUTS[prompt.role].model_validate_json(json.dumps(data, ensure_ascii=False))
    except ValidationError:
        raise AgentContractError(
            "INPUT_SCHEMA_INVALID", "Agent 输入字段、类型或必填项不符合契约。"
        ) from None
    validate_input(request, prompt)
    return request


def validate_input(request: AgentRequest, prompt: LoadedPrompt) -> None:
    if type(request) is not _INPUTS[prompt.role]:
        _reject("ROLE_MISMATCH", "输入角色与实际加载的 Prompt 不一致。")
    for evidence in request.evidence_catalog.values():
        if evidence.context != request.context:
            _reject("STALE_EVIDENCE", "证据快照或版本已过期，请重新读取当前数据。")
    if set(_references(request)) - request.evidence_catalog.keys():
        _reject("UNKNOWN_REFERENCE", "输入中存在未登记的证据或结果引用。")
    if isinstance(request, SchedulingInput):
        linked = _linked_result(request, request.validation_result_ref, ValidationResult)
        if linked.requirements_version != prompt.role_metadata.requirements_version:
            _reject("UPSTREAM_VERSION_MISMATCH", "上游结果使用了其他需求版本。")
    if isinstance(request, ExplanationInput):
        for ref, schema in (
            (request.validation_result_ref, ValidationResult),
            (request.candidate_batch_ref, SchedulingResult),
            (request.evaluation_result_ref, EvaluationResult),
        ):
            if ref is not None:
                linked = _linked_result(request, ref, schema)
                if linked.requirements_version != prompt.role_metadata.requirements_version:
                    _reject("UPSTREAM_VERSION_MISMATCH", "上游结果使用了其他需求版本。")


def _linked_result(request: AgentRequest, ref: str, schema: type) -> AgentResult:
    try:
        result = schema.model_validate(request.evidence_catalog[ref].content)
    except ValidationError:
        _reject("UPSTREAM_RESULT_INVALID", "上游引用必须保存对应角色的完整结构化结果。")
    if result.context != request.context:
        _reject("STALE_CONTEXT", "上游结果内部的版本与当前请求不一致。")
    if set(_references(result)) - request.evidence_catalog.keys():
        _reject("UNKNOWN_REFERENCE", "上游结果包含未登记的引用。")
    return result


def validate_result(raw: str, request: AgentRequest, prompt: LoadedPrompt) -> AgentResult:
    """Return typed output only after structure, provenance and status checks.

    Reference membership proves existence/version, not semantic entailment of
    free-form prose. Tool-owned structured fields are compared separately.
    Callers must validate again immediately before using/persisting a result
    if the business snapshot has changed since the request was constructed.
    """
    validate_input(request, prompt)
    try:
        result = _OUTPUTS[prompt.role].model_validate(_decode(raw))
    except ValidationError:
        raise AgentContractError(
            "OUTPUT_SCHEMA_INVALID", "Agent 输出字段、类型或必填项不符合契约。"
        ) from None
    if result.context != request.context:
        _reject("STALE_CONTEXT", "输出的案例、版本或输入指纹与本次请求不一致。")
    if (
        result.prompt_version != prompt.role_metadata.prompt_version
        or result.requirements_version != prompt.role_metadata.requirements_version
    ):
        _reject("PROMPT_VERSION_MISMATCH", "输出版本与实际加载的 Prompt 不一致。")
    if set(_references(result)) - request.evidence_catalog.keys():
        _reject("UNKNOWN_REFERENCE", "输出引用了未提供的证据或结果。")

    completed = result.status in {"success", "warning"}
    if completed and (result.data is None or not result.evidence_refs or result.errors):
        _reject("EMPTY_OR_INVALID_REPORT", "完成结果必须有内容和证据，且不能包含错误。")
    if result.status == "success" and result.warnings:
        _reject("STATUS_CONFLICT", "存在警告时不能标记为成功。")
    if result.status == "warning" and not result.warnings:
        _reject("STATUS_CONFLICT", "警告状态必须提供具体警告说明。")
    if result.status in {"blocked", "failed"} and not result.errors:
        _reject("STATUS_CONFLICT", "阻断或失败状态必须说明错误与修复建议。")

    # Failure results must not smuggle an apparently usable candidate/report.
    if not completed and result.data is not None and not isinstance(result, ValidationResult):
        _reject("STATUS_CONFLICT", "非完成结果不得携带可供下游使用的方案或报告。")
    if isinstance(result, ValidationResult):
        _check_validation(result)
    if completed:
        _check_completed(result, request)
    return result


def _check_validation(result: ValidationResult) -> None:
    data = result.data
    if data is None:
        return
    blocking = any(issue.severity == "blocking" for issue in data.issues)
    if blocking and (data.can_generate_candidates or result.status != "blocked"):
        _reject("STATUS_CONFLICT", "校验阻断项不能被降级或允许生成候选。")
    if not data.can_generate_candidates and result.status in {"success", "warning"}:
        _reject("STATUS_CONFLICT", "未允许生成候选的校验应返回阻断状态。")
    if result.status in {"blocked", "failed"} and data.can_generate_candidates:
        _reject("STATUS_CONFLICT", "失败或阻断校验不能授权生成候选。")
    if any(issue.severity == "warning" for issue in data.issues) and result.status == "success":
        _reject("STATUS_CONFLICT", "校验存在警告，不能标记为无警告成功。")


def _check_completed(result: AgentResult, request: AgentRequest) -> None:
    data = result.data
    if isinstance(result, ValidationResult):
        source = request.validation_tool_result
        if source is None or data != source or not data.checked_items:
            _reject("TOOL_RESULT_MISMATCH", "校验报告必须来自非空的确定性校验结果。")
    elif isinstance(result, SchedulingResult):
        source = request.scheduling_tool_result
        if source is None or data != source or not data.candidates:
            _reject("TOOL_RESULT_MISMATCH", "候选方案必须与确定性工具结果一致且非空。")
        ids = [item.candidate_id for item in data.candidates]
        if len(ids) != len(set(ids)):
            _reject("DUPLICATE_CANDIDATE", "候选 ID 不得重复。")
        if set(item.strategy_id for item in data.candidates) - {
            item.strategy_id for item in request.allowed_strategies
        }:
            _reject("UNKNOWN_STRATEGY", "候选使用了未提供的策略。")
        if len(ids) < 2 and (result.status != "warning" or not data.limitations):
            _reject("STATUS_CONFLICT", "不足两个候选必须披露限制并返回警告。")
        evidence = request.evidence_catalog[request.validation_result_ref]
        try:
            validation = ValidationResult.model_validate(evidence.content)
        except ValidationError:
            _reject("VALIDATION_REQUIRED", "校验证据必须保存完整的结构化校验结果。")
        if (
            validation.context != request.context
            or validation.status not in {"success", "warning"}
            or validation.data is None
            or not validation.data.can_generate_candidates
            or any(issue.severity == "blocking" for issue in validation.data.issues)
            or validation.errors
            or not validation.evidence_refs
            or not validation.data.checked_items
        ):
            _reject("VALIDATION_REQUIRED", "生成候选需要当前版本通过校验的结果。")
    elif isinstance(result, EvaluationResult):
        if request.evaluation_tool_result is None or data != request.evaluation_tool_result:
            _reject("TOOL_RESULT_MISMATCH", "评估必须与确定性评价工具结果一致。")
        ids = [item.candidate_id for item in data.evaluations]
        if not ids or set(ids) != set(request.candidate_refs) or len(ids) != len(set(ids)):
            _reject("CANDIDATE_MISMATCH", "评价必须覆盖请求中的候选且不能重复。")
        if data.candidate_batch_id != request.candidate_batch_id:
            _reject("CANDIDATE_MISMATCH", "评价批次与请求不一致。")
        if data.criteria_ref != request.evaluation_criteria_ref:
            _reject("TOOL_RESULT_MISMATCH", "评价口径与请求不一致。")
        if any(item.missing_metrics for item in data.evaluations) and result.status != "warning":
            _reject("STATUS_CONFLICT", "缺少评价指标必须返回警告。")
        if any(set(item.candidate_ids) - set(ids) for item in data.tradeoffs):
            _reject("CANDIDATE_MISMATCH", "取舍说明引用了本次评价以外的候选。")
    elif isinstance(result, ExplanationResult):
        if not (data.facts or data.risks or data.tradeoffs or data.next_steps):
            _reject("EMPTY_OR_INVALID_REPORT", "解释不能只有摘要而没有证据支持的内容。")
        if data.tradeoffs and request.evaluation_result_ref is None:
            _reject("EVALUATION_REQUIRED", "解释候选取舍需要已有评价结果。")
        if data.tradeoffs:
            evaluation = _linked_result(request, request.evaluation_result_ref, EvaluationResult)
            if evaluation.status not in {"success", "warning"} or evaluation.data is None:
                _reject("EVALUATION_REQUIRED", "解释候选取舍需要已完成的评价结果。")
            ids = {item.candidate_id for item in evaluation.data.evaluations}
            if any(
                not item.candidate_ids or set(item.candidate_ids) - ids for item in data.tradeoffs
            ):
                _reject("CANDIDATE_MISMATCH", "解释引用了评价范围之外的候选。")
        if data.limitations and result.status != "warning":
            _reject("STATUS_CONFLICT", "解释存在信息限制时应返回警告。")
