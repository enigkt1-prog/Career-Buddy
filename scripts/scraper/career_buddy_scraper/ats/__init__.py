"""ATS adapters: Greenhouse, Lever, Ashby, Workable.

Each adapter implements the :class:`~.base.AtsAdapter` protocol: detect a
careers URL, fetch the public job-board JSON, normalise each row into a
``CanonicalJob``-shape **dict** (not a Pydantic instance — the orchestrator
owns validation so it can quarantine bad rows).
"""
