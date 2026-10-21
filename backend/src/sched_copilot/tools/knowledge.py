"""Read-only retrieval tool; business calculations and publication stay outside."""


def retrieve_knowledge(search, scene, question, signals=()):
    try:
        sources = search(scene, question, tuple(signals), limit=4)
    except Exception:
        # Missing/malformed demonstration files must never block a business flow.
        return dict(status="unavailable", sources=[], message="知识资料暂不可用，保留原规则说明。")
    return dict(
        status="matched" if sources else "no_match",
        sources=sources,
        message="检索到相关模拟演示资料。" if sources else "未找到相关知识依据，保留原规则说明。",
    )
