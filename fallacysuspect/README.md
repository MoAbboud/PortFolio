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

### Web interface

```sh
python -m fallacy_warn serve            # -> http://127.0.0.1:8000
```

Opens a single-page UI: paste text, click **Check for fallacies**, and see the
passage with flagged spans highlighted (color-coded by warning level) alongside
a breakdown of each warning. The API key stays server-side — the browser never
sees it, which is why this app needs a small backend rather than a static page.
(`--host`, `--port`, and `--model` are configurable; `Ctrl/Cmd+Enter` submits.)

### Command line

```sh
python -m fallacy_warn check --file argument.txt
python -m fallacy_warn check --text "You would say that, you always defend them."
python -m fallacy_warn check --file argument.txt --json      # machine-readable
cat argument.txt | python -m fallacy_warn check --file -     # stdin
```

### Run your own trained model (no API cost)

The app can serve a locally trained two-stage classifier ([`classifier.py`](fallacy_warn/classifier.py))
instead of the paid LLM API — **no key, no per-call cost**. Train it with
[`notebooks/fallacy_classifier.ipynb`](notebooks/), drop the exported models in
`models/two_stage/`, and install the ML deps:

```sh
pip install torch transformers
```

The app then **auto-detects** the models and prefers them. It works sentence by
sentence: each sentence is checked fallacy-vs-valid (Stage 1) and flagged ones get
a predicted type (Stage 2), so the same highlight-and-explain UI is driven by your
own model. Force a backend with the `FALLACY_BACKEND` env var:

| `FALLACY_BACKEND` | Behavior |
| ----------------- | -------- |
| `auto` (default)  | Local models if present, else the API |
| `local`           | Always the local models |
| `api`             | Always the Anthropic API |

Programmatic:

```python
from fallacy_warn import analyze

result = analyze("... a wall of argumentative text ...")
for flag in result.flags:
    print(flag.warning_level, flag.fallacy_type, "->", flag.span)
```

## Docker

### Quick start — Docker Compose (recommended)

One command brings up the web interface. First, put your key in a `.env` file
next to `docker-compose.yml` (it's git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-your-real-key
```

Then:

```sh
docker compose up --build      # first time (or after code changes)
docker compose up              # subsequent runs
```

Open **http://localhost:8000**. Stop with `Ctrl+C`; run `docker compose down`
to remove the container. Stored evaluations persist in the `fallacy-data`
volume. Change the local port with `PORT=3000 docker compose up`. If
`ANTHROPIC_API_KEY` isn't set (in `.env` or your shell), Compose stops with a
clear message rather than starting a broken app.

### Manual `docker build` / `docker run`

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

# Web interface: publish the port and bind to 0.0.0.0 inside the container.
docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY fallacy-warn \
    serve --host 0.0.0.0        # then open http://localhost:8000
```

`-e ANTHROPIC_API_KEY` (no `=value`) forwards the variable from your shell, so
the key never lands in shell history or an image layer. On Windows PowerShell,
replace `$PWD` with `${PWD}`; in `cmd.exe` use `%cd%`.

> **Windows / Git Bash:** Git Bash rewrites the container path
> `/data/argument.txt` into a Windows path before Docker sees it. Prefix the
> command with `MSYS_NO_PATHCONV=1`, or just use PowerShell / `cmd.exe`, or pipe
> via stdin (`--file -`), none of which have this issue.

## Database interface

Every evaluation (web **Evaluate** button or CLI `check`) stores the submitted
text and its analysis result, so past evaluations can be reviewed. Storage is
**best-effort** — if the database can't be written, you still get your result.

- **Engine:** SQLite (standard library — one file, no external service, no extra
  dependency). See [`db.py`](fallacy_warn/db.py).
- **Location:** `fallacy_warn.db` in the working directory by default. Override
  with the `FALLACY_WARN_DB` environment variable (the Docker image defaults it
  to `/data/fallacy_warn.db`).

**Schema** — table `analyses`:

| column          | type    | notes                                          |
| --------------- | ------- | ---------------------------------------------- |
| `id`            | INTEGER | primary key, autoincrement                     |
| `created_at`    | TEXT    | UTC ISO-8601 timestamp                         |
| `text`          | TEXT    | the exact text that was submitted              |
| `warning_count` | INTEGER | number of flags produced                       |
| `flags_json`    | TEXT    | the flags as JSON (fallacy_type, span, ...)    |

**Review stored evaluations:**

```sh
python -m fallacy_warn history            # recent rows as a table
python -m fallacy_warn history --json     # same data as JSON
```

Or query the file directly with any SQLite client:

```sh
sqlite3 fallacy_warn.db "SELECT id, created_at, warning_count FROM analyses ORDER BY id DESC LIMIT 10;"
```

**Persisting in Docker** — mount a volume so the DB survives container restarts:

```sh
docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY \
    -v fallacy-data:/data fallacy-warn serve --host 0.0.0.0
```

> Switching to PostgreSQL/MySQL later is a `db.py`-only change — the rest of the
> app just calls `store_analysis()` / `recent()`.

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
