"""Domain snapshot adapter and bounded server-side workflow sessions."""

import json
from collections import OrderedDict
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
from threading import RLock
from uuid import uuid4

from ..agents.contracts import (
    AgentContext,
    EvaluationInput,
    ExplanationInput,
    SchedulingInput,
    ValidationInput,
)
from ..agents.contracts.artifacts import CandidateChanges, CandidateSnapshot
from ..agents.contracts.inputs import ProductionSnapshot
from ..application.contracts import WorkflowOutcome
from ..application.errors import DemoCooldown, InvalidInput, SnapshotConflict
from ..application.telemetry import bind, span
from ..domain.models import CandidatePlan, Schedule, digest
from ..domain.scheduling import metrics
from .orchestrator import DynamicOrchestrator
from .state import WorkflowState


class WorkflowEngine:
    """Bounded memory cache with optional durable sessions and snapshot checks."""

    def __init__(
        self,
        capacity=32,
        production_provider=None,
        orchestrator=None,
        demo_gate=None,
        session_store=None,
        failure_provider=None,
    ):
        self._sessions = OrderedDict()
        self._lock = RLock()
        self._capacity = capacity
        self.orchestrator = orchestrator or DynamicOrchestrator()
        self.production_provider = production_provider or (lambda: None)
        self.demo_gate = demo_gate
        self.session_store = session_store
        self.failure_provider = failure_provider or (lambda: ())

    def invalidate_sessions(self):
        """Discard cached snapshots after a physical fault deletion."""
        with self._lock:
            self._sessions.clear()

    @staticmethod
    def _fingerprint(
        baseline, event, machines, orders, snapshot_time, revision, supplemental, failures=()
    ):
        return sha256(
            json.dumps(
                {
                    "baseline": baseline.fingerprint,
                    "event": digest(event),
                    "revision": revision,
                    "failures": [digest(failure) for failure in failures],
                    "machines": [
                        asdict(m) | {"capabilities": sorted(m.capabilities)} for m in machines
                    ],
                    "orders": [asdict(o) for o in orders],
                    "snapshot_time": snapshot_time,
                    "production_data": supplemental,
                },
                sort_keys=True,
                default=str,
            ).encode()
        ).hexdigest()

    def matches_snapshot(self, payload, baseline, event, machines, orders, snapshot_time, revision):
        failures = self._ordered_failures(event)
        return payload["context"]["input_fingerprint"] == self._fingerprint(
            baseline,
            event,
            machines,
            orders,
            snapshot_time,
            revision,
            self.production_provider(),
            failures,
        )

    def _ordered_failures(self, event):
        """Build the workflow failure list with the active event first.

        The scheduling tool treats the first failure as the event being
        replanned and the remaining entries as independent blocking windows.
        The repository returns windows in history order, which is not
        necessarily the active event (for example after an M2 event is added
        after the seeded M3 event).  Keeping that order leaked a stale event
        into the primary slot and allowed transfers through another outage.
        """
        others = tuple(
            failure for failure in self.failure_provider() if digest(failure) != digest(event)
        )
        return (event, *others)

    def _claim_demo(self):
        if not self.demo_gate.claim():
            raise DemoCooldown("兜底演示冷却中，20 分钟内只能触发一次。可关闭演示后正常生成。")

    def __call__(
        self,
        baseline,
        event,
        machines,
        orders,
        snapshot_time,
        revision,
        *,
        intent,
        question,
        workflow_id=None,
        on_progress=None,
        demo_fallback=False,
        manual_candidate=None,
    ):
        if demo_fallback and (intent != "generate_candidates" or self.demo_gate is None):
            raise InvalidInput("兜底演示仅支持已配置的候选生成流程")
        if demo_fallback and not self.demo_gate.status()["available"]:
            raise DemoCooldown("兜底演示冷却中，20 分钟内只能触发一次。可关闭演示后正常生成。")
        supplemental = self.production_provider()
        failures = self._ordered_failures(event)
        fingerprint = self._fingerprint(
            baseline, event, machines, orders, snapshot_time, revision, supplemental, failures
        )
        context = AgentContext(
            case_id="workbench",
            snapshot_id=fingerprint,
            event_version=revision,
            current_plan_version=str(baseline.version),
            input_fingerprint=fingerprint,
        )
        if intent in {"re_evaluate", "explain"}:
            with self._lock:
                saved = self._sessions.get(workflow_id)
                if saved is None and self.session_store:
                    stored = self.session_store.workflow_session(workflow_id)
                    if stored:
                        saved = WorkflowState.model_validate_json(json.dumps(stored))
                if saved is None:
                    raise InvalidInput("工作流结果不存在或已过期，请先生成方案或执行校验")
                state = saved.model_copy(deep=True)
            if state.context != context:
                raise SnapshotConflict("事件或计划已更新，请重新生成工作流结果")
            if intent == "re_evaluate":
                if not state.scheduling_result or not state.scheduling_result.data:
                    raise InvalidInput("没有可重新评估的候选，请先生成方案")
                state.evaluation_result = None
                state.evaluation_result_ref = None
            state.explanation_result = None
            state.explanation_result_ref = None
            state.explanation_input = state.explanation_input.model_copy(
                update={"question": question}
            )
            state.intent = intent
        else:
            state = self._initial(
                context,
                baseline,
                event,
                machines,
                orders,
                snapshot_time,
                question,
                intent,
                supplemental,
                failures=failures,
            )
        trace_id = f"TRC-{uuid4().hex.upper()}"
        bind(local_trace_id=trace_id, input_fingerprint=fingerprint)
        if on_progress:
            on_progress({"type": "trace_started", "trace_id": trace_id})
        orchestrator = self.orchestrator
        if manual_candidate is not None:
            from ..agents.scheduling_agent import SchedulingAgent

            orchestrator = DynamicOrchestrator(
                validation=orchestrator.validation,
                scheduling=SchedulingAgent.for_manual_candidate(manual_candidate),
                evaluation=orchestrator.evaluation,
                explanation=orchestrator.explanation,
            )
        run = orchestrator.run(
            state,
            **({"on_progress": on_progress} if on_progress else {}),
            **({"fallback_demo": self._claim_demo} if demo_fallback else {}),
        )
        result = run.state
        if self._ordered_failures(event) != failures:
            raise SnapshotConflict("设备故障数据已更新，请重新生成方案")
        if self.production_provider() != supplemental:
            raise SnapshotConflict("生产资源数据已更新，请重新生成方案")
        session_id = str(uuid4())
        with self._lock:
            self._sessions[session_id] = result.model_copy(deep=True)
            while len(self._sessions) > self._capacity:
                self._sessions.popitem(last=False)
        payload = {
            "id": session_id,
            "trace_id": trace_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "intent": intent,
            "status": result.workflow_status,
            "failure_code": result.failure_code,
            "context": context.model_dump(mode="json"),
            "trace": [asdict(t) for t in run.trace],
            "results": {},
            "evidence_catalog": {
                k: e.model_dump(mode="json") for k, e in result.evidence_catalog.items()
            },
        }
        if demo_fallback:
            payload["demo"] = self.demo_gate.status()
        for name in ("validation", "scheduling", "evaluation", "explanation"):
            report = getattr(result, f"{name}_result")
            if report:
                payload["results"][name] = report.model_dump(mode="json")
        candidates = []
        # A failed dependent node must never yield publishable candidates.
        if (
            intent == "generate_candidates"
            and result.workflow_status == "completed"
            and result.scheduling_result
            and result.scheduling_result.data
        ):
            for item in result.scheduling_result.data.candidates:
                raw = result.evidence_catalog[item.plan_ref].content
                plan = CandidateSnapshot.model_validate_json(json.dumps(raw))
                changes = CandidateChanges.model_validate_json(
                    json.dumps(result.evidence_catalog[item.changes_ref].content)
                )
                original = {op.id: op for op in baseline.operations}
                schedule = Schedule(
                    baseline.version + 1,
                    tuple(
                        original[op.operation_id].move_to(op.machine_id, op.start_at)
                        for op in plan.operations
                    ),
                )
                causes = tuple(
                    # Keep all resource causes, including non-fault setup adjustments.
                    (c.operation_id, tuple(c.reason.split("、")))
                    for c in changes.items
                )
                candidates.append(
                    CandidatePlan(
                        item.candidate_id,
                        plan.label,
                        schedule,
                        metrics(schedule, orders, baseline),
                        tuple(item.evidence_refs),
                        tuple(a.text for a in result.scheduling_result.data.assumptions),
                        baseline.fingerprint,
                        digest(event),
                        revision,
                        causes,
                    )
                )
        if self.session_store:
            live = [t for t in payload["trace"] if (t.get("execution") or {}).get("mode") == "live"]
            payload["contribution_report"] = {
                "title": "分析工作与人工贡献",
                "rules_work": "规则系统按实际完成节点提供数据校验、候选生成、指标与风险计算；"
                "失败与未检查项见链路记录。",
                "model_work": "大模型完成证据重点选择与解释组织；各节点模式与降级见链路记录。"
                if live
                else "本次使用规则分析，未完成大模型总结。",
                "manual_summary": "尚未进行人工排程调整或采纳决策。",
                "edits": [],
                "risks": [],
                "decision": "分析完成不代表审批通过或计划已发布。",
            }
            # Manual runs belong to their durable draft, leaving the original AI run recoverable.
            if manual_candidate is None:
                with span("saving"):
                    self.session_store.record_workflow(payload, result.model_dump(mode="json"))
        return WorkflowOutcome(payload, tuple(candidates))

    @staticmethod
    def _initial(
        context,
        baseline,
        event,
        machines,
        orders,
        snapshot_time,
        question,
        intent,
        supplemental=None,
        failures=(),
    ):
        common = {"context": context, "evidence_catalog": {}}
        validation = ValidationInput.model_validate(
            {
                **common,
                "agent_name": "validation",
                "intent": intent,
                "validation_tool_result": None,
                "case_data": {
                    "report_snapshot_at": snapshot_time,
                    "wip_policy": None,
                    "orders": [
                        {"order_id": o.id, "due_at": o.due, "priority": o.priority} for o in orders
                    ],
                    "machines": [
                        {
                            "machine_id": m.id,
                            "capabilities": sorted(m.capabilities),
                            "available": True,
                        }
                        for m in machines
                    ],
                    "molds": supplemental["molds"] if supplemental else [],
                    "production": ProductionSnapshot.model_validate_json(
                        json.dumps(supplemental["production"])
                    )
                    if supplemental
                    else None,
                    "operations": [
                        {
                            "operation_id": o.id,
                            "order_id": o.order_id,
                            "sequence": o.sequence,
                            "machine_id": o.machine_id,
                            "mold_id": supplemental["operation_molds"].get(o.id)
                            if supplemental
                            else None,
                            "capability": o.capability,
                            "start_at": o.start,
                            "duration_minutes": o.duration_minutes,
                            "status": o.status.value,
                        }
                        for o in baseline.operations
                    ],
                    "failures": [
                        {
                            "event_id": f"event:{index}",
                            "machine_id": item.machine_id,
                            "started_at": item.started_at,
                            "estimated_recovery_at": item.recovered_at,
                            "received_at": item.received_at,
                            "source": item.source,
                        }
                        for index, item in enumerate(failures or (event,))
                    ],
                },
            }
        )
        return WorkflowState(
            context=context,
            intent=intent,
            evidence_catalog={},
            validation_input=validation,
            scheduling_input=SchedulingInput(
                **common,
                agent_name="scheduling",
                validation_result_ref="pending",
                current_plan_ref="pending",
                user_constraints=[],
                allowed_strategies=[
                    {"strategy_id": s, "description": s, "parameters": {}}
                    for s in ("wait-recovery", "allow-transfer")
                ],
                wip_policy=None,
                scheduling_tool_result=None,
            ),
            evaluation_input=EvaluationInput(
                **common,
                agent_name="evaluation",
                current_plan_ref="pending",
                candidate_batch_id="pending",
                candidate_refs={},
                evaluation_criteria_ref=None,
                evaluation_tool_result=None,
            ),
            explanation_input=ExplanationInput(
                **common,
                agent_name="explanation",
                question=question,
                validation_result_ref=None,
                candidate_batch_ref=None,
                evaluation_result_ref=None,
                assumptions=[],
            ),
        )
