"""Small, local keyword index. No embeddings, database, or external file access."""

import re
from hashlib import sha256
from importlib.resources import files
from pathlib import Path


class MarkdownKnowledgeStore:
    def __init__(self, directory=None):
        self.directory = directory or files("sched_copilot").joinpath("knowledge")

    def search(self, scene, question, signals=(), limit=4):
        if scene not in {"fault", "insertion"}:
            return []
        question = question[:2000].lower()
        # These facts are explicitly absent from the demonstration corpus. Device
        # IDs or broad "failure" matches must not masquerade as answers to them.
        if re.search(r"费用|金额|报价|价格|维修费|联系电话|实时温度|实时电流", question):
            return []
        hits = []
        for path in sorted(self.directory.iterdir(), key=lambda p: p.name):
            if not path.name.endswith(".md"):
                continue
            raw = path.read_text(encoding="utf-8")
            header, body = raw.removeprefix("---\n").split("\n---\n", 1)
            metadata = dict(line.split(": ", 1) for line in header.splitlines())
            if metadata["scene"] != scene or metadata["kind"] != "模拟演示资料":
                continue
            for index, section in enumerate(re.split(r"(?m)^## ", body)[1:], start=1):
                title, content = section.split("\n", 1)
                excerpt = content.strip()
                if not excerpt or len(excerpt) > 1200:
                    raise ValueError("Knowledge section must be bounded and nonempty")
                keywords = metadata["keywords"].lower().split("|")
                text = f"{title}\n{excerpt}".lower()
                matched = [word for word in keywords if word in question and word in text]
                if not matched:
                    continue  # Context/device IDs alone cannot establish relevance.
                score = sum(3 + min(len(word), 6) for word in matched)
                score += sum(1 for signal in signals if signal.lower() in text)
                hits.append(
                    dict(
                        chunk_id=f"{metadata['id']}@{metadata['version']}#{index}",
                        document_id=metadata["id"],
                        title=metadata["title"],
                        version=metadata["version"],
                        section=title.strip(),
                        excerpt=excerpt,
                        filename=Path(path.name).name,
                        kind="模拟演示资料",
                        content_sha256=sha256(raw.encode()).hexdigest(),
                        score=score,
                        matched_keywords=matched,
                    )
                )
        return sorted(hits, key=lambda item: (-item["score"], item["chunk_id"]))[
            : max(1, min(limit, 5))
        ]
