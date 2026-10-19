"""Composition root: wire concrete adapters into application ports."""

import os
from datetime import timedelta
from functools import lru_cache

from .agents.evaluation_agent import EvaluationAgent
from .agents.explanation_agent import ExplanationAgent
from .agents.live_agent import LiveAgent
from .agents.scheduling_agent import SchedulingAgent
from .agents.validation_agent import ValidationAgent
from .agents.workflow import run_analysis
from .application.workbench import WorkbenchService
from .config import Settings
from .domain.models import MachineFailure
from .infrastructure.fallback_demo import FallbackDemoGate
from .infrastructure.sqlite_repository import DecisionStore
from .orchestration.engine import WorkflowEngine
from .orchestration.orchestrator import DynamicOrchestrator
from .scenarios.demo import EVENT_TIME, demo_machines, demo_orders, demo_schedule


def build_workbench(settings: Settings) -> WorkbenchService:
    store = DecisionStore(settings.database_path, demo_schedule())
    service = WorkbenchService(
        store,
        demo_machines(),
        demo_orders(),
        EVENT_TIME,
        MachineFailure(
            "M1", EVENT_TIME, EVENT_TIME + timedelta(hours=4), "计划员手动录入", EVENT_TIME
        ),
        run_analysis,
        WorkflowEngine(
            production_provider=store.production_snapshot,
            orchestrator=build_orchestrator(settings),
            demo_gate=FallbackDemoGate(settings.database_path),
        ),
    )
    service.initialize()
    return service


def build_orchestrator(settings: Settings, model_factory=None) -> DynamicOrchestrator:
    """Only the composition root reads provider configuration; secrets stay server-side."""
    enabled = settings.workflow_model_mode == "live" or (
        settings.workflow_model_mode == "auto" and settings.llm_configured
    )
    if not enabled:
        return DynamicOrchestrator()

    @lru_cache(maxsize=1)
    def create_model():
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=os.environ["LLM_MODEL"],
            api_key=os.environ["LLM_API_KEY"],
            base_url=os.getenv("LLM_BASE_URL") or None,
            use_responses_api=settings.llm_api_type == "responses",
            max_tokens=4096,
            timeout=settings.llm_timeout_seconds,
            max_retries=0,
        )

    unavailable = None if settings.llm_configured or model_factory else "MODEL_NOT_CONFIGURED"
    agents = {
        name: LiveAgent(
            name,
            agent(),
            model_factory or create_model,
            os.getenv("LLM_MODEL") or None,
            unavailable_code=unavailable,
        )
        for name, agent in (
            ("validation", ValidationAgent),
            ("scheduling", SchedulingAgent),
            ("evaluation", EvaluationAgent),
            ("explanation", ExplanationAgent),
        )
    }
    return DynamicOrchestrator(**agents)


def build_sales(settings: Settings):
    from .application.sales import SalesService
    from .application.sales_requests import SalesRequestService
    from .infrastructure.insertion_repository import InsertionStore
    from .orchestration.insertion import InsertionWorkflow
    from .scenarios.insertion_demo import demo_routes, insertion_resources
    from .scenarios.sales_catalog import demo_products

    sales = SalesService(demo_products())
    return sales, SalesRequestService(
        InsertionStore(settings.database_path),
        sales,
        demo_routes(),
        insertion_resources,
        InsertionWorkflow(),
    )
