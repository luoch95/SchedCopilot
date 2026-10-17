"""Load versioned prompt resources without coupling them to an LLM framework."""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal

AgentRole = Literal["validation", "scheduling", "evaluation", "explanation"]
_ROLE_FILES = {
    "validation": "validation_agent.md",
    "scheduling": "scheduling_agent.md",
    "evaluation": "evaluation_agent.md",
    "explanation": "explanation_agent.md",
}
_METADATA_FIELDS = {"prompt_id", "prompt_version", "requirements_version", "status"}


class PromptLoadError(ValueError):
    """A prompt resource is missing, invalid, or incompatible with its baseline."""


@dataclass(frozen=True)
class PromptMetadata:
    prompt_id: str
    prompt_version: str
    requirements_version: str
    status: str


@dataclass(frozen=True)
class LoadedPrompt:
    """An immutable snapshot; audit metadata comes from files, never the model."""

    role: AgentRole
    common_metadata: PromptMetadata
    role_metadata: PromptMetadata
    system_prompt: str
    content_sha256: str

    def build_messages(self, input_data: Mapping[str, object]) -> list[dict[str, str]]:
        """Keep untrusted business data separate from the system instructions.

        Inputs must be JSON-compatible. Do not silently stringify domain objects
        or accept NaN/Infinity, which would hide input-contract problems.
        """
        payload = json.dumps(dict(input_data), ensure_ascii=False, allow_nan=False)
        return [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": payload},
        ]


def _parse_template(source: str, filename: str, expected_id: str) -> tuple[PromptMetadata, str]:
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        raise PromptLoadError(f"{filename}: missing metadata header")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise PromptLoadError(f"{filename}: unclosed metadata header") from exc

    # Deliberately a flat key/value header, not a general YAML parser.
    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        key, separator, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not separator or key not in _METADATA_FIELDS or not value or key in metadata:
            raise PromptLoadError(f"{filename}: invalid or duplicate metadata field")
        metadata[key] = value
    if set(metadata) != _METADATA_FIELDS:
        raise PromptLoadError(f"{filename}: incomplete metadata")
    if metadata["prompt_id"] != expected_id:
        raise PromptLoadError(f"{filename}: unexpected prompt_id")
    if not re.fullmatch(r"\d+\.\d+\.\d+", metadata["prompt_version"]):
        raise PromptLoadError(f"{filename}: invalid prompt_version")
    if not re.fullmatch(r"V\d+\.\d+", metadata["requirements_version"]):
        raise PromptLoadError(f"{filename}: invalid requirements_version")
    if metadata["status"] not in {"pending_integration", "active"}:
        raise PromptLoadError(f"{filename}: unsupported template status")

    body = "\n".join(lines[end + 1 :]).strip()
    if not body:
        raise PromptLoadError(f"{filename}: empty prompt body")
    return PromptMetadata(**metadata), body


class PromptLoader:
    """Load only allowlisted roles from package resources, independent of cwd.

    The requirement baseline is checked on every load. No cache is used, so a
    changed local template cannot silently reuse an earlier in-memory version.
    pending_integration templates may be loaded for development; loading does
    not activate an Agent or certify model acceptance.
    """

    def __init__(self, requirements_version: str = "V1.1") -> None:
        if not re.fullmatch(r"V\d+\.\d+", requirements_version):
            raise ValueError("requirements_version must look like V1.1")
        self.requirements_version = requirements_version

    def load(self, role: AgentRole) -> LoadedPrompt:
        if role not in _ROLE_FILES:
            raise PromptLoadError(f"Unsupported agent role: {role!r}")

        root = files("sched_copilot.prompts")
        templates = []
        sources = []
        for filename, expected_id in (
            ("common.md", "schedule_copilot.common"),
            (_ROLE_FILES[role], f"schedule_copilot.{role}"),
        ):
            try:
                source = root.joinpath(filename).read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                raise PromptLoadError(f"{filename}: cannot read UTF-8 prompt resource") from exc
            metadata, body = _parse_template(source, filename, expected_id)
            if metadata.requirements_version != self.requirements_version:
                raise PromptLoadError(
                    f"{filename}: expected requirements {self.requirements_version}, "
                    f"got {metadata.requirements_version}"
                )
            templates.append((metadata, body))
            sources.append(source)

        common, agent = templates
        digest = hashlib.sha256(json.dumps(sources, ensure_ascii=False).encode("utf-8")).hexdigest()
        return LoadedPrompt(
            role=role,
            common_metadata=common[0],
            role_metadata=agent[0],
            system_prompt=f"{common[1]}\n\n{agent[1]}",
            content_sha256=digest,
        )
