"""Composition adapters: instrument calls without logging arguments or responses."""

from .application.telemetry import span
from .infrastructure.telemetry import TraceExporter, TraceStore


def build_telemetry(settings):
    store = TraceStore(settings.database_path)
    return TraceExporter(
        store,
        enabled=settings.tracing_enabled,
        api_key=settings.langsmith_api_key,
        project=settings.langsmith_project,
        endpoint=settings.langsmith_endpoint,
    )


class ModelProbe:
    def __init__(self, model, name=None):
        self.model, self.name = model, name

    def __getattr__(self, key):
        return getattr(self.model, key)

    def bind_tools(self, *args, **kwargs):
        return ModelProbe(self.model.bind_tools(*args, **kwargs), self.name)

    def invoke(self, *args, **kwargs):
        from langsmith import tracing_context

        with span("model_call", "llm") as node, tracing_context(enabled=False):
            node["model"] = self.name
            result = self.model.invoke(*args, **kwargs)
            usage = getattr(result, "usage_metadata", None) or {}
            for key in ("input_tokens", "output_tokens"):
                if isinstance(usage.get(key), int):
                    node[key] = usage[key]
            return result


class RuleProbe:
    def __init__(self, agent, name):
        self.agent, self.name = agent, name

    def __getattr__(self, key):
        return getattr(self.agent, key)

    def run(self, *args, **kwargs):
        with span(self.name + "_tool", "tool") as node:
            result = self.agent.run(*args, **kwargs)
            node["status"] = result.result.status
            return result
