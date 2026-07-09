"""GitHub issue-triage agent.

Phase 1 ships the TOOL LAYER ONLY — four typed functions wrapping the GitHub
REST API for a single repo. No agent loop, no LLM calls, no tool dispatch yet.
Building the tools first (and unit-testing them) is the discipline that keeps
the project from turning into a tangle.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
