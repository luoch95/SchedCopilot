"""SQLAlchemy adapter: atomically persist request, approval and status history."""

import json
from datetime import datetime, timezone
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import URL, create_engine, event, select, text
from sqlalchemy.orm import sessionmaker

from ..domain.errors import RuleViolation
from .models.requests import ApprovalRecord, Base, InsertionRequest, RequestStatusHistory
from .serialization import parse_schedule, schedule_json


class InsertionStore:
    def __init__(self, database_path):
        self.engine = create_engine(
            URL.create("sqlite", database=str(database_path)),
            connect_args={"check_same_thread": False, "timeout": 10},
        )

        @event.listens_for(self.engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

    def submission(self, key, fingerprint):
        with self.sessions() as session:
            row = session.scalar(
                select(InsertionRequest).where(InsertionRequest.submission_key == key)
            )
            if row is None:
                return None
            if row.payload_fingerprint != fingerprint:
                raise RuleViolation("提交标识已被其他申请内容使用")
            return self._full_view(session, row)

    def submit(self, values, key, fingerprint, estimate, plan_version, plan_fingerprint):
        # Serialize writes and check idempotency inside the transaction as well.
        with self.sessions() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            existing = session.scalar(
                select(InsertionRequest).where(InsertionRequest.submission_key == key)
            )
            if existing:
                if existing.payload_fingerprint != fingerprint:
                    raise RuleViolation("提交标识已被其他申请内容使用")
                return self._full_view(session, existing)
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            request_id = str(uuid4())
            data = dict(values)
            for field in ("earliest_start_at", "requested_due_at"):
                data[field] = data[field].astimezone(timezone.utc).replace(tzinfo=None)
            row = InsertionRequest(
                **data,
                id=request_id,
                request_no=f"URG-{now:%Y%m%d}-{request_id.upper()}",
                submission_key=key,
                payload_fingerprint=fingerprint,
                status="draft",
                applicant_role="sales",
                plan_version=plan_version,
                plan_fingerprint=plan_fingerprint,
                estimate_json=json.dumps(estimate, ensure_ascii=False),
                assessment_json=None,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            row.status = "pending_approval"
            session.add(
                RequestStatusHistory(
                    request_id=request_id,
                    from_status="draft",
                    to_status="pending_approval",
                    operator_role="sales",
                    comment="业务员提交审批；尚未试排",
                    created_at=now,
                )
            )
            session.add(
                ApprovalRecord(
                    id=str(uuid4()),
                    request_id=request_id,
                    status="pending",
                    approver_role="leader",
                    comment=None,
                    created_at=now,
                )
            )
            session.commit()
            return self._full_view(session, row)

    def pending(self):
        return self.records("pending_approval")

    def records(self, status=None):
        with self.sessions() as session:
            query = select(InsertionRequest)
            if status:
                query = query.where(InsertionRequest.status == status)
            rows = session.scalars(
                query.order_by(InsertionRequest.created_at.desc(), InsertionRequest.id)
            ).all()
            return [self._full_view(session, row) for row in rows]

    def get(self, request_id):
        with self.sessions() as session:
            row = session.get(InsertionRequest, request_id)
            return self._full_view(session, row) if row else None

    def save_assessment(self, request_id, result):
        with self.sessions() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            baseline = parse_schedule(
                session.execute(text("SELECT payload FROM current_plan WHERE id=1")).scalar_one()
            )
            revision = session.execute(text("SELECT MAX(revision) FROM event_history")).scalar_one()
            if (
                baseline.fingerprint != result["baseline_fingerprint"]
                or revision != result["event_revision"]
            ):
                raise RuleViolation("试排期间计划或事件变化，请刷新后重试")
            production = session.execute(
                text("SELECT payload FROM production_inputs WHERE id=1")
            ).scalar_one_or_none()
            signature = sha256(
                json.dumps(
                    json.loads(production) if production else None,
                    sort_keys=True,
                    ensure_ascii=False,
                ).encode()
            ).hexdigest()
            if signature != result["production_inputs_fingerprint"]:
                raise RuleViolation("试排期间生产资源变化，请刷新后重试")
            row = session.get(InsertionRequest, request_id)
            if row is None:
                raise RuleViolation("插单申请已不存在")
            if row.status not in {"pending_approval", "approved"}:
                raise RuleViolation("当前申请状态不允许试排")
            if row.status == "approved":
                self._status(
                    session, row, "pending_approval", "system", "重新试排，旧审批失效，须重新审批"
                )
            approval = session.scalar(
                select(ApprovalRecord).where(ApprovalRecord.request_id == request_id)
            )
            approval.status = "pending"
            approval.comment = None
            result["assessment_id"] = str(uuid4())
            row.assessment_json = json.dumps(result, ensure_ascii=False)
            row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            session.commit()

    @staticmethod
    def _fresh(session, result):
        baseline = parse_schedule(
            session.execute(text("SELECT payload FROM current_plan WHERE id=1")).scalar_one()
        )
        revision = session.execute(text("SELECT MAX(revision) FROM event_history")).scalar_one()
        production = session.execute(
            text("SELECT payload FROM production_inputs WHERE id=1")
        ).scalar_one_or_none()
        signature = sha256(
            json.dumps(
                json.loads(production) if production else None, sort_keys=True, ensure_ascii=False
            ).encode()
        ).hexdigest()
        if (
            baseline.fingerprint != result["baseline_fingerprint"]
            or revision != result["event_revision"]
            or signature != result["production_inputs_fingerprint"]
        ):
            raise RuleViolation("计划、事件或生产资源已变化，请重新试排并审批")
        return baseline

    @staticmethod
    def _status(session, row, target, role, reason):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        session.add(
            RequestStatusHistory(
                request_id=row.id,
                from_status=row.status,
                to_status=target,
                operator_role=role,
                comment=reason,
                created_at=now,
            )
        )
        row.status = target
        row.updated_at = now

    def transition(self, request_id, action, reason, assessment_id, schedule=None, production=None):
        targets = {"approve": "approved", "reject": "rejected", "publish": "published"}
        if action not in targets:
            raise RuleViolation("无效插单操作")
        with self.sessions() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            row = session.get(InsertionRequest, request_id)
            if row is None:
                raise RuleViolation("插单申请不存在")
            result = json.loads(row.assessment_json) if row.assessment_json else None
            approval = session.scalar(
                select(ApprovalRecord).where(ApprovalRecord.request_id == request_id)
            )
            binding = json.loads(approval.comment) if approval.comment else {}
            # Exact repeat returns the existing state even after publication changed the baseline.
            if (
                row.status == targets[action]
                and result
                and result.get("assessment_id") == assessment_id
            ):
                return self._full_view(session, row)
            if action == "reject" and row.status == "rejected" and not assessment_id:
                return self._full_view(session, row)
            if row.status != ("approved" if action == "publish" else "pending_approval"):
                raise RuleViolation("申请状态已变化，请刷新后操作")
            if action == "reject" and result and result.get("assessment_id") != assessment_id:
                raise RuleViolation("试排结果已更新，请刷新后重新审批")
            if action != "reject":
                if not result or not assessment_id or result.get("assessment_id") != assessment_id:
                    raise RuleViolation("审批必须绑定当前试排结果，请刷新后重试")
                baseline = self._fresh(session, result)
                fingerprint = sha256(row.assessment_json.encode()).hexdigest()
                if action == "publish":
                    if approval.status != "approved" or binding.get("fingerprint") != fingerprint:
                        raise RuleViolation("试排结果未被批准，请重新审批")
                    if schedule is None or schedule.version != baseline.version + 1:
                        raise RuleViolation("发布计划未通过复核")
                    session.execute(
                        text("UPDATE current_plan SET payload=:payload WHERE id=1"),
                        {"payload": schedule_json(schedule)},
                    )
                    session.execute(
                        text(
                            "INSERT INTO production_inputs(id,payload) VALUES(1,:p) "
                            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload"
                        ),
                        {"p": json.dumps(production, ensure_ascii=False)},
                    )
                    session.execute(
                        text(
                            "INSERT INTO decisions "
                            "(request_id,action,candidate,reason,created_at,result,evidence) "
                            "VALUES(:id,'publish',:candidate,:reason,:at,:result,:evidence)"
                        ),
                        dict(
                            id=f"insertion:{request_id}",
                            candidate=fingerprint,
                            reason=reason,
                            at=datetime.now(timezone.utc).isoformat(),
                            result=schedule_json(schedule),
                            evidence=json.dumps(
                                dict(insertion_request_id=request_id, assessment=result),
                                ensure_ascii=False,
                            ),
                        ),
                    )
                else:
                    approval.status = "approved"
                    approval.comment = json.dumps(
                        dict(reason=reason, fingerprint=fingerprint, assessment_id=assessment_id),
                        ensure_ascii=False,
                    )
            else:
                approval.status = "rejected"
                approval.comment = json.dumps(dict(reason=reason), ensure_ascii=False)
            self._status(
                session,
                row,
                targets[action],
                "planner" if action == "publish" else "leader",
                reason,
            )
            session.flush()
            view = self._full_view(session, row)
            session.commit()
            return view

    def _full_view(self, session, row):
        view = self._view(row)
        approval = session.scalar(select(ApprovalRecord).where(ApprovalRecord.request_id == row.id))
        view["approval"] = (
            dict(
                status=approval.status, **(json.loads(approval.comment) if approval.comment else {})
            )
            if approval
            else None
        )
        history = session.scalars(
            select(RequestStatusHistory)
            .where(RequestStatusHistory.request_id == row.id)
            .order_by(RequestStatusHistory.id)
        ).all()
        view["status_history"] = [
            dict(
                from_status=h.from_status,
                to_status=h.to_status,
                operator_role=h.operator_role,
                comment=h.comment,
                created_at=h.created_at.replace(tzinfo=timezone.utc).isoformat(),
            )
            for h in history
        ]
        return view

    @staticmethod
    def _view(row):
        def utc(value):
            return value.replace(tzinfo=timezone.utc).isoformat()

        return dict(
            id=row.id,
            request_no=row.request_no,
            status=row.status,
            product_id=row.product_id,
            quantity=row.quantity,
            earliest_start_at=utc(row.earliest_start_at),
            requested_due_at=utc(row.requested_due_at),
            reason=row.reason,
            plan_version=row.plan_version,
            estimate=json.loads(row.estimate_json),
            assessment=json.loads(row.assessment_json) if row.assessment_json else None,
            created_at=utc(row.created_at),
        )
