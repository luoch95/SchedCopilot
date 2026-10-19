"""读取候选证据，执行差异计算并登记评价证据；不调用排产生成器。"""

import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from itertools import combinations

from ..agents.contracts.artifacts import CandidateChanges, CandidateSnapshot
from ..agents.contracts.common import Evidence, Notice, Statement
from ..agents.contracts.inputs import EvaluationInput, SchedulingCase, SchedulingInput, Strategy
from ..agents.contracts.results import (
    CandidateEvaluation,
    EvaluationData,
    EvaluationTradeoff,
    SchedulingData,
)
from ..domain.evaluation import compare_plans
from ..domain.models import MachineFailure
from ..domain.production_conditions import production_condition_labels
from .case_mapping import to_validation_case
from .scheduling import SchedulingToolOutput, verify_tool_output
from .scheduling_context import prepare_scheduling
from .validation import validate_data

RULESET_VERSION = "1.0.0"


class EvaluationBlocked(ValueError):
    """输入完整但不满足业务前置条件。"""

    def __init__(self, code: str, message: str, refs: list[str]):
        self.notice = Notice(
            code=code,
            message=message,
            repair_hint="读取当前完整候选批次与案例证据后重试。",
            evidence_refs=refs,
        )
        super().__init__(message)


@dataclass(frozen=True)
class EvaluationSource:
    request: EvaluationInput
    case: SchedulingCase
    batch: SchedulingData
    manifest_ref: str


@dataclass(frozen=True)
class EvaluationToolOutput:
    data: EvaluationData
    evidence_catalog: dict[str, Evidence]
    summary_refs: tuple[str, ...]
    warnings: tuple[Notice, ...]


def prepare_evaluation(request: EvaluationInput) -> EvaluationSource:
    """必须能解析批次和候选来源，不能把任意计划冒充有效候选。"""
    refs = [request.current_plan_ref]
    if not request.candidate_refs:
        raise EvaluationBlocked("CANDIDATES_REQUIRED", "没有待评价候选。", refs)
    if request.evaluation_criteria_ref is not None:
        raise EvaluationBlocked(
            "EVALUATION_CRITERIA_UNSUPPORTED",
            "当前仅实现默认指标口径，尚不支持自定义权重或评分规则。",
            [request.evaluation_criteria_ref],
        )
    try:
        catalog = request.evidence_catalog
        case_evidence = catalog[request.current_plan_ref]
        if case_evidence.kind != "case":
            raise ValueError("需要完整案例")
        case = SchedulingCase.model_validate_json(json.dumps(case_evidence.content))
        manifests = [
            (ref, SchedulingData.model_validate(e.content))
            for ref, e in catalog.items()
            if e.kind == "candidate_batch"
            and isinstance(e.content, dict)
            and e.content.get("candidate_batch_id") == request.candidate_batch_id
        ]
        if len(manifests) != 1:
            raise ValueError("批次证据缺失或不唯一")
        manifest_ref, batch = manifests[0]
        candidates = {c.candidate_id: c for c in batch.candidates}
        if len(candidates) != len(batch.candidates) or not candidates:
            raise ValueError("批次为空或有重复候选")
        for candidate_id, plan_ref in request.candidate_refs.items():
            if candidates[candidate_id].plan_ref != plan_ref:
                raise ValueError("候选不属于请求批次")
        validation_refs = {
            ref
            for c in batch.candidates
            for ref in c.evidence_refs
            if catalog[ref].kind == "validation_result"
        }
        if len(validation_refs) != 1:
            raise ValueError("缺少唯一校验来源")
        scheduling = SchedulingInput(
            agent_name="scheduling",
            context=request.context,
            evidence_catalog=catalog,
            validation_result_ref=next(iter(validation_refs)),
            current_plan_ref=request.current_plan_ref,
            user_constraints=[],
            allowed_strategies=[
                Strategy(strategy_id=s, description=s, parameters={})
                for s in dict.fromkeys(c.strategy_id for c in batch.candidates)
            ],
            wip_policy=case.wip_policy,
            scheduling_tool_result=None,
        )
        source = prepare_scheduling(scheduling)
        if (
            source.validation.context != request.context
            or source.validation.requirements_version != "V1.1"
        ):
            raise ValueError("校验内部上下文过期")
        fresh = validate_data(case, request.context)
        if not set(fresh.summary_refs).issubset(source.validation.evidence_refs) or any(
            catalog.get(ref) != evidence for ref, evidence in fresh.evidence_catalog.items()
        ):
            raise ValueError("案例内容与原始校验快照指纹不一致")
        for c in batch.candidates:
            for ref, kind in (
                (c.plan_ref, "candidate_plan"),
                (c.changes_ref, "candidate_changes"),
                (c.constraint_check_ref, "candidate_constraints"),
            ):
                if catalog[ref].kind != kind:
                    raise ValueError("候选证据类型错误")
            changes = CandidateChanges.model_validate_json(
                json.dumps(catalog[c.changes_ref].content)
            )
            original = {op.operation_id: op for op in case.operations}
            snapshot = CandidateSnapshot.model_validate_json(
                json.dumps(catalog[c.plan_ref].content)
            )
            after = {op.operation_id: op for op in snapshot.operations}
            for item in changes.items:
                before_op, after_op = original[item.operation_id], after[item.operation_id]
                if (
                    item.before_end
                    != before_op.start_at + timedelta(minutes=before_op.duration_minutes)
                    or item.after_end
                    != after_op.start_at + timedelta(minutes=after_op.duration_minutes)
                    or set(item.evidence_refs) - catalog.keys()
                ):
                    raise ValueError("工序变更结束时间或引用错误")
        verify_tool_output(source, SchedulingToolOutput(batch, catalog, (manifest_ref,), ()))
    except Exception:
        raise EvaluationBlocked(
            "EVALUATION_INCOMPLETE", "候选批次、来源或约束证据缺失或不一致。", refs
        ) from None
    return EvaluationSource(request, case, batch, manifest_ref)


def evaluate_candidates(source: EvaluationSource) -> EvaluationToolOutput:
    """重新计算指标，不信任请求中可能携带的旧 evaluation_tool_result。"""
    request, case = source.request, source.case
    baseline = to_validation_case(case)
    payload = {
        "context": request.context.model_dump(mode="json"),
        "case": case.model_dump(mode="json"),
        "batch": source.batch.model_dump(mode="json"),
        "catalog": {
            k: v.model_dump(mode="json")
            for k, v in request.evidence_catalog.items()
            if not v.kind.startswith("evaluation_")
        },
        "candidate_refs": request.candidate_refs,
        "ruleset_version": RULESET_VERSION,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    prefix = f"evaluation:{digest}"
    catalog = {}

    def register(ref, kind, content):
        catalog[ref] = Evidence(
            context=request.context.model_copy(deep=True), kind=kind, content=content
        )

    rules_ref = f"{prefix}:rules"
    register(
        rules_ref,
        "evaluation_rules",
        {
            "ruleset_version": RULESET_VERSION,
            "scope": "完整计划快照，包含已完成和加工中工序；未排入的订单不计为准时交付。",
            "machine_load": (
                "加工分钟单独统计；有班次数据时，利用率=(加工+换型分钟)/扣除故障的班次可用分钟。"
            ),
            "delay": "相对原计划的工序推迟与相对交期的订单延期分别统计。",
            "missing": []
            if baseline.production
            else ["extra_changeovers", "extra_changeover_minutes", "machine_utilization"],
            "production_source": case.production.source if case.production else None,
        },
    )
    evaluations, values = [], {}
    for candidate_id, plan_ref in request.candidate_refs.items():
        candidate = next(c for c in source.batch.candidates if c.candidate_id == candidate_id)
        snapshot = CandidateSnapshot.model_validate_json(
            json.dumps(request.evidence_catalog[plan_ref].content)
        )
        changed = case.model_copy(update={"operations": snapshot.operations})
        metrics, differences = compare_plans(
            baseline.schedule,
            to_validation_case(changed).schedule,
            baseline.orders,
            [m.machine_id for m in case.machines],
        )
        missing = ["extra_changeovers", "extra_changeover_minutes", "machine_utilization"]
        if baseline.production:
            event = case.failures[0]
            failure = MachineFailure(
                event.machine_id,
                event.started_at,
                event.estimated_recovery_at,
                event.source,
                event.received_at,
            )
            setup, utilization = baseline.production.evaluate(
                baseline.schedule, to_validation_case(changed).schedule, failure
            )
            metrics.update(setup)
            for load in metrics["machine_loads"]:
                load.update(utilization[load["machine_id"]])
            missing = (
                ["machine_utilization"]
                if any(load["utilization"] is None for load in metrics["machine_loads"])
                else []
            )
        refs = [
            request.current_plan_ref,
            source.manifest_ref,
            plan_ref,
            candidate.changes_ref,
            candidate.constraint_check_ref,
            rules_ref,
        ]
        risks = (
            [
                Statement(
                    text="故障恢复时间为人工估计；延迟恢复可能使本方案失效，未计算恢复概率。",
                    evidence_refs=[request.current_plan_ref],
                )
            ]
            if case.failures
            else []
        )
        check = request.evidence_catalog[candidate.constraint_check_ref].content
        if check["unchecked_items"]:
            risks.append(
                Statement(
                    text="尚未检查的生产条件："
                    + "、".join(production_condition_labels(check["unchecked_items"])),
                    evidence_refs=[candidate.constraint_check_ref],
                )
            )
        for assumption in source.batch.assumptions:
            risks.append(
                Statement(
                    text="方案依赖假设：" + assumption.text,
                    evidence_refs=assumption.evidence_refs,
                )
            )
        for limitation in source.batch.limitations:
            risks.append(Statement(text=limitation, evidence_refs=[source.manifest_ref]))
        metrics_ref, diff_ref = f"{prefix}:{candidate_id}:metrics", f"{prefix}:{candidate_id}:diff"
        register(metrics_ref, "evaluation_metrics", metrics)
        register(diff_ref, "evaluation_differences", differences)
        if metrics["orders_without_operations"]:
            missing.append("unscheduled_order_completion")
            risks.append(
                Statement(
                    text="部分订单未排入当前快照，不能据此判断这些订单准时交付。",
                    evidence_refs=[metrics_ref],
                )
            )
        evaluations.append(
            CandidateEvaluation(
                candidate_id=candidate_id,
                metrics_ref=metrics_ref,
                differences_ref=diff_ref,
                risks=risks,
                missing_metrics=missing,
                evidence_refs=refs + [metrics_ref, diff_ref],
            )
        )
        values[candidate_id] = metrics
    tradeoffs = []
    for left, right in combinations(evaluations, 2):
        a, b = values[left.candidate_id], values[right.candidate_id]
        tradeoffs.append(
            EvaluationTradeoff(
                candidate_ids=[left.candidate_id, right.candidate_id],
                description=(
                    f"按候选列示顺序：订单总延期 {a['total_lateness_minutes']:g} / "
                    f"{b['total_lateness_minutes']:g} 分钟；移动工序 "
                    f"{a['moved_operations']} / {b['moved_operations']}；设备转移 "
                    f"{a['transferred_operations']} / {b['transferred_operations']}。"
                    + (
                        f"换型时长 {a['changeover_minutes']:g} / "
                        f"{b['changeover_minutes']:g} 分钟。未计算综合排名。"
                        if baseline.production
                        else "未计算综合排名，换型成本未知。"
                    )
                ),
                evidence_refs=[left.metrics_ref, right.metrics_ref],
            )
        )
    data = EvaluationData(
        candidate_batch_id=request.candidate_batch_id,
        criteria_ref=None,
        evaluations=evaluations,
        tradeoffs=tradeoffs,
    )
    report_ref = f"{prefix}:report"
    register(report_ref, "evaluation_report", data.model_dump(mode="json"))
    warnings = (
        [
            Notice(
                code="EVALUATION_METRICS_MISSING",
                message="部分评价指标缺失；仅比较已知指标。",
                repair_hint="补充换型与班次数据，或检查班次是否存在有效可用分钟。",
                evidence_refs=[rules_ref],
            )
        ]
        if any(e.missing_metrics for e in evaluations)
        else []
    )
    if len(evaluations) < 2:
        warnings.append(
            Notice(
                code="SINGLE_CANDIDATE",
                message="仅有一个候选，可比较原计划但无法比较候选取舍。",
                repair_hint="需要方案间比较时提供其他有效候选。",
                evidence_refs=[source.manifest_ref],
            )
        )
    return EvaluationToolOutput(data, catalog, (rules_ref, report_ref), tuple(warnings))


def verify_evaluation_output(source: EvaluationSource, output: EvaluationToolOutput) -> None:
    """独立重算并比对指标、差异、风险及证据，拒绝工具伪造数字。"""
    if output != evaluate_candidates(source):
        raise ValueError("评估工具结果与确定性指标不一致")
