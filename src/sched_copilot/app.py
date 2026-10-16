"""Local workbench: edit event -> inspect impact -> simulate -> human decision."""

from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

from .agents import run_analysis
from .domain import MachineFailure, digest
from .impact import operation_changes, order_impacts
from .scenario import BASE_TIME, EVENT_TIME, demo_machines, demo_orders, demo_schedule
from .scheduling import affected_operations, failure_issues, generate_candidates, overlaps
from .storage import DecisionStore

EDITOR_KEYS = (
    "failure_machine",
    "failure_date",
    "failure_start",
    "recovery_unknown",
    "recovery_date",
    "failure_recovery",
    "failure_source",
    "editor_revision",
)


def _local(value):
    return value.astimezone(BASE_TIME.tzinfo).replace(tzinfo=None)


def _table(rows):
    return pd.DataFrame(
        [
            {
                key: _local(value).strftime("%m-%d %H:%M") if isinstance(value, datetime) else value
                for key, value in row.items()
            }
            for row in rows
        ]
    )


def _frame(schedule):
    return pd.DataFrame(
        [
            {
                "任务": op.id,
                "订单": op.order_id,
                "设备": op.machine_id,
                "开始": _local(op.start),
                "结束": _local(op.end),
                "状态": op.status.value,
            }
            for op in schedule.operations
        ]
    )


def _gantt(schedule, failure=None):
    fig = px.timeline(
        _frame(schedule),
        x_start="开始",
        x_end="结束",
        y="设备",
        color="订单",
        hover_data=["任务", "状态"],
        height=400,
    )
    machine_ids = sorted({op.machine_id for op in schedule.operations})
    if failure and failure.machine_id not in machine_ids:
        machine_ids.append(failure.machine_id)
    fig.update_yaxes(
        autorange="reversed", title=None, categoryorder="array", categoryarray=machine_ids
    )
    fig.update_layout(
        margin=dict(l=8, r=8, t=35, b=8), legend_title_text="订单", xaxis_title="时间（UTC+08:00）"
    )
    if failure:
        row = machine_ids.index(failure.machine_id)
        end = failure.recovered_at or max(
            max(op.end for op in schedule.operations),
            failure.started_at + timedelta(hours=4),
        )
        fig.add_shape(
            type="rect",
            xref="x",
            yref="y",
            x0=_local(failure.started_at),
            x1=_local(end),
            y0=row - 0.4,
            y1=row + 0.4,
            fillcolor="#C75439",
            opacity=0.22,
            line=dict(color="#C75439", width=1),
            layer="below",
        )
        fig.add_annotation(
            x=_local(failure.started_at),
            y=row,
            text=("故障 · 恢复未知" if failure.recovered_at is None else "故障窗口"),
            showarrow=False,
            yshift=23,
            font=dict(color="#A9432D"),
        )
    return fig


def _reload_editor():
    for key in EDITOR_KEYS:
        st.session_state.pop(key, None)


def _recover_event(store, machines, orders):
    example = MachineFailure(
        "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "计划员手动录入", EVENT_TIME
    )
    try:
        store.recover_event(machines, orders, example)
        _reload_editor()
        for key in ("candidates", "reports", "report_token", "reason", "analysis_token"):
            st.session_state.pop(key, None)
        st.session_state.notice = (
            "已恢复可试算事件。正式计划与历史记录均保留，点击“生成候选方案”继续。"
        )
    except ValueError as exc:
        st.session_state.recovery_error = str(exc)


def _event_editor(store, machines, orders, active, revision):
    st.sidebar.header("设备故障事件")
    with st.sidebar:
        st.caption("仿真快照：10-19 13:00，UTC+08:00。当前仅编辑一条故障事件，切换设备会替换事件。")
        st.button("重新载入已保存事件", on_click=_reload_editor, key="reload_event")
        st.button(
            "恢复上次可试算事件",
            key="recover_event",
            on_click=_recover_event,
            args=(store, machines, orders),
            help="恢复最近一个满足当前执行记录的事件；无可用历史时尝试初始示例。保留正式计划和全部历史。",
        )
        if st.session_state.get("recovery_error"):
            st.error(st.session_state.pop("recovery_error"))
        st.session_state.setdefault("editor_revision", revision)
        stale = st.session_state.editor_revision != revision
        ids = [machine.id for machine in machines]
        machine_id = st.selectbox(
            "故障设备", ids, index=ids.index(active.machine_id), key="failure_machine"
        )
        event_date = st.date_input("发生日期", active.started_at.date(), key="failure_date")
        event_time = st.time_input("发生时间", active.started_at.time(), key="failure_start")
        unknown = st.checkbox(
            "恢复时间未知", value=active.recovered_at is None, key="recovery_unknown"
        )
        recovery = active.recovered_at or active.started_at + timedelta(hours=4)
        recovery_date, recovery_time = recovery.date(), recovery.time()
        if unknown:
            st.info("预计恢复时间：未提供。已有时间不参与本次事件，补充时间后才能试算。")
        else:
            recovery_date = st.date_input("预计恢复日期", recovery.date(), key="recovery_date")
            recovery_time = st.time_input("预计恢复时间", recovery.time(), key="failure_recovery")
        source = st.text_input("事件来源", active.source, key="failure_source")
        draft, error = None, None
        try:
            start = datetime.combine(event_date, event_time, tzinfo=BASE_TIME.tzinfo)
            end = (
                None
                if unknown
                else datetime.combine(
                    recovery_date,
                    recovery_time,
                    tzinfo=BASE_TIME.tzinfo,
                )
            )
            # Synthetic receipt time is stable, so a repaint is not a new event.
            draft = MachineFailure(machine_id, start, end, source.strip(), max(EVENT_TIME, start))
        except ValueError as exc:
            error = str(exc)
            st.error(error)
        dirty = draft is None or (
            draft.machine_id,
            draft.started_at,
            draft.recovered_at,
            draft.source,
        ) != (active.machine_id, active.started_at, active.recovered_at, active.source)
        if stale:
            st.warning("事件已在其他页面更新，请先重新载入，避免覆盖他人的修改。")
        if st.button("保存故障事件", key="save_event", disabled=error is not None or stale):
            try:
                st.session_state.editor_revision = store.record_event(
                    draft,
                    expected_revision=st.session_state.editor_revision,
                )
                st.session_state.notice = "故障事件已保存，旧候选已失效；正式计划未改变。"
                st.rerun()
            except ValueError as exc:
                st.error(str(exc))
        if dirty:
            st.info("事件输入已修改。请先保存，再重新生成候选方案；当前不能发布旧方案。")
        if not unknown and draft is not None:
            st.caption(
                f"当前输入的预计恢复：{draft.recovered_at:%m-%d %H:%M}（人工估计）。"
                "如暂时无法估计，请勾选“恢复时间未知”，不必手动清空时间框。"
            )
    return dirty or stale


def _history(store):
    history = store.history()
    if history:
        with st.expander("人工决定记录"):
            st.dataframe(pd.DataFrame(history), width="stretch", hide_index=True)


def main():
    st.set_page_config(page_title="Schedule Copilot", page_icon="SC", layout="wide")
    st.title("Schedule Copilot")
    st.caption("生产计划员的排产辅助决策工作台 · 仿真案例 · 计划发布由人确认")
    machines, orders = demo_machines(), demo_orders()
    store = DecisionStore(Path(".data/decisions.sqlite3"), demo_schedule())
    baseline = store.current()
    if store.active_event() is None:
        example = MachineFailure(
            "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "计划员手动录入", EVENT_TIME
        )
        try:
            store.record_event(example, expected_revision=0)
        except ValueError:
            pass  # Another local session initialized the event first.
    failure, revision = store.active_event()
    dirty = _event_editor(store, machines, orders, failure, revision)
    token = (baseline.fingerprint, revision)
    if dirty or st.session_state.get("analysis_token") != token:
        for key in ("candidates", "reports", "report_token", "reason"):
            st.session_state.pop(key, None)
    st.session_state.analysis_token = token
    if st.session_state.get("notice"):
        st.success(st.session_state.pop("notice"))

    affected = affected_operations(baseline, failure)
    left, middle, right = st.columns(3)
    left.metric("直接受影响工序" if failure.recovered_at else "潜在受影响工序", len(affected))
    middle.metric("当前计划版本", baseline.version)
    right.metric("事件版本", revision)
    st.caption(
        f"已保存事件：{failure.machine_id} · 来源：{failure.source} · "
        f"仿真接收时间：{failure.received_at:%m-%d %H:%M}"
    )
    st.plotly_chart(
        _gantt(baseline, failure),
        key="current-gantt",
        width="stretch",
        config={"displayModeBar": False},
    )
    if affected:
        st.subheader("直接影响范围" if failure.recovered_at else "潜在风险范围")
        st.dataframe(
            _table(
                [
                    {
                        "工序": op.id,
                        "订单": op.order_id,
                        "设备": op.machine_id,
                        "原开始": op.start,
                        "原结束": op.end,
                        "依据": f"加工时段与 {failure.machine_id} 故障窗口重叠"
                        if failure.recovered_at
                        else "恢复未知，故障后原设备任务仅列为潜在风险",
                    }
                    for op in affected
                ]
            ),
            width="stretch",
            hide_index=True,
        )
    else:
        st.info("无直接影响：已保存故障窗口未覆盖任何待加工工序。")

    issues = failure_issues(baseline, failure, machines)
    for issue in issues:
        st.error(issue)
    if issues:
        st.warning(
            "当前事件已保存，但与执行记录冲突，暂不能生成方案比较。"
            "本案例是10月19日13:00的固定报工快照，修改故障时间不会回退或推进工序状态。"
            "可点击左侧“恢复上次可试算事件”继续，或手动修正后保存。"
            "若要模拟加工中故障，需要先定义在制品处置规则。"
        )
        conflicts = [
            op
            for op in baseline.operations
            if op.machine_id == failure.machine_id
            and op.status.value != "planned"
            and overlaps(
                op.start,
                op.end,
                failure.started_at,
                failure.recovered_at or max(op.end, failure.started_at + timedelta(minutes=1)),
            )
        ]
        if conflicts:
            st.dataframe(
                _table(
                    [
                        {
                            "冲突工序": op.id,
                            "设备": op.machine_id,
                            "执行记录开始": op.start,
                            "执行记录结束": op.end,
                            "执行状态": "已完成" if op.status.value == "completed" else "加工中",
                        }
                        for op in conflicts
                    ]
                ),
                width="stretch",
                hide_index=True,
            )
        if baseline == demo_schedule():
            st.info(
                "初始快照可试：M1，10月19日13:00—17:00。"
                "在左侧保存后，重新点击“生成候选方案”。这会替换当前单条事件，正式计划不变。"
            )
    if failure.recovered_at is None:
        st.warning("请补充预计恢复时间。红色区域延伸只表示恢复未知，不代表实际停机时长。")
    blockers = []
    if dirty:
        blockers.append("输入尚未保存，或编辑版本已过期，请保存或重新载入事件")
    if issues:
        blockers.extend(issues)
    if failure.recovered_at is None:
        blockers.append("已保存事件的预计恢复时间未知，请取消勾选、填写时间并保存")
    if blockers:
        st.write("**暂不能生成方案比较，原因：**")
        for blocker in blockers:
            st.write(f"- {blocker}")
    else:
        st.caption(
            f"已保存预计恢复时间：{failure.recovered_at:%m-%d %H:%M}。"
            "输入校验通过，可以生成候选方案。"
        )
    if st.button(
        "生成候选方案",
        key="generate",
        type="primary",
        disabled=dirty or bool(issues) or failure.recovered_at is None,
    ):
        try:
            st.session_state.candidates = generate_candidates(
                baseline,
                failure,
                machines,
                orders,
                event_revision=revision,
            )
            st.session_state.pop("reports", None)
        except ValueError as exc:
            st.error(str(exc))
    candidates = st.session_state.get("candidates")
    if not candidates or dirty or issues or failure.recovered_at is None:
        if not issues:
            st.caption("保存事件后点击“生成候选方案”。正式计划只在人工确认发布后改变。")
        _history(store)
        return

    st.subheader("方案比较")
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "方案": item.label,
                    "延期订单": item.metrics.late_orders,
                    "累计延期(分钟)": item.metrics.total_lateness_minutes,
                    "移动工序": item.metrics.moved_operations,
                    "计划完工": item.metrics.makespan.strftime("%m-%d %H:%M"),
                }
                for item in candidates
            ]
        ),
        width="stretch",
        hide_index=True,
    )
    label = st.selectbox("查看候选方案", [item.label for item in candidates], key="candidate")
    selected = next(item for item in candidates if item.label == label)
    st.plotly_chart(
        _gantt(selected.schedule, failure),
        key="candidate-gantt",
        width="stretch",
        config={"displayModeBar": False},
    )
    changes = operation_changes(baseline, selected, failure)
    st.subheader("工序变化与影响链")
    if changes:
        st.dataframe(_table(changes), width="stretch", hide_index=True)
        st.caption("影响链来自求解过程中的前序等待、设备占用及故障约束；策略调整单独标记。")
    else:
        st.info("该候选没有改变任何工序。")
    st.subheader("订单交付影响")
    st.dataframe(
        _table(order_impacts(baseline, selected, orders)), width="stretch", hide_index=True
    )
    with st.expander("证据与假设"):
        for item in (*selected.evidence, *selected.assumptions):
            st.write(f"- {item}")

    with st.expander("AI 辅助分析"):
        live = st.toggle("启用 API 多 Agent", value=False, key="live")
        question = st.text_area("向 Copilot 提问", "设备故障后，应该如何比较方案？", key="question")
        report_token = (token, live, question)
        if st.button("运行分析", key="analyze"):
            with st.spinner("正在分析交付、资源和方案取舍…"):
                try:
                    reports = run_analysis(
                        baseline, failure, machines, orders, live=live, question=question
                    )
                    if (
                        store.active_event()[1] == revision
                        and store.current().fingerprint == token[0]
                    ):
                        st.session_state.reports = reports
                        st.session_state.report_token = report_token
                    else:
                        st.warning("分析期间事件或计划已更新，请重新生成候选。")
                except Exception:
                    st.error("分析未完成，请检查模型配置与 API 连接；排程功能仍可使用。")
        if st.session_state.get("report_token") == report_token:
            for role, report in st.session_state.get("reports", {}).items():
                st.write(
                    {
                        "plan_report": "生产计划分析",
                        "resource_report": "设备资源分析",
                        "decision_report": "方案协调结论",
                    }.get(role, role)
                )
                st.code(report, language="text")

    st.subheader("人工确认")
    reason = st.text_input("确认理由（必填）", key="reason", placeholder="说明接受的代价与选择理由")
    action = st.radio("处理方式", ["暂不发布", "确认发布"], horizontal=True, key="action")
    unchanged = action == "确认发布" and selected.metrics.moved_operations == 0
    if unchanged:
        st.caption("该候选与当前计划相同，无需重复发布。")
    if st.button("提交人工决定", disabled=not reason.strip() or unchanged, key="decide"):
        try:
            decision = "publish" if action == "确认发布" else "reject"
            result = store.decide(
                selected, failure, machines, decision, reason, f"ui-{digest(selected)}-{decision}"
            )
            if decision == "publish":
                st.session_state.notice = f"已发布方案，计划版本 {result.version}。"
                st.rerun()
            else:
                st.info("已记录拒绝，当前计划保持不变。")
        except ValueError as exc:
            st.error(str(exc))
    _history(store)


if __name__ == "__main__":
    main()
