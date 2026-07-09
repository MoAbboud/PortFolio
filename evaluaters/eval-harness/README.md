# eval-harness

A small, honest **LLM evaluation harness** for a structured-extraction task:
feed the model messy text, ask for JSON with specific fields, and score whether
the JSON is valid and the fields are right.

This repo is deliberately built in phases so the engineering discipline is
visible in the git history.

## Task

Support ticket → structured fields. Given raw ticket text, extract:

| field       | type                          | notes                                  |
| ----------- | ----------------------------- | -------------------------------------- |
| `category`  | string                        | issue type, e.g. `"MES/timeout"`       |
| `priority`  | `"low" \| "medium" \| "high"` |                                        |
| `recurring` | boolean                       | true if the text says it happened before |
| `system`    | string \| null                | the named system/line/product          |
| `summary`   | string                        | one-sentence plain summary             |

Swapping to a different task (classification, SQL-gen) only changes the labeled
cases and the extraction prompt — the harness below is unchanged.

## Architecture

```
harness/
  models.py    # typed dataclasses: Case, ModelResponse, ScoreResult
  cases.py     # JSONL loader -> list[Case]
  runner.py    # AnthropicRunner: Case -> raw ModelResponse (retries + backoff)
  scorer.py    # Scorer ABC (the pluggable interface)
  storage.py   # SQLite ResultsStore (one row per case/run/scorer)
  cli.py       # `python -m harness run --cases cases.jsonl`
cases.jsonl    # hand-labeled starter set
```

The modules are separated on purpose: **scorers, runner, and storage never
import each other's internals.** You can add a scorer without touching the
runner, or swap the model provider without touching scoring.

## Setup

```bash
cd evaluaters/eval-harness
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...        # never hardcode this
```

## Run

```bash
python -m harness run --cases cases.jsonl
```

This loads the cases, runs each through `claude-opus-4-8`, and stores the raw
responses in `results.db` under a fresh `run_id`. In Phase 1 **no scoring
happens yet** — that is intentional; the scoring is Phase 2.

Inspect what was stored:

```bash
sqlite3 results.db "SELECT case_id, substr(raw_text,1,80) FROM responses;"
```

## Roadmap

- **Phase 0 (you):** define the schema, write failure modes (`FAILURE_MODES.md`),
  hand-label the starter set. ✅
- **Phase 1 (scaffold):** loader, runner, Scorer ABC, SQLite store, CLI. ✅ *(this)*
- **Phase 2:** deterministic scorers (valid-JSON, field-by-field match) +
  an LLM-judge prompt you validate against your labels.
- **Phase 3:** regression tracking that diffs scores across runs + a report.
- **Phase 4:** grow the labeled set to 50–100 cases.

See `DECISIONS.md` for every judgment call and why it was made.
