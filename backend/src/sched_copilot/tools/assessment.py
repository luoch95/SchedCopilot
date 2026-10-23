"""Turn verified business findings into a reviewable assessment, never a plan."""

from ..agents.contracts.assessment import is_business_conclusion
from ..agents.contracts.common import Statement
from ..agents.contracts.results import AnalysisAssessment


def assess_business_result(result, ref):
    if not is_business_conclusion(result):
        raise ValueError("Only verified no-candidate findings may complete an assessment")
    return AnalysisAssessment(
        outcome="no_feasible_candidate",
        summary="分析已完成：本次所选策略在当前生产条件下未生成可用排产方案。",
        findings=[
            Statement(text=e.message, evidence_refs=[ref, *e.evidence_refs]) for e in result.errors
        ],
        recommendations=[
            *dict.fromkeys(e.repair_hint for e in result.errors),
            "如需增加产能，可由管理者评估加班或增开班次；须先确认人员、物料、设备与模具条件，"
            "更新有效班次数据后重新排产。本建议尚未验证可行性，不是可发布计划。",
        ],
        limitations=[
            "结论仅覆盖本次已执行策略和当前数据，不代表所有排产方式均不可行。",
            "没有可执行候选，未计算候选交期、调整数量或收益；审批通过仅确认评估结论，不发布排产变更。",
        ],
    )
