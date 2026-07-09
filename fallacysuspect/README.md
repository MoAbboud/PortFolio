# fallacy_warn

A **logical-fallacy warning** tool. Give it a wall of text; it flags passages
that *might* lean on a logical fallacy as **WARNINGS** with confidence scores.

It is **not a judge**. It never declares who is right — only that a passage
*could* be relying on a fallacy, and how confident the second pass is.

> Phase 1 skeleton. The prompts in [`fallacy_warn/prompts.py`](fallacy_warn/prompts.py)
> are placeholders — prompt-tuning and the taxonomy are driven by hand. The
> eval/scoring harness is intentionally not built yet.

## How it works — two passes

1. **Detector** ([`detector.py`](fallacy_warn/detector.py)) — sends the full input
   to the LLM once and gets candidate fallacies back generously (favors recall).
2. **Verifier** ([`verifier.py`](fallacy_warn/verifier.py)) — for **each**
   candidate, makes a separate LLM call that skeptically checks whether it is
   really a fallacy or just a forceful-but-valid argument, returning a
   confidence `0.0–1.0`. Candidates the verifier vetoes are dropped.

Each surviving flag is a validated [`Flag`](fallacy_warn/models.py):

```
{ fallacy_type, span, confidence, warning_level, explanation, charitable_read }
```

`warning_level` (low / medium / high) is bucketed from `confidence` — see
[`config.py`](fallacy_warn/config.py).

## Taxonomy

A fixed, editable list in [`config.py`](fallacy_warn/config.py) (`FALLACY_TYPES`):
ad hominem, strawman, slippery slope, false dilemma, appeal to authority,
circular reasoning, hasty generalization, appeal to emotion, whataboutism,
red herring.

## Setup

```sh
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...     # Windows: set ANTHROPIC_API_KEY=...
```

## Usage

```sh
python -m fallacy_warn check --file argument.txt
python -m fallacy_warn check --text "You would say that, you always defend them."
python -m fallacy_warn check --file argument.txt --json      # machine-readable
cat argument.txt | python -m fallacy_warn check --file -     # stdin
```

Programmatic:

```python
from fallacy_warn import analyze

result = analyze("... a wall of argumentative text ...")
for flag in result.flags:
    print(flag.warning_level, flag.fallacy_type, "->", flag.span)
```

## Docker

Build the image once:

```sh
docker build -t fallacy-warn .
```

The API key is passed at **run** time (never baked into the image). Input text
comes from either a **mounted file** or **stdin** — a `--file` path is resolved
*inside* the container.

```sh
# Analyze a file: mount the current dir to /data, point --file at it.
docker run --rm -e ANTHROPIC_API_KEY -v "$PWD:/data" fallacy-warn \
    check --file /data/argument.txt

# Or pipe via stdin (-i keeps stdin open; --file - reads it).
cat argument.txt | docker run --rm -i -e ANTHROPIC_API_KEY fallacy-warn \
    check --file -

# A literal string, JSON output:
docker run --rm -e ANTHROPIC_API_KEY fallacy-warn \
    check --text "You would say that, you always defend them." --json
```

`-e ANTHROPIC_API_KEY` (no `=value`) forwards the variable from your shell, so
the key never lands in shell history or an image layer. On Windows PowerShell,
replace `$PWD` with `${PWD}`; in `cmd.exe` use `%cd%`.

> **Windows / Git Bash:** Git Bash rewrites the container path
> `/data/argument.txt` into a Windows path before Docker sees it. Prefix the
> command with `MSYS_NO_PATHCONV=1`, or just use PowerShell / `cmd.exe`, or pipe
> via stdin (`--file -`), none of which have this issue.

## Design notes

- **Single LLM provider to start** (Anthropic). The API key comes from the
  `ANTHROPIC_API_KEY` env var. Provider-specific code is isolated in
  [`llm.py`](fallacy_warn/llm.py).
- **Robust JSON.** Model output is parsed leniently; on malformed JSON a call is
  retried once, then that candidate (or the whole detector pass) is skipped
  rather than crashing.
- **API retries / rate limits** use the SDK's exponential backoff
  (`max_retries`, see [`config.py`](fallacy_warn/config.py)).
- **Spans are validated** to be verbatim quotes from the input before a flag is
  emitted.

## Layout

```
fallacy_warn/
  config.py     taxonomy, model, token budgets, warning bucketing
  prompts.py    placeholder prompts (edit freely)
  models.py     Flag dataclass + validation
  llm.py        Anthropic client + JSON parsing
  detector.py   pass 1
  verifier.py   pass 2
  pipeline.py   orchestration
  display.py    marked-text + report rendering
  cli.py        `check` command
```

## Not built yet (by design)

- Eval / scoring harness.
- Real (non-placeholder) prompts.
