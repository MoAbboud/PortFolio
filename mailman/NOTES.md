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

**Worth being able to explain: why the health check checks the database.** A health check
that only proves the web server started is worth very little - the process being up is the
thing least likely to be wrong. The connection is what actually breaks, so `/health` runs a
query, returns 503 when it cannot, and was tested in that direction before being trusted. It
reports the exception class rather than the message, because a connection error can carry
the connection string and a connection string can carry a password.

**Worth being able to explain: why statuses are text with a CHECK, not a Postgres enum.** An
enum is a migration every time a status is added, which makes adding one a bigger decision
than it should be. The CHECK constraint is generated from the same tuple in
`mailman/status.py` that the application uses, so the two cannot drift, and the database
still refuses a status the code does not know about.

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

**The upload cap is 20MB, and the number is a guess so far.** A real invoice is a few
hundred kilobytes; a scanned multi-page one might reach a couple of megabytes. 20MB is well
clear of anything legitimate while still bounding what one request can cost. It is
configuration rather than a literal, so the corpus in stage 8 can say whether it is right -
if nothing in a realistic set comes close, the cap should come down.

**Worth being able to explain: why the store keeps the extracted text.** It is regenerable,
so keeping it looks redundant. It answers a question that cannot be answered after the
fact - when an extraction is wrong, was the model wrong, or was it handed an unreadable
page? Without the text as it was at the time, that argument has no evidence on either
side.

## Stage 2 - first extraction

Built and tested against a fake extractor, 70 tests green. **Not yet run against the real
model** - no `ANTHROPIC_API_KEY` set - so this stage is not finished.

**A hole in the state machine, found by running it and not by testing it.** With no API key
the SDK raises `TypeError` when the client is constructed. That exception was not in the
handled list, so the background task died *after* moving the document to `extracting`, and
the document sat there permanently. Nothing could move it, and the status column said
something was in progress that had already stopped. The fix that matters is not the
credentials check - it is that the pipeline now catches **anything**, writes a failure row
and moves the document to `failed`. Every test had passed; the bug only appeared on a real
upload.

**Worth being able to explain: why amounts and dates come back as strings.** The model
returns the characters printed on the page, not numbers. A float in JSON is how money
silently loses a cent - but the stronger reason is that a model forced to emit a number has
to invent one when it cannot read the field, which collapses "could not read this" and "this
is zero" into the same answer. Keeping them apart is the point: an unparseable amount is one
of the signals that sends a document to a person.

**Worth being able to explain: why the model is told not to calculate.** If the document
does not print a subtotal, the answer is null. A computed value and a read value are
indistinguishable afterwards, and one of the planned validation rules is "the total matches
the total printed on the document" - which is unenforceable if the model has helpfully done
the arithmetic on the way past.

**Worth being able to explain: why server-side refusal fallbacks are switched off.** The SDK
guidance recommends enabling them by default on this model. They are off here on purpose:
every extraction row records `model_name`, and the harness compares runs by that field. A
fallback that silently answers with a different model while the row claims otherwise would
corrupt the measurement the whole project exists to produce. A refusal is recorded as its own
failure kind instead.

**Something to watch for stage 8.** Structured outputs make malformed JSON nearly impossible
- the API constrains the shape. Good for production, awkward for measurement: the harness
will report roughly zero malformed responses, which says more about the constraint than
about the model. The failure path is still implemented and still tested, because "nearly"
is not "never" and a truncated response arrives the same way.

**The date parser flags ambiguity rather than resolving it.** `03/04/2026` parses as
3 April, reports `day-first`, and is marked ambiguous because 3 March is equally real.
`13/04/2026` is not flagged - 13 cannot be a month. The flag is meant to feed the routing
decision in stage 5.

## Stage 2, revisited - no API keys

Decided not to use hosted-model API keys at all. Extraction is now something owned rather
than rented: a heuristic baseline that ships, and a token classifier trained on Colab.

**This made the project better, not just cheaper.** "An LLM inside a real system" is a story
thousands of people can tell. "A deterministic baseline, a model trained on labels generated
by construction, and a harness that says which one wins and by how much" is harder to build
and much harder to fake.

**The protocol paid for itself in a day.** `Extractor` was written in stage 2 as a Protocol
with exactly one implementation, which at the time looked like architecture for its own sake.
Adding two more implementations turned out to be a constructor argument and a config setting.
Nothing in the pipeline, the rules or the API knows which extractor answered - they read
`model_name` on the row.

**Worth being able to explain: why a tagger and not a local generative model.** The pipeline
already has the text layer, and every field wanted is a span physically printed on the page.
A token classifier returns *where* it found each value, so anything it returns came from the
document - it cannot invent an invoice number that was never printed. That deletes a class of
failure rather than defending against it. The cost is that it cannot infer anything not
written down, which is fine here, because the validation rules do arithmetic in Python
precisely so the extractor never has to.

**Worth being able to explain: why the heuristic is the default and not the fallback.** It
runs on a clean checkout with no key, no weights, no GPU and no network, in about 17ms. It is
also the number the trained model has to beat - a 250 MB model that cannot outperform keyword
matching on invoices is not worth shipping, and the harness in stage 8 is what settles that.

**Two bugs found by running it on a realistic layout, not by the tests.** Both had full test
coverage passing at the time:

1. The regex `(?:invoice|inv)` matched the first three letters of the word **INVOICE** on a
   bare heading line, and returned `OICE` as the invoice number. Fixed with `inv\b`.
2. Stripping the amounts out of a line to get its description left the currency code behind:
   `Widget assembly GBP`.

The pattern is becoming familiar. The tests check what was thought of; looking at the actual
output finds what was not.

**The notebook's weakness, stated plainly.** It trains on generated invoices, so the labels
are free and correct - but the model has learned one author's idea of what an invoice looks
like. Public sample sets (SROIE, CORD, FUNSD) mixed in are what would make the number mean
something. Until that happens, any F1 quoted has to carry that caveat with it.
