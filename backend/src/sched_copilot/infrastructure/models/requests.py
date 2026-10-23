"""SQLAlchemy models for the small insertion-approval demo."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RequestNumberSequence(Base):
    """Technical daily counter; independent of deletable business records."""

    __tablename__ = "request_number_sequences"
    day: Mapped[str] = mapped_column(String(8), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer)


class InsertionRequest(Base):
    __tablename__ = "insertion_requests"
    __table_args__ = (
        CheckConstraint("quantity > 0"),
        CheckConstraint("status IN ('draft','pending_approval','approved','rejected','published')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    submission_key: Mapped[str] = mapped_column(String(100), unique=True)
    payload_fingerprint: Mapped[str] = mapped_column(String(64))
    request_no: Mapped[str] = mapped_column(String(60), unique=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    assigned_planner: Mapped[str] = mapped_column(
        String(100), default="planner_01", server_default="planner_01", index=True
    )
    applicant_role: Mapped[str] = mapped_column(String(32))
    applicant_session_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_id: Mapped[str] = mapped_column(String(100))
    quantity: Mapped[int] = mapped_column(Integer)
    # SQLite stores naive UTC; API responses restore the explicit +00:00 offset.
    earliest_start_at: Mapped[datetime] = mapped_column(DateTime())
    requested_due_at: Mapped[datetime] = mapped_column(DateTime())
    reason: Mapped[str] = mapped_column(Text)
    plan_version: Mapped[int] = mapped_column(Integer)
    plan_fingerprint: Mapped[str] = mapped_column(String(64))
    estimate_json: Mapped[str] = mapped_column(Text)
    assessment_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime())
    updated_at: Mapped[datetime] = mapped_column(DateTime())


class RequestStatusHistory(Base):
    __tablename__ = "request_status_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[str] = mapped_column(ForeignKey("insertion_requests.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32))
    operator_role: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime())


class ApprovalRecord(Base):
    __tablename__ = "approval_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(ForeignKey("insertion_requests.id"), unique=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    approver_role: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime())
