# herder

Portable, user-controlled memory for AI chat.

herder captures conversations from any chatbot, keeps a compact, layered, versioned brief of
what was established in them - every line traceable back to the messages it came from -
serves that brief into any other AI tool, and then measures whether the model actually
retained it.

**It runs no hosted model and needs no API key.** Every model it uses is a file on disk.

The specification is in [requirements/](requirements/). Read
[requirements/00-plan.md](requirements/00-plan.md) first.

## Status

**Stage 0 of 15: the scaffold.** The API, the worker and the schema exist and are verified.
Nothing derives anything yet - the loop closes at stage 3, and the first real brief comes out
of stage 4. See [requirements/05-tasks.md](requirements/05-tasks.md).

## Running it

Windows PowerShell 5.1 is the shell. Docker Compose brings up the API, the worker and
PostgreSQL with pgvector.

```powershell
docker compose up -d
docker compose ps
docker compose exec api alembic upgrade head

# is it alive
Invoke-RestMethod http://localhost:8000/health

# and does it go red - a health check that only proves the web server started
# is worth very little
docker compose stop db
Invoke-RestMethod http://localhost:8000/health    # expect 503
docker compose start db

# the worker says what it is doing
docker compose logs -f worker

# the schema
docker compose exec db psql -U herder -d herder -c "\dt"
```

The generated API documentation is at `http://localhost:8000/docs`. It costs nothing and it
is a usable surface on its own before there is a web UI.

## Running the tests

The stage 0 suite needs no database and no Docker, on purpose - a suite that needs
infrastructure is a suite that stops being run.

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m pytest
```

## Configuration

Everything comes from the environment; see [.env.example](.env.example). There is no
provider key and there is not going to be one.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | local postgres | Unprefixed, because that is what hosts and Compose set |
| `HERDER_EXTRACTOR` | `heuristic` | `heuristic`, `local` or `trained`. An unknown value is an error, never a silent default |
| `HERDER_MODEL_DIR` | `./models` | Where weights live. Gitignored, fetched on purpose |

`/health` reports which extractor is running. That is not a detail: the heuristic and the
local model produce briefs of different quality, and an operator who cannot see which one is
in force cannot interpret anything else the system reports.

## Layout

```
herder/
  api/        routers. HTTP in, HTTP out. No logic, no inference
  core/       config, database, ids, constants
  domain/     pure functions: chunking, merging, rendering, scoring. No IO
  models/     SQLAlchemy tables
  schemas/    Pydantic request and response models
  services/   orchestration
  worker/     the job runner. All inference happens here
  prompts/    versioned prompt templates
migrations/   Alembic. The first one is hand-written
tests/        runs without a database
models/       weights. Gitignored
```

`NOTES.md` is kept by hand: what was tried, what the numbers did, what was surprising.
