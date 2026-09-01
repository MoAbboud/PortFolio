# mailman - working notes

Written by hand. What was tried, what the numbers did, what was surprising.

This file is not generated and is not maintained by tooling. It is the record no tool can
produce, and it is where the credibility comes from - the README's most useful section gets
written out of it.

Things worth writing down as they happen:

- The failure list from the first ten documents, which is what the validation rules come from.
- Why the confidence threshold ended up where it did.
- Every harness run: what changed, what the number did, and whether that was expected.
- The changes that did not help. Those are worth more than the ones that did.

---

## Stage 0 - scaffold

Built the scaffold: FastAPI, Postgres 16, Alembic, the seven tables, `/health`. Verified by
running it, not by reading it - `docker compose up`, `alembic upgrade head`, `/health` 200,
6 tests green.

**Deliberately tested the health check in its failing direction.** Stopped the database:
`/health` returned 503 with `database: unreachable`. Started it: back to 200. A health check
that has never been seen fail is a claim, not a check.

Two things broke while writing the tests, both worth remembering:

1. `Base.metadata.tables` came back **empty**. Importing the app is not enough - SQLAlchemy
   only knows about a table once the module defining it has been imported, and the HTTP
   layer has no reason to import the models. The fix is an explicit `from mailman import
   models  # noqa: F401` in the test, and the same trick is already needed in
   `migrations/env.py` for autogenerate to see anything. Easy to lose an hour to.
2. `app.routes` does not flatten included routers in this FastAPI version - the entries are
   `_IncludedRouter` objects with no `.path`, so checking for `/health` that way fails.
   Switched to asserting against `app.openapi()["paths"]`, which is better anyway: it tests
   the contract a caller actually sees rather than an internal structure.

Decision worth defending later: statuses are `text` with a CHECK constraint generated from
`mailman/status.py`, not a native Postgres enum. Adding a status is then not a migration,
and the list cannot drift from the constraint.

<!-- Your turn: what surprised you here, and whether any of the above changes your mind
     about the shape. That half is the part that matters. -->

**The bare host was a 404.** Clicking the port in Docker Desktop opens `http://localhost:8000/`
and nothing was routed there, so it looked broken when it was fine. Only `/health`, `/docs`,
`/redoc` and `/openapi.json` existed. Added a root route redirecting to `/docs`, plus a test
so it cannot quietly disappear. Stage 7 should point `/` at the review queue instead - that
is the page a visitor should land on.

Worth noticing generally: the thing was working and the front door said otherwise. For a
project whose whole point is being shown to someone, the default landing page is not a
detail.

## Stage 1 - ingestion

Upload a PDF, get an id back, text stored beside the original. Tested by uploading real
files, not only by test: a PDF with text -> `received`; a PDF with no text layer -> `failed`
with a reason; a spreadsheet -> 415, nothing stored; a PDF renamed `liar.xlsx` -> ingested
as a PDF anyway.

**Nearly shipped a lie in the status column.** Had written the success path as
`received -> extracting`, then realised there is no extractor until stage 2, so every
document would have parked in `extracting` forever. Success now leaves the document at
`received`. Worth remembering: a state machine is only useful if every state has something
that moves documents out of it, and it is easy to add an edge to a state that does not exist
yet.

**Found a wart by looking at the store, not the tests.** A PDF uploaded as `liar.xlsx` was
written to disk as `original.xlsx` - the key was taking its extension from the filename. The
store should say what the file *is*, not repeat what the sender claimed. Now the extension
comes from the detected media type, which also keeps an attacker-controlled string out of
the path. The tests were all green before and after; this one only showed up in `find data`.

**Two things that cost time:**

1. `document.status_history.append(...)` writes nothing. SQLAlchemy does not track mutation
   inside a JSONB value, so the history silently stays empty. Has to be reassigned:
   `document.status_history = [*document.status_history, entry]`. This is the kind of bug
   that is invisible until the day someone needs the history to explain a stuck document.
2. In the test fixture, `connection.execute(SELECT 1)` autobegins a transaction, so the
   `connection.begin()` after it raises "this connection has already initialized a
   Transaction". Needs a `rollback()` in between.

**Decision worth defending:** an unsupported *type* is refused at the door with 415 and
nothing is stored, but an unreadable *PDF* is stored and marked `failed`. A spreadsheet is
something to tell the sender about now. A PDF that will not parse is a document this
pipeline is supposed to handle eventually, and its bytes are exactly what I will want to
look at. The `failed` count is a roadmap.

<!-- Your turn: does the failed-vs-refused split match how you would actually run this?
     And is 20MB the right upload cap for an invoice pipeline? -->
