"""Grounded local retrieval and provider failure boundaries."""

import json
from hashlib import sha256

import pytest
from langchain_core.messages import AIMessage

from sched_copilot.agents.knowledge_explanation import knowledge_explanation
from sched_copilot.infrastructure.markdown_knowledge import MarkdownKnowledgeStore


def test_retrieval_is_versioned_exact_bounded_and_scene_specific():
    store = MarkdownKnowledgeStore()
    hits = store.search("fault", "M3 故障后，转机需要检查什么？", ["M3"])
    assert 1 <= len(hits) <= 4
    assert hits == store.search("fault", "M3 故障后，转机需要检查什么？", ["M3"])
    for hit in hits:
        raw = store.directory.joinpath(hit["filename"]).read_text(encoding="utf-8")
        assert hit["excerpt"] in raw
        assert hit["content_sha256"] == sha256(raw.encode()).hexdigest()
        assert hit["chunk_id"].startswith("K-FAULT-")
        assert "@1.0#" in hit["chunk_id"]
        assert hit["kind"] == "模拟演示资料"
    assert all(
        h["document_id"].startswith("K-URG-") for h in store.search("insertion", "插单延期审批风险")
    )


@pytest.mark.parametrize("question", ["你好", "这台设备实际维修费用是多少？", "M3故障维修费用"])
def test_no_match_does_not_call_model(question):
    def forbidden():
        raise AssertionError("must not call provider without evidence")

    report = knowledge_explanation(
        MarkdownKnowledgeStore().search, "fault", question, {}, ["M3"], model_factory=forbidden
    )
    assert report["status"] == "no_match"
    assert report["items"] == []
    assert report["execution"]["calls"] == 0


@pytest.mark.parametrize("malformed", [False, True])
def test_missing_or_malformed_files_do_not_block_explanation(tmp_path, malformed):
    if malformed:
        (tmp_path / "bad.md").write_text("broken file", encoding="utf-8")
        directory = tmp_path
    else:
        directory = tmp_path / "missing"
    report = knowledge_explanation(MarkdownKnowledgeStore(directory).search, "fault", "转机", {})
    assert report["status"] == "unavailable"
    assert report["sources"] == []


class KnowledgeModel:
    def __init__(self, fault=None):
        self.fault = fault
        self.context = None

    def bind_tools(self, tools, **kwargs):
        assert tools[0]["function"]["name"] == "submit_knowledge"
        return self

    def invoke(self, messages):
        self.context = json.loads(messages[-1].content)
        if self.fault == "timeout":
            raise TimeoutError("SECRET_PROVIDER_BODY")
        item = dict(source_id=self.context["sources"][0]["chunk_id"], fact_ids=["B1"])
        if self.fault == "source":
            item["source_id"] = "invented"
        elif self.fault == "fact":
            item["fact_ids"] = ["invented"]
        elif self.fault == "extra":
            item["text"] = "SECRET_PROVIDER_BODY"
        elif self.fault == "duplicate_fact":
            item["fact_ids"] = ["B1", "B1"]
        items = [item, item] if self.fault == "duplicate_source" else [item]
        return AIMessage(
            content="SECRET_UNTRUSTED_PROSE",
            tool_calls=[dict(id="k1", name="submit_knowledge", args={"items": items})],
        )


def test_model_can_only_associate_retrieved_sources_with_verified_facts():
    model = KnowledgeModel()
    report = knowledge_explanation(
        MarkdownKnowledgeStore().search,
        "fault",
        "转机检查",
        {"B1": "当前候选涉及2个订单。"},
        model_factory=lambda: model,
    )
    assert report["mode"] == "live"
    assert report["execution"]["calls"] == 1
    assert report["items"][0]["related_facts"] == ["当前候选涉及2个订单。"]
    assert report["items"][0]["source_id"] == model.context["sources"][0]["chunk_id"]
    assert "SECRET_UNTRUSTED_PROSE" not in json.dumps(report)


@pytest.mark.parametrize(
    "fault", ["timeout", "source", "fact", "extra", "duplicate_source", "duplicate_fact"]
)
def test_bad_model_retains_exact_source_and_never_leaks(fault):
    report = knowledge_explanation(
        MarkdownKnowledgeStore().search,
        "fault",
        "转机检查",
        {"B1": "已校验事实"},
        model_factory=lambda: KnowledgeModel(fault),
    )
    assert report["mode"] == "fallback"
    assert report["status"] == "matched"
    assert report["items"] and report["sources"]
    assert all(item["related_facts"] == [] for item in report["items"])
    assert "SECRET" not in json.dumps(report)


def test_prior_model_failure_skips_additional_provider_calls():
    report = knowledge_explanation(
        MarkdownKnowledgeStore().search,
        "insertion",
        "插单审批",
        {},
        model_factory=lambda: pytest.fail("must skip"),
        skip_code="MODEL_TIMEOUT",
    )
    assert report["mode"] == "fallback"
    assert report["execution"]["calls"] == 0
    assert report["execution"]["error_code"] == "MODEL_TIMEOUT"
