# DECISIONS — eval-harness

One entry per judgment call. This doubles as the README's "why" and your
interview script. Add to it every time you make a non-obvious choice.

---

### 2026-07-09 — Task: support-ticket extraction
Chose support-ticket → structured fields as the first task because the fields
mix easy-to-score types (enum `priority`, boolean `recurring`) with fuzzy ones
(`summary`, `category`). That mix lets us exercise both deterministic scorers
and an LLM judge in one project.

### 2026-07-09 — Raw text out of the runner, no forced JSON
The runner returns the model's **raw text** and does NOT use structured-output
constraints. If we forced valid JSON at the API level, the "is it valid JSON?"
scorer would always pass — we'd be measuring the API, not the model. Observing
unconstrained behavior is the entire point of the eval.

### 2026-07-09 — Own the retry loop; SDK `max_retries=0`
The Anthropic SDK retries transient errors automatically. We disabled that and
wrote our own exponential-backoff-with-jitter loop so retries are **visible and
counted** (`meta["attempts"]`). An eval harness should be able to report how
flaky the provider was during a run. 4xx errors are surfaced immediately (not
retried) because they're our bug, not a transient fault.

### 2026-07-09 — SQLite, one row per (run_id, case_id, scorer_name)
`run_id` groups a single invocation so runs can be diffed later (Phase 3). We
also persist the raw response per (run, case) so a run is fully reproducible
after the fact. SQLite = zero setup, single file, ships with Python; the schema
ports to Postgres if this ever needs a dashboard.

### 2026-07-09 — Scorer as an ABC, empty registry in Phase 1
`Scorer.score(case, response) -> ScoreResult` is the only contract the runner
and CLI know about. Concrete scorers are added in Phase 2 by registering them in
`cli._load_scorers()` — no other file changes. This is the seam that keeps the
project from turning into a tangle.
