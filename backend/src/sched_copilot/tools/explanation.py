"""将结构化结果转为带证据的固定说明，不调用业务规则或其他 Agent。"""

import json
import re

from ..agents.contracts.artifacts import EvaluationDifferences, EvaluationMetrics
from ..agents.contracts.common import Statement
from ..agents.contracts.results import ExplanationData, ExplanationTradeoff, NextStep
from ..domain.production_conditions import production_condition_labels
from ..domain.time_display import production_time
from .explanation_context import ExplanationSource


def explain_results(source: ExplanationSource) -> ExplanationData:
    """将已校验的结构化内容转为固定措辞，每条陈述保留原始引用。"""
    request = source.request
    facts, assumptions, risks, tradeoffs, steps, limitations = [], [], [], [], [], []
    order_ids, operation_ids = set(), set()
    if source.case:
        for item in source.case.orders:
            if re.search(
                r"(?<![A-Za-z0-9_-])" + re.escape(item.order_id) + r"(?![A-Za-z0-9_-])",
                request.question,
                re.IGNORECASE,
            ):
                order_ids.add(item.order_id)
        for item in source.case.operations:
            if re.search(
                r"(?<![A-Za-z0-9_-])" + re.escape(item.operation_id) + r"(?![A-Za-z0-9_-])",
                request.question,
                re.IGNORECASE,
            ):
                operation_ids.add(item.operation_id)
                order_ids.add(item.order_id)

    def statement(text, refs):
        return Statement(text=text, evidence_refs=list(dict.fromkeys(refs)))

    validation = source.validation
    if validation:
        ref = request.validation_result_ref
        if validation.data:
            facts.append(
                statement(
                    "数据校验允许受限生成候选。"
                    if validation.data.can_generate_candidates
                    else "数据校验未允许生成候选。",
                    [ref],
                )
            )
            for issue in validation.data.issues:
                facts.append(statement(issue.message, [ref, *issue.evidence_refs]))
                risks.append(statement(issue.impact, [ref, *issue.evidence_refs]))
                steps.append(
                    NextStep(
                        action=issue.repair_hint,
                        requires_human_confirmation=True,
                        evidence_refs=[ref, *issue.evidence_refs],
                    )
                )
        for error in validation.errors if validation.data is None else []:
            facts.append(statement(error.message, [ref, *error.evidence_refs]))
            steps.append(
                NextStep(
                    action=error.repair_hint,
                    requires_human_confirmation=True,
                    evidence_refs=[ref, *error.evidence_refs],
                )
            )
        if validation.data and validation.data.unchecked_items:
            risks.append(
                statement(
                    "未检查的生产条件："
                    + "、".join(production_condition_labels(validation.data.unchecked_items)),
                    [ref],
                )
            )
    if source.case:
        for event in source.case.failures:
            estimate = (
                production_time(event.estimated_recovery_at)
                if event.estimated_recovery_at
                else "未知"
            )
            facts.append(
                statement(
                    f"设备 {event.machine_id} 的故障从 {production_time(event.started_at)} 开始；"
                    f"人工预计恢复时间为 {estimate}。",
                    [source.case_ref],
                )
            )
            risks.append(
                statement(
                    "预计恢复时间不是实际恢复确认，变化后需要重新生成并评价候选。",
                    [source.case_ref],
                )
            )
    if source.batch:
        assumptions.extend(s.model_copy(deep=True) for s in source.batch.assumptions)
        limitations.extend(source.batch.limitations)
        for candidate in source.batch.candidates:
            change = source.changes[candidate.candidate_id]
            facts.append(
                statement(
                    f"策略 {candidate.strategy_id} 的候选包含 {len(change.items)} 项工序变更。",
                    [candidate.plan_ref, candidate.changes_ref],
                )
            )
            for item in change.items:
                if order_ids and item.order_id not in order_ids:
                    continue
                if operation_ids and item.operation_id not in operation_ids:
                    continue
                facts.append(
                    statement(
                        f"订单 {item.order_id} 工序 {item.operation_id}：设备 "
                        f"{item.before_machine_id} → {item.after_machine_id}；开工 "
                        f"由{production_time(item.before_start)}调整为{production_time(item.after_start)}；"
                        f"完工由{production_time(item.before_end)}调整为{production_time(item.after_end)}。"
                        f"依据：{item.reason}；影响链：{item.impact_path}。",
                        [candidate.changes_ref, *item.evidence_refs],
                    )
                )
            check = request.evidence_catalog[candidate.constraint_check_ref].content
            if check["unchecked_items"]:
                risks.append(
                    statement(
                        "候选未检查的生产条件："
                        + "、".join(production_condition_labels(check["unchecked_items"])),
                        [candidate.constraint_check_ref],
                    )
                )
    evaluation = source.evaluation
    if evaluation and evaluation.data:
        for item in evaluation.data.evaluations:
            risks.extend(s.model_copy(deep=True) for s in item.risks)
            facts.append(
                statement(
                    f"候选 {item.candidate_id} 已有指标与差异评价。",
                    [item.metrics_ref, item.differences_ref],
                )
            )
            metrics = EvaluationMetrics.model_validate_json(
                json.dumps(request.evidence_catalog[item.metrics_ref].content)
            )
            facts.append(
                statement(
                    f"候选总延期 {metrics.total_lateness_minutes:g} 分钟，"
                    f"原计划为 {metrics.baseline_total_lateness_minutes:g} 分钟；"
                    f"延期订单 {metrics.late_orders} 个；移动工序 {metrics.moved_operations} 个，"
                    f"其中设备转移 {metrics.transferred_operations} 个。",
                    [item.metrics_ref],
                )
            )
            differences = EvaluationDifferences.model_validate_json(
                json.dumps(request.evidence_catalog[item.differences_ref].content)
            )
            if metrics.changeover_minutes is not None:
                facts.append(
                    statement(
                        f"候选换型 {metrics.changeovers} 次，"
                        f"共 {metrics.changeover_minutes:g} 分钟；"
                        f"原计划换型 {metrics.baseline_changeover_minutes:g} 分钟。",
                        [item.metrics_ref],
                    )
                )
            for load in metrics.machine_loads:
                if load.utilization is not None:
                    facts.append(
                        statement(
                            f"设备 {load.machine_id} 班次利用率 {load.utilization:.1%}，"
                            "按加工及换型分钟除以扣除故障的班次可用分钟计算。",
                            [item.metrics_ref],
                        )
                    )
            for row in differences.orders:
                if order_ids and row.order_id not in order_ids:
                    continue
                facts.append(
                    statement(
                        f"订单 {row.order_id}：交期 {production_time(row.due_at)}；预计完工 "
                        f"由{production_time(row.before_completion)}调整为"
                        f"{production_time(row.after_completion)}；"
                        f"延期 {row.baseline_lateness_minutes:g} → {row.lateness_minutes:g} 分钟。",
                        [item.differences_ref],
                    )
                )
            if item.missing_metrics:
                limitations.append("未计算的评价指标：" + "、".join(item.missing_metrics))
        tradeoffs.extend(
            ExplanationTradeoff(
                text=t.description,
                candidate_ids=list(t.candidate_ids),
                evidence_refs=list(t.evidence_refs),
            )
            for t in evaluation.data.tradeoffs
        )
    for result, ref in (
        (source.scheduling, request.candidate_batch_ref),
        (evaluation, request.evaluation_result_ref),
    ):
        if result and result.status in {"blocked", "failed"}:
            for error in result.errors:
                facts.append(statement(error.message, [ref, *error.evidence_refs]))
                steps.append(
                    NextStep(
                        action=error.repair_hint,
                        requires_human_confirmation=True,
                        evidence_refs=[ref, *error.evidence_refs],
                    )
                )
    # 只接纳有来源的假设，用户问题及无来源文本不能升级为业务事实。
    for text in request.assumptions:
        if any(s.text == text for s in assumptions):
            continue
        refs = [
            ref
            for ref, e in request.evidence_catalog.items()
            if e.kind == "assumption" and e.content == {"text": text}
        ]
        if refs:
            assumptions.append(statement(text, refs))
        else:
            limitations.append("有输入假设缺少对应来源证据，未纳入解释。")
    if source.batch:
        ref = request.evaluation_result_ref or request.candidate_batch_ref
        if ref is None:
            ref = source.batch.candidates[0].plan_ref
        steps.append(
            NextStep(
                action="请计划员核对风险与现场条件后选择候选；发布正式计划仍需人工确认。",
                requires_human_confirmation=True,
                evidence_refs=[ref],
            )
        )
    if (
        source.compare
        and not tradeoffs
        and not (source.batch and len(source.batch.candidates) == 1)
    ):
        limitations.append("已有评价未提供候选取舍说明，本次只展示已登记事实。")
    if order_ids and not (evaluation and evaluation.data):
        limitations.append("尚无有效订单交付评价，只能解释已有工序变化，不能判断订单延期。")
    # 首版仅覆盖固定的业务解释意图，避免将通用摘要当作任意问答成功。
    if not re.search(
        r"解释|说明|原因|为什么|为何|变化|影响|风险|假设|比较|对比|取舍|"
        r"哪个好|哪个更|推荐|最优|explain|why|compare|trade|better|best|recommend",
        request.question,
        re.IGNORECASE,
    ):
        limitations.append("当前仅支持结构化业务解释，未完整回答该自由文本问题。")
    if validation and validation.status == "blocked":
        summary = "当前数据存在阻断项，需修复后重新校验；本次说明不生成候选。"
    elif order_ids:
        summary = "所询订单或工序的已有变化和交付证据如下；不推测证据之外的原因。"
    elif tradeoffs:
        summary = "候选取舍如下；请核对现场条件与恢复不确定性，最终由计划员决定。"
    elif source.batch and len(source.batch.candidates) == 1 and evaluation and evaluation.data:
        candidate = source.batch.candidates[0]
        label = request.evidence_catalog[candidate.plan_ref].content["label"]
        summary = (
            f"当前约束与已运行策略下仅有一个不同的可行候选：{label}。"
            "无需进行多方案取舍，建议核对下列影响和风险后由计划员确认执行。"
        )
        limitations.append(
            "当前只比较已运行的规则策略，不构成全局唯一最优解证明；不会自动发布执行计划。"
        )
    elif source.batch:
        summary = "候选变更及其依据如下；尚无可用于候选比较的取舍说明。"
    else:
        summary = "已有校验或执行结果说明如下，请按证据与修复建议处理。"
    return ExplanationData(
        summary=summary,
        facts=facts,
        assumptions=assumptions,
        risks=risks,
        tradeoffs=tradeoffs,
        next_steps=steps,
        limitations=list(dict.fromkeys(limitations)),
    )
