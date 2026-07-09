# whereyago — Backend API

FastAPI + PostgreSQL backend for the whereyago day-logger. Built around a clean,
layered architecture so it stays easy to read, test, and extend.

## 🧱 Architecture (SOLID, layered)

Requests flow **down** through the layers; nothing lower knows about anything higher:

```
HTTP request
   │
   ▼
api/v1/*        thin controllers — parse/validate (Pydantic), return DTOs
   │            (depends on ↓ via app/api/deps.py = the composition root)
   ▼
services/*      business logic & rules — transport-agnostic, raise AppError
   │            (depends on repository INTERFACES, not implementations)
   ▼
repositories/*  data access — a Protocol (interface) + a SQLAlchemy impl
   │
   ▼
models/*        SQLAlchemy ORM   ·   db/   engine + transactional session
```

How each SOLID principle shows up:

| Principle | Where |
|---|---|
| **S**ingle responsibility | Each module does one job: routers route, services decide, repositories persist. |
| **O**pen/closed | Add a feature by adding a service/repository, not editing existing ones. |
| **L**iskov | Any object satisfying a repository `Protocol` is a drop-in (real or fake). |
| **I**nterface segregation | Repositories expose only the few methods a service needs. |
| **D**ependency inversion | Services depend on `Protocol` interfaces; concrete impls are injected in `api/deps.py`. |

## 🔐 Secrets, config & logging (your requirements)

- **No hard-coded secrets.** All config is read from the environment via
  `pydantic-settings` (`app/core/config.py`). `SECRET_KEY` and `POSTGRES_PASSWORD`
  have **no defaults**, so the app won't even start without them.
- **`.env` is gitignored**; only `.env.example` (blank values) is committed.
- **Passwords** are Argon2-hashed (`app/core/security.py`); plaintext never hits the DB,
  and the password field never appears on any response schema.
- **Structured logging** (`structlog`): every request gets a **correlation id**
  (`app/middleware/correlation.py`) that tags all its log lines and is returned in the
  `X-Request-ID` header. JSON logs in production, pretty logs locally. We log ids, never payloads/secrets.
- **Quality gates**: `ruff` (lint+format), `mypy --strict`, `pytest`, and `pre-commit`.

## 🪵 Logs in the database (no log files)

Warnings, errors, and every **unhandled exception** are written to the
`log_entries` table — not to files on disk. Each row captures:

| Column | What |
|---|---|
| `created_at` | time & day |
| `level` | INFO / WARNING / ERROR |
| `message` | the log message |
| `error_type` / `error_message` | the exception class and its message |
| `module` / `function` / `line` | **where** the error happened |
| `traceback` | full stack trace |
| `user_id` | the logged-in user at the time (if any) |
| `correlation_id`, `method`, `path` | the request it came from |

How it works (`app/core/db_logging.py`): a structlog processor persists `WARNING`+
log calls, and the global exception handler in `app/main.py` records unhandled
errors **in their own transaction** (so the error is saved even when the request
rolls back). The threshold is `DB_LOG_LEVEL` (default `WARNING`; set to `INFO` to
capture everything). Live output still goes to stdout (`docker compose logs api`) —
that's the container console, not a file.

**Read the logs** (most recent first):
```bash
docker compose exec db psql -U whereyago -d whereyago -c \
  "SELECT created_at, level, error_type, function, line, user_id, message
   FROM log_entries ORDER BY created_at DESC LIMIT 20;"
```

## 🖥️ Browse the database (Adminer)

`docker compose up` also starts **Adminer**, a web UI for the database, at
**http://localhost:8080**. Log in with:

| Field | Value |
|---|---|
| System | **PostgreSQL** |
| Server | **db** (pre-filled) |
| Username | your `POSTGRES_USER` (default `whereyago`) |
| Password | your `POSTGRES_PASSWORD` (from `.env`) |
| Database | your `POSTGRES_DB` (default `whereyago`) |

From there you can browse every table (`adventures`, `stops`, `log_entries`, …),
run SQL, and edit rows. **Local dev only** — the compose file warns not to expose
port 8080 publicly.

## 🚀 Quick start (Docker — recommended)

You already have Docker, so this is the one-liner path:

```bash
cd whereyago/backend
cp .env.example .env
# put a real secret + db password in .env:
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64))"   # paste into .env
# set POSTGRES_PASSWORD=something in .env too

docker compose up --build
```

- API → http://localhost:8000
- Interactive docs (Swagger) → http://localhost:8000/docs
- Migrations run automatically on container start (`scripts/start.sh`).

## 🧑‍💻 Quick start (local, without Docker for the app)

```bash
cd whereyago/backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cp .env.example .env                                # fill SECRET_KEY + POSTGRES_PASSWORD

# Start just Postgres in Docker:
docker compose up -d db

alembic upgrade head            # create tables
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

## ✅ Tests

No database required — the suite uses an in-memory SQLite and overrides the DB dependency:

```bash
pip install -e ".[dev]"
pytest
```

## 🗺️ API (v1)

Base path: `/api/v1`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | Liveness check |
| POST | `/auth/register` | – | Create an account |
| POST | `/auth/login` | – | Get a bearer token |
| GET | `/auth/me` | ✅ | Current user |
| POST | `/days` | ✅ | Log a day (with stops) |
| GET | `/days` | ✅ | List my days |
| GET | `/days/discover` | – | Public Discover feed (shared days) |
| GET | `/days/{id}` | ✅ | Get one of my days |
| DELETE | `/days/{id}` | ✅ | Delete one of my days |

Send the token as `Authorization: Bearer <token>`.

## 🧬 Data model

```
User ──1:N──> Day ──1:N──> Stop
```
- **Day**: title, vibe (enum), city, date, weather (JSON snapshot), is_shared
- **Stop**: ordered (`position`), name, type (enum), time, note, lat/lon, event (JSON)

## ➕ Adding a feature (the pattern)

1. Model in `models/` (+ `alembic revision --autogenerate -m "..."`).
2. Schema in `schemas/`.
3. Repository `Protocol` + impl in `repositories/`.
4. Service method in `services/`.
5. Route in `api/v1/` and wire the provider in `api/deps.py`.
6. Test in `tests/`.

## 🛣️ Next backend steps

- `likes` / `follows` tables and a real Discover ranking
- Geocoding + weather fetched server-side (cache results on the Day)
- Rate limiting (e.g. `slowapi`) and refresh tokens
- CI running `ruff` + `mypy` + `pytest` on every PR
