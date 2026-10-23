"""Use-case failures. The HTTP adapter decides how to present these errors."""


class ApplicationError(Exception):
    code = "application_error"


class SnapshotConflict(ApplicationError):
    code = "snapshot_conflict"


class DemoCooldown(ApplicationError):
    code = "demo_cooldown"


class ResourceNotFound(ApplicationError):
    code = "not_found"


class InvalidInput(ApplicationError):
    code = "invalid_input"


class AnalysisUnavailable(ApplicationError):
    code = "analysis_unavailable"
