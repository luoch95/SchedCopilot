"""Versioned Agent templates and their public loading interface."""

from .prompt_loader import AgentRole, LoadedPrompt, PromptLoader, PromptLoadError, PromptMetadata

__all__ = ["AgentRole", "LoadedPrompt", "PromptLoader", "PromptLoadError", "PromptMetadata"]
