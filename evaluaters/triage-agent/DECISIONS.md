# DECISIONS — triage-agent

One entry per judgment call. This is your interview script.

---

### 2026-07-09 — Scope: one repo, four tools, two side effects
JOB: read open issues in one repo, assign a label + priority, optionally
comment. Read-only tools: `list_open_issues`, `get_issue`. Side-effecting
tools: `add_label`, `post_comment`. Keeping the surface this small means the
Phase 2 safety policy has only two things to gate.

### 2026-07-09 — Tools-first, no agent loop in Phase 1
We build and unit-test the tool functions before any LLM or loop exists.
Rationale: tool bugs found through an agent are painful to diagnose (is it the
model, the loop, or the tool?). Proven tools remove one whole axis of doubt.

### 2026-07-09 — "id" is the issue number, not the global id
GitHub issues have both a global `id` and a per-repo `number`. The write
endpoints (`/issues/{n}/labels`, `/issues/{n}/comments`) address the number, so
we expose `number` as `id` everywhere. One identifier across read and write
tools; no translation step for the agent to get wrong.

### 2026-07-09 — One `_request()` choke point + typed exceptions
All HTTP flows through a single method that maps status codes to typed errors
and never swallows failures. Benefits: consistent error handling for every
tool, one place to add retries/logging later, and one seam the tests mock. 4xx
(our bug — bad token, missing issue) and 5xx (GitHub's problem) are distinct
types so the agent loop can treat them differently in Phase 3.

### 2026-07-09 — Session injection for testability
`GitHubClient` accepts an optional `requests.Session`. Tests inject a fake one
and assert on the exact requests sent — no network, no live repo, fast and
deterministic. This is the design choice that makes "unit tests that mock the
HTTP layer" trivial.

### 2026-07-09 — Filter pull requests out of list_open_issues
GitHub's issues endpoint returns PRs too (they carry a `pull_request` key). A
triager shouldn't relabel PRs, so we drop them at the tool boundary rather than
making the agent remember to.

### 2026-07-09 — Side-effect policy is written before the loop
The confirmation gate, 10-step cap, and bad-argument handling (see README) are
*my* decisions, not the model's. They belong to the harness, encoded in Phase 2
code — the model never gets to widen its own permissions.
