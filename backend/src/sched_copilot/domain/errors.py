"""Business rule failures, independent of HTTP and persistence frameworks."""


class RuleViolation(ValueError):
    """The requested operation violates an explicit scheduling or version rule."""
