"""读取已有结构化结果并组织说明，不执行校验、排产或评价规则。"""

import json
import re
from dataclasses import dataclass

from pydantic import BaseModel

from ..agents.contracts.artifacts import (
    CandidateChanges,
    CandidateConstraintCheck,
    CandidateSnapshot,
    EvaluationDifferences,
    EvaluationMetrics,
)
from ..agents.contracts.common import Notice
from ..agents.contracts.inputs import ExplanationInput, SchedulingCase
from ..agents.contracts.results import (
    EvaluationResult,
    SchedulingData,
    SchedulingResult,
    ValidationResult,
)


class ExplanationBlocked(ValueError):
    """缺少回答所需的有效来源，不尝试猜测答案。"""

    def __init__(self, code: str, message: str, refs: list[str]):
        self.notice = Notice(
            code=code,
            message=message,
            repair_hint="读取当前版本的完整结果及证据后重新解释。",
            evidence_refs=refs,
        )
        super().__init__(message)


@dataclass(frozen=True)
class ExplanationSource:
    request: ExplanationInput
    validation: ValidationResult | None
    scheduling: SchedulingResult | None
    evaluation: EvaluationResult | None
    batch: SchedulingData | None
    changes: dict[str, CandidateChanges]
    case: SchedulingCase | None
    case_ref: str | None
    compare: bool


def _refs(value):
    """只遍历类型化字段，不把任意 JSON 内容当作通信契约。"""
    if isinstance(value, BaseModel):
        for name in type(value).model_fields:
            child = getattr(value, name)
            if name == "evidence_refs":
                yield from child
            elif name.endswith("_ref") and child is not None:
                yield child
            else:
                yield from _refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from _refs(child)


def prepare_explanation(request: ExplanationInput) -> ExplanationSource:
    """核对结构、来源与相互引用；绝不重新调用业务规则工具。"""
    compare = bool(
        re.search(
            r"比较|对比|取舍|优劣|哪个好|哪个更|推荐|最优|compare|trade.?off|better|best|recommend",
            request.question,
            re.IGNORECASE,
        )
    )
    catalog = request.evidence_catalog
    linked = [
        request.validation_result_ref,
        request.candidate_batch_ref,
        request.evaluation_result_ref,
    ]
    refs = [ref for ref in linked if ref is not None]
    if not refs:
        raise ExplanationBlocked("EVIDENCE_REQUIRED", "没有可解释的结构化结果。", [])
    try:

        def read(ref, schema, kind):
            if ref is None:
                return None
            if catalog[ref].kind != kind:
                raise ValueError("上游结果证据类型错误")
            result = schema.model_validate(catalog[ref].content)
            if result.prompt_version != "1.1.0" or result.requirements_version != "V1.1":
                raise ValueError("上游实现版本不匹配")
            if set(_refs(result)) - catalog.keys():
                raise ValueError("上游引用缺失")
            complete = result.status in {"success", "warning"}
            if complete and (result.data is None or not result.evidence_refs or result.errors):
                raise ValueError("上游完成结果为空或包含错误")
            if result.status == "success" and result.warnings:
                raise ValueError("上游成功状态与警告冲突")
            if result.status == "warning" and not result.warnings:
                raise ValueError("上游缺少警告说明")
            if not complete and not result.errors:
                raise ValueError("上游未完成结果缺少错误说明")
            if not complete and result.data is not None and schema is not ValidationResult:
                raise ValueError("失败结果不能携带可用方案")
            return result

        validation = read(request.validation_result_ref, ValidationResult, "validation_result")
        scheduling = read(request.candidate_batch_ref, SchedulingResult, "scheduling_result")
        evaluation = read(request.evaluation_result_ref, EvaluationResult, "evaluation_result")
        if validation and validation.data:
            blocking = any(i.severity == "blocking" for i in validation.data.issues)
            if (blocking and validation.status != "blocked") or (
                validation.data.can_generate_candidates
                != (validation.status in {"success", "warning"})
            ):
                raise ValueError("校验阻断状态冲突")
        batch = scheduling.data if scheduling else None
        manifest_refs = set()
        if batch:
            manifest_refs.update(
                ref for ref in scheduling.evidence_refs if catalog[ref].kind == "candidate_batch"
            )
        if evaluation and evaluation.data:
            report_refs = [
                ref for ref in evaluation.evidence_refs if catalog[ref].kind == "evaluation_report"
            ]
            if len(report_refs) != 1 or catalog[
                report_refs[0]
            ].content != evaluation.data.model_dump(mode="json"):
                raise ValueError("评价报告与登记证据不一致")
            for item in evaluation.data.evaluations:
                manifest_refs.update(
                    ref for ref in item.evidence_refs if catalog[ref].kind == "candidate_batch"
                )
        if batch or (evaluation and evaluation.data and not evaluation.data.assessment):
            if len(manifest_refs) != 1:
                raise ValueError("缺少唯一候选批次证据")
            manifest = SchedulingData.model_validate(catalog[next(iter(manifest_refs))].content)
            if batch is not None and batch != manifest:
                raise ValueError("候选清单与排产结果不一致")
            batch = manifest
            if set(_refs(batch)) - catalog.keys():
                raise ValueError("候选清单有未知引用")
        changes, case, case_ref = {}, None, None
        if batch:
            ids = [c.candidate_id for c in batch.candidates]
            if not ids or len(ids) != len(set(ids)):
                raise ValueError("候选清单为空或重复")
            for candidate in batch.candidates:
                plan_evidence = catalog[candidate.plan_ref]
                change_evidence = catalog[candidate.changes_ref]
                check_evidence = catalog[candidate.constraint_check_ref]
                if (plan_evidence.kind, change_evidence.kind, check_evidence.kind) != (
                    "candidate_plan",
                    "candidate_changes",
                    "candidate_constraints",
                ):
                    raise ValueError("候选证据类型错误")
                plan = CandidateSnapshot.model_validate_json(json.dumps(plan_evidence.content))
                change = CandidateChanges.model_validate_json(json.dumps(change_evidence.content))
                check = CandidateConstraintCheck.model_validate(check_evidence.content)
                if (
                    {plan.candidate_id, change.candidate_id, check.candidate_id}
                    != {candidate.candidate_id}
                    or plan.strategy_id != candidate.strategy_id
                    or not check.passed
                ):
                    raise ValueError("候选证据归属或检查状态不一致")
                if set(_refs(change)) - catalog.keys():
                    raise ValueError("变更引用缺失")
                if case_ref is not None and case_ref != plan.source_plan_ref:
                    raise ValueError("候选基线不一致")
                case_ref = plan.source_plan_ref
                if catalog[case_ref].kind != "case":
                    raise ValueError("候选缺少原始案例")
                case = SchedulingCase.model_validate_json(json.dumps(catalog[case_ref].content))
                original = {o.operation_id: o for o in case.operations}
                after = {o.operation_id: o for o in plan.operations}
                if len(after) != len(plan.operations) or original.keys() != after.keys():
                    raise ValueError("候选工序集合不一致")
                changed_ids = {key for key in original if original[key] != after[key]}
                if (
                    len(change.items) != len(changed_ids)
                    or {item.operation_id for item in change.items} != changed_ids
                ):
                    raise ValueError("候选变化与计划不一致")
                for item in change.items:
                    before, new = original[item.operation_id], after[item.operation_id]
                    if (
                        item.order_id,
                        item.before_start,
                        item.after_start,
                        item.before_machine_id,
                        item.after_machine_id,
                    ) != (
                        before.order_id,
                        before.start_at,
                        new.start_at,
                        before.machine_id,
                        new.machine_id,
                    ):
                        raise ValueError("候选变更时间或设备不一致")
                changes[candidate.candidate_id] = change
        if case is None and validation:
            cases = [ref for ref in validation.evidence_refs if catalog[ref].kind == "case"]
            if len(cases) == 1:
                case_ref = cases[0]
                case = SchedulingCase.model_validate_json(json.dumps(catalog[case_ref].content))
        if (
            validation
            and validation.status in {"blocked", "failed"}
            and (batch or (evaluation and evaluation.data))
        ):
            raise ValueError("阻断校验与可用候选同时存在")
        if evaluation and evaluation.data and not evaluation.data.assessment:
            data = evaluation.data
            ids = [e.candidate_id for e in data.evaluations]
            if (
                data.candidate_batch_id != batch.candidate_batch_id
                or not ids
                or len(ids) != len(set(ids))
                or set(ids) - changes.keys()
            ):
                raise ValueError("评价批次或候选范围不一致")
            if any(not t.candidate_ids or set(t.candidate_ids) - set(ids) for t in data.tradeoffs):
                raise ValueError("取舍引用评价范围外候选")
            for item in data.evaluations:
                if catalog[item.metrics_ref].kind != "evaluation_metrics" or (
                    catalog[item.differences_ref].kind != "evaluation_differences"
                ):
                    raise ValueError("评价证据类型错误")
                metrics = EvaluationMetrics.model_validate_json(
                    json.dumps(catalog[item.metrics_ref].content)
                )
                differences = EvaluationDifferences.model_validate_json(
                    json.dumps(catalog[item.differences_ref].content)
                )
                if metrics.time_unit != "minutes":
                    raise ValueError("不支持的指标单位")
                expected_changes = changes[item.candidate_id].items
                if {d.operation_id for d in differences.operations} != {
                    c.operation_id for c in expected_changes
                } or len(differences.operations) != len(expected_changes):
                    raise ValueError("评价差异与候选变更范围不一致")
                for diff in differences.operations:
                    change = next(
                        c for c in expected_changes if c.operation_id == diff.operation_id
                    )
                    for field in (
                        "order_id",
                        "before_machine_id",
                        "after_machine_id",
                        "before_start",
                        "after_start",
                        "before_end",
                        "after_end",
                    ):
                        if getattr(change, field) != getattr(diff, field):
                            raise ValueError("评价差异与候选变更明细不一致")
                if item.missing_metrics and evaluation.status != "warning":
                    raise ValueError("缺失指标未披露")
    except Exception:
        raise ExplanationBlocked(
            "EVIDENCE_REQUIRED", "上游结果、批次或明细证据缺失或不一致。", refs
        ) from None
    if compare and (
        evaluation is None
        or evaluation.data is None
        or evaluation.status not in {"success", "warning"}
        or batch is None
        or {item.candidate_id for item in evaluation.data.evaluations}
        != {item.candidate_id for item in batch.candidates}
    ):
        raise ExplanationBlocked(
            "EVALUATION_REQUIRED",
            "解释候选需要当前批次所有候选的有效评价；单候选也必须完成评价。",
            refs,
        )
    return ExplanationSource(
        request, validation, scheduling, evaluation, batch, changes, case, case_ref, compare
    )
