"""Domain snapshot adapter and bounded server-side workflow sessions."""

import json
from collections import OrderedDict
from dataclasses import asdict
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
from ..application.errors import InvalidInput, SnapshotConflict
from ..domain.models import CandidatePlan, Schedule, digest
from ..domain.scheduling import metrics
from .orchestrator import DynamicOrchestrator
from .state import WorkflowState


class WorkflowEngine:
    """Sessions expire on restart/eviction; snapshot checks prevent stale reuse."""

    def __init__(self, capacity=32, production_provider=None, orchestrator=None):
        self._sessions = OrderedDict()
        self._lock = RLock()
        self._capacity = capacity
        self.orchestrator = orchestrator or DynamicOrchestrator()
        self.production_provider = production_provider or (lambda: None)

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
    ):
        supplemental = self.production_provider()
        fingerprint = sha256(
            json.dumps(
                {
                    "baseline": baseline.fingerprint,
                    "event": digest(event),
                    "revision": revision,
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
            )
        run = self.orchestrator.run(state, **({"on_progress": on_progress} if on_progress else {}))
        result = run.state
        if self.production_provider() != supplemental:
            raise SnapshotConflict("生产资源数据已更新，请重新生成方案")
        session_id = str(uuid4())
        with self._lock:
            self._sessions[session_id] = result.model_copy(deep=True)
            while len(self._sessions) > self._capacity:
                self._sessions.popitem(last=False)
        payload = {
            "id": session_id,
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
                            "event_id": f"event:{context.event_version}",
                            "machine_id": event.machine_id,
                            "started_at": event.started_at,
                            "estimated_recovery_at": event.recovered_at,
                            "received_at": event.received_at,
                            "source": event.source,
                        }
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
