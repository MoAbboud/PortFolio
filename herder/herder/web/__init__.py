"""Stage 8: the minimal web UI. Server-rendered, bare, and the demo.

**Bare on purpose, and it stays bare until the stage 9 baseline is recorded** - that gate is
in `requirements/00-plan.md`, and it is what stops this becoming a front-end project while the
measurement never happens. The only CSS is what three columns and a readable table need.

Pages call the same services the API calls. Nothing here runs a model: every derive, render,
embed and checkpoint is a job for the worker, and a page with work in flight refreshes itself.
"""
