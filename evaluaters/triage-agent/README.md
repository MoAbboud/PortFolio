# triage-agent

An agent that reads open issues in one GitHub repo, decides a label + priority,
and acts — with every side effect gated behind your confirmation. **This repo
is built tools-first:** Phase 1 is the tool layer only, fully unit-tested, with
no agent loop. You don't wire up an LLM until the tools are solid.

## Phase 1 — the tools (this)

Four functions wrapping the GitHub REST API for one repo:

| tool                    | returns                          | effect      |
| ----------------------- | -------------------------------- | ----------- |
| `list_open_issues()`    | `[{id, title, body}]`            | read-only   |
| `get_issue(id)`         | `{id, title, body, labels}`      | read-only   |
| `add_label(id, label)`  | updated label list               | SIDE EFFECT |
| `post_comment(id, text)`| `{comment_id, url}`              | SIDE EFFECT |

`id` is the issue **number** (e.g. `#42`) — the identifier the write endpoints
use — so read and write tools share one notion of identity.

Every HTTP call funnels through one `_request()` method that turns status codes
into typed exceptions (`GitHubNotFoundError`, `GitHubAuthError`,
`GitHubRateLimitError`, `GitHubServerError`, `GitHubConnectionError`). Nothing
is swallowed.

## Setup

```bash
cd evaluaters/triage-agent
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
export GITHUB_TOKEN=ghp_...        # never hardcode
export GITHUB_REPO=owner/repo
```

## Confirm auth works

```bash
python scripts/check_auth.py
```

Lists open issues. If this prints, your token/repo/network are good.

## Run the tests (no network needed)

```bash
python -m pytest tests/ -v
```

The tests mock the HTTP layer with an injected fake session, so they run
offline and fast.

## Side-effect policy (decided by you, not the model)

This is the whole engineering story of Phase 2 — written deliberately, before
any agent code:

- `add_label` and `post_comment` require an explicit `y/n` confirmation before firing.
- Max 10 agent steps per run, then stop.
- If the model calls a tool with a missing/garbage argument, return an error to
  the model instead of crashing; don't retry more than twice.

## Roadmap

- **Phase 0 (you):** lock the job, the tools, and which have side effects. ✅
- **Phase 1:** build + unit-test the tools. ✅ *(this)*
- **Phase 2:** wire the tools into an agent loop where the LLM picks which to
  call, with the step cap + confirmation gate above.
- **Phase 3:** feed it adversarial issues, watch it break, fix, log every failure.
- **Phase 4:** point the eval-harness (Project A) at this agent to measure task
  success + guardrail firing.

See `DECISIONS.md` for every judgment call.
