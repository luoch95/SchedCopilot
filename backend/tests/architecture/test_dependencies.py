"""Guard dependency direction so feature growth cannot silently collapse the layers."""

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[2] / "src" / "sched_copilot"
ALLOWED = {
    "domain": {"domain"},
    "application": {"application", "domain"},
    "infrastructure": {"infrastructure", "domain"},
    "agents": {"agents", "domain", "prompts", "tools"},
    "tools": {"tools", "domain", "agents"},
    "prompts": {"prompts"},
    "scenarios": {"scenarios", "domain"},
    "orchestration": {"orchestration", "agents", "domain", "application"},
}


def imported_modules(path):
    relative = path.relative_to(PACKAGE)
    package = ".".join(("sched_copilot", *relative.parent.parts))
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            yield (
                importlib.util.resolve_name("." * node.level + (node.module or ""), package)
                if node.level
                else node.module or ""
            )


@pytest.mark.parametrize("layer", ALLOWED)
def test_backend_layer_dependencies(layer):
    for path in (PACKAGE / layer).rglob("*.py"):
        for module in imported_modules(path):
            if module.startswith("sched_copilot."):
                dependency = module.split(".")[1]
                assert dependency in ALLOWED[layer], (
                    f"{path.name}: {layer} must not import {module}"
                )
            elif layer in {"domain", "application", "scenarios", "prompts"}:
                assert module.split(".")[0] in sys.stdlib_module_names, (
                    f"{path.name}: framework dependency {module} is not allowed in {layer}"
                )


def test_routes_do_not_access_business_engines_or_database_adapters():
    for module in imported_modules(PACKAGE / "api" / "routes.py"):
        assert not module.startswith(("sched_copilot.infrastructure", "sched_copilot.domain"))
        assert module.split(".")[0] != "sqlite3"


def test_only_infrastructure_can_import_database_drivers():
    for path in PACKAGE.rglob("*.py"):
        if "infrastructure" in path.relative_to(PACKAGE).parts:
            continue
        assert not any(module.startswith("sqlite3") for module in imported_modules(path)), path


def test_tools_can_import_agent_contracts_but_not_agent_execution():
    for path in (PACKAGE / "tools").rglob("*.py"):
        for module in imported_modules(path):
            if module.startswith("sched_copilot.agents"):
                assert module.startswith("sched_copilot.agents.contracts."), path
