"""Local Schedule Copilot workbench."""

from datetime import timedelta
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

from .agents import run_analysis
from .domain import MachineFailure
from .scenario import BASE_TIME, demo_machines, demo_orders, demo_schedule
from .scheduling import affected_operations, generate_candidates
from .storage import DecisionStore


def _frame(schedule):
    return pd.DataFrame(
        [
            {
                "任务": op.id,
                "订单": op.order_id,
                "设备": op.machine_id,
                "开始": op.start,
                "结束": op.end,
                "状态": op.status.value,
            }
            for op in schedule.operations
        ]
    )


def _gantt(schedule):
    frame = _frame(schedule)
    fig = px.timeline(
        frame,
        x_start="开始",
        x_end="结束",
        y="设备",
        color="订单",
        hover_data=["任务", "状态"],
        height=430,
    )
    fig.update_yaxes(autorange="reversed", title=None)
    fig.update_layout(margin=dict(l=8, r=8, t=25, b=8), legend_title_text="订单")
    return fig


def main() -> None:
    st.set_page_config(page_title="Schedule Copilot", page_icon="SC", layout="wide")
    st.title("Schedule Copilot")
    st.caption("生产计划员的排产辅助决策工作台 · 仿真案例 · 计划发布由人确认")
    machines, orders = demo_machines(), demo_orders()
    store = DecisionStore(Path(".data/decisions.sqlite3"), demo_schedule())
    baseline = store.current()
    failure = MachineFailure(
        "M1",
        BASE_TIME + timedelta(hours=5),
        BASE_TIME + timedelta(hours=9),
        "计划员手动录入",
        BASE_TIME + timedelta(hours=5),
    )
    store.record_event(failure)
    try:
        candidates = generate_candidates(baseline, failure, machines, orders)
    except ValueError as exc:
        st.error(str(exc))
        return

    with st.sidebar:
        st.header("现场事件")
        st.write("设备故障")
        st.metric("设备", failure.machine_id)
        st.write(f"发生：{failure.started_at:%m-%d %H:%M}")
        st.write(f"预计恢复：{failure.recovered_at:%m-%d %H:%M}")
        st.caption("事件和计划来自固定仿真数据；恢复时间是人工输入的估计值。")
        live = st.toggle(
            "启用 API 多 Agent", value=False, help="关闭时使用离线脚本流程，不产生模型调用费用。"
        )
        question = st.text_area("向 Copilot 提问", "设备 M1 故障后，应该比较哪些方案？")
        analyze = st.button("运行分析", type="primary", key="analyze")

    affected = affected_operations(baseline, failure)
    left, middle, right = st.columns(3)
    left.metric("直接受影响工序", len(affected))
    middle.metric("当前计划版本", baseline.version)
    right.metric("候选方案", len(candidates))
    st.plotly_chart(
        _gantt(baseline), key="current-gantt", width="stretch", config={"displayModeBar": False}
    )

    st.subheader("方案比较")
    rows = [
        {
            "方案": item.label,
            "延期订单": item.metrics.late_orders,
            "累计延期(分钟)": item.metrics.total_lateness_minutes,
            "移动工序": item.metrics.moved_operations,
            "计划完工": item.metrics.makespan.strftime("%m-%d %H:%M"),
        }
        for item in candidates
    ]
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    selected_label = st.selectbox("查看候选方案", [item.label for item in candidates])
    selected = next(item for item in candidates if item.label == selected_label)
    detail, evidence = st.columns([1.2, 1])
    with detail:
        st.write("**候选方案甘特图**")
        st.plotly_chart(
            _gantt(selected.schedule),
            key="candidate-gantt",
            width="stretch",
            config={"displayModeBar": False},
        )
    with evidence:
        st.write("**证据与假设**")
        for item in selected.evidence:
            st.write(f"- {item}")
        st.write("**已知假设**")
        for item in selected.assumptions:
            st.caption(item)

    if analyze:
        with st.spinner("正在运行生产计划 Agent、设备资源 Agent 和决策协调 Agent…"):
            try:
                state = run_analysis(
                    baseline,
                    failure,
                    machines,
                    orders,
                    live=live,
                    question=question,
                )
                st.subheader("Agent 分析记录")
                st.write("**生产计划 Agent**")
                st.code(state["plan_report"], language="text")
                st.write("**设备资源 Agent**")
                st.code(state["resource_report"], language="text")
                st.write("**决策协调 Agent**")
                st.code(state["decision_report"], language="text")
            except Exception:
                st.error("分析未完成。请检查模型配置、工具调用支持及 API 连接；排程功能仍可使用。")

    st.subheader("人工确认")
    reason = st.text_input("确认理由（必填）", placeholder="例如：交期优先，接受 M2 换型风险")
    action = st.radio("处理方式", ["暂不发布", "确认发布"], horizontal=True)
    unchanged = action == "确认发布" and selected.metrics.moved_operations == 0
    if unchanged:
        st.caption("该候选与当前计划相同，无需重复发布。")
    if st.button("提交人工决定", disabled=not reason.strip() or unchanged, key="decide"):
        try:
            decision = "publish" if action == "确认发布" else "reject"
            result = store.decide(
                selected,
                failure,
                machines,
                decision,
                reason,
                f"ui-{selected.id}-{baseline.fingerprint}-{selected.event_fingerprint}-{decision}",
            )
            if decision == "publish":
                st.session_state.notice = f"已发布方案，计划版本 {result.version}。"
                st.rerun()
            else:
                st.info("已记录拒绝，当前计划保持不变。")
        except ValueError as exc:
            st.error(str(exc))
    if st.session_state.get("notice"):
        st.success(st.session_state.pop("notice"))
    history = store.history()
    if history:
        st.caption("最近人工决定")
        st.dataframe(pd.DataFrame(history), width="stretch", hide_index=True)


if __name__ == "__main__":
    main()
