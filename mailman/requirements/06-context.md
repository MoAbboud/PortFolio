# mailman - Context and handoff

## Read this first

Nothing is built. As of 2026-08-25 this folder is the entire project.

**Stages 0, 1 and 2 are done.** A PDF can be uploaded and comes back with structured
fields, **with no API key, no network call and no cost** - the default extractor is
regular expressions and layout rules, and it runs in about 17ms.

**This project does not use hosted-model API keys.** Where machine learning is involved it
is trained locally, on Colab's free GPU, from `notebooks/train_extractor.ipynb`. Three
extractors implement one protocol and are selected by `MAILMAN_EXTRACTOR`: `heuristic`
(default, deployable), `trained` (local weights), `anthropic` (kept as a comparison point,
never required). See the 2026-09-01 entry on this at the end of the log.

The current work is **stage 3**: ten varied documents end to end, and the written list of
everywhere it went wrong. That list is what generates the validation rules.

**The goal is a system that runs and can be shown.** It goes on job applications and gets
walked through in interviews. Working to a certain extent beats designed thoroughly and
half-built, and that is why the plan reaches a demonstrable queue at stage 7 rather than
saving the interface for the end.

**And the measurement is what makes it worth showing.** Stages 8 and 9 - the recorded
baseline and the measured iteration - are the part that separates this from every other
document-AI demo, and the part an interviewer will actually probe. The two goals are not in
tension in this plan, but they can be in practice, so there is a gate: the stage 7 queue
stays bare, and nothing gets styled and nothing gets deployed until the baseline exists.

Everything is checked from PowerShell. The commands per stage are in
[05-tasks.md](05-tasks.md). If a stage cannot be verified that way, it is not finished.

There are no dates anywhere in these documents. Stages are ordered by dependency.

## How this file is maintained

This file is the core of the project's continuity. It is what a new working session reads to
pick the thread back up, and it is kept to one rule:

**Nothing is erased. Everything is superseded.**

- The session log at the bottom is **append only**. New entries go at the end, dated. An
  earlier entry is never edited to make it agree with a later one - the disagreement is the
  history.
- When a decision is overturned, it does not vanish from the decisions table. It moves into
  the log with what replaced it and why, and the table row is rewritten to the new decision
  with the old one named as the rejected alternative. Both survive.
- When a question is answered, it comes out of "Still open" and the answer goes into the log
  with the reasoning. The question is not silently dropped.
- Every working session appends an entry, even a short one. A session that changed nothing
  says so.

The reason is simple: the value of this project in an interview is being able to explain why
it is the way it is. A decision record that only ever shows the current answer cannot do
that, because every hard call in it looks obvious in hindsight. The alternatives that were
rejected, and the things that turned out to be wrong, are the part worth keeping.

## Why this project exists

Three years of building an EDI system that moved structured data between systems and cut
manual processing by eighty percent. That system only worked when the sender already spoke
the format, which is the obvious limit of the approach: a supplier emails a PDF, a partner
sends a scan of a bill of lading, a customer attaches a spreadsheet with the columns in the
wrong order, and a person retypes it.

mailman is the layer in front of that agreement. It is deliberately shaped so the familiar
work is the backbone - Python services, REST API design, PostgreSQL schema work, Docker -
and the model is one component inside it rather than the whole thing. That is how the roles
being targeted describe the work: integrating LLM capabilities into enterprise workflows. It
allows the strongest existing experience to be the load-bearing part of the project while
the new capability is demonstrated on top of it.

## The two parts that have to be his own

This matters more than any architectural decision here, and it is the reason to be careful
about what gets generated.

Using AI tooling to build this is fine and is itself something the postings ask for. Nobody
expects every line to be hand-typed. But if an interviewer asks **why the confidence
threshold is where it is**, or **why extractions are append-only**, or **what happens when
the model returns malformed JSON**, the answer has to be his rather than something read off
the screen.

The two places that get probed hardest:

1. **The validation rules.** They came from thinking about invoices, not from a framework.
   Whatever gets generated for them should be read line by line and adjusted until it
   reflects his own judgement about what a good invoice pipeline should catch. The plan puts
   them after the first ten documents precisely so they come from observed failures.
2. **The evaluation harness.** Same reason. What counts as a match, how line items are
   compared, why field-level and not document-level - these are judgement calls, and the
   defence of them is the interview.

`NOTES.md` is the third. What was tried, what the numbers did, what was surprising. Tooling
may append the facts - a run happened, a number moved, something broke - because a fact
recorded late is usually a fact lost. The judgement is the author's: what it meant, whether
it was expected, what to do about it. That half is the record no tool can produce, and it is
where the credibility lives. It becomes the README's most useful section.

## Decisions, with what was rejected

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| A running demo is the primary goal | A thorough system that is not yet demonstrable | It goes on job applications. Working to a certain extent, hosted, with a link, beats a better design that nobody can open |
| The minimal review queue at stage 7, before the corpus | The queue last, after all measurement | It is the demo, and it is the tool for looking at extractions while the corpus is assembled. The risk it was moved away from - stalling in the interface and never measuring - is handled by a gate instead: the queue stays bare until the baseline is recorded |
| Every stage verifiable from PowerShell | Verifying through tests alone, or through a client the author has to install | Testing happens in a Windows terminal. A stage that cannot be checked there is not finished. Note that PowerShell 5.1 has no `Invoke-RestMethod -Form`, so uploads go through `curl.exe` |
| Seven tables | A normalised set with renditions, review tasks and status events as their own tables | The shape carries the design; the extra tables were bookkeeping. The queue became a status filter, the extracted text went into the document store beside the original, and the status history became a jsonb column. Fewer places for the same fact to live |
| Queue is `GET /documents?status=needs_review` | A `review_tasks` table | A queue table duplicates a fact `documents.status` already holds, and the two can disagree |
| Extracted PDF text written beside the original in the store | A `renditions` table, or a column on `documents` | Large, regenerable, and only ever read for debugging. Storage already has an S3-shaped layout, so it costs nothing to put it there. Keeping it at all answers the question that otherwise cannot be answered later: did the model read it wrong, or was it handed something unreadable |
| Gold labels as JSON files beside the documents, results as files | `eval_cases`, `eval_runs`, `eval_results` tables | Measurement belongs in git history where it can be read in a diff. The production schema should not carry tables that exist only for the harness |
| Amounts as `numeric` in PostgreSQL and `Decimal` in Python | Integer minor units | Both are correct - the actual rule is never float. `numeric` is exact decimal, reads naturally, and matches the column names. The place a float really gets in is JSON transport, so amounts cross that boundary as strings |
| Its own harness | Reuse `evaluaters/eval-harness` | That harness measures a model on cases, scored by pluggable scorers over raw text. This one measures a whole pipeline, field by field, with line-item set matching that has no meaning there. Reusing it would bend both and couple two portfolio projects so a reader of either README needs the other. What is worth copying is its shape: append-only runs, raw output preserved, detail on every result, the model recorded on the run |
| Validation rules written after the first ten documents | Rules designed up front | Rules written in advance catch imagined failures. Ten documents through a pipeline with no rules produces a list of how this model actually fails on these documents, and the rules that come out of that list catch something |
| Server-rendered templates for the review queue | React, Angular | It has to run from PowerShell with no Node build step and deploy as one process. A queue, a viewer and a form do not need a framework. The API exists either way, so it can be rebuilt against one later |
| Background task, no broker | Celery or similar from the start | `POST /documents` returns immediately and `status` is how a caller finds out. A broker earns its place when retry needs to survive a restart, and saying that in an interview is better than having one nobody can justify |
| PostgreSQL | SQLite | The schema work is part of what this demonstrates, and the deployment story assumes a real database |
| Invoices only, at first | Invoices plus bills of lading plus purchase orders | Three half-working extractors produce no measurable accuracy for any of them. `doc_type` is the hook; the claim that it generalised waits until a second type actually runs |
| Arithmetic checked in Python | Ask the model to check its own totals | A model asked whether its own answer adds up agrees with itself. A rule that was written down can be read, tested and disagreed with |
| Composite confidence, model self-report weighted least | A threshold on model-reported confidence | Confidently wrong is the failure mode being designed around. Populated required fields and passing arithmetic are certain; the model's opinion of itself is not |
| The claim and the accepted record in separate tables | One row, updated on correction | A correction that overwrites the model's answer destroys the measurement, and destroys the labelled example the correction just created |
| `failed` separate from `rejected` | One terminal failure status | One is the system's fault, one is a person's decision. Collapsing them hides operational problems inside business outcomes |
| The harness drives the real pipeline | A harness that calls the provider directly with the same prompt | A harness that reimplements extraction measures the reimplementation, and drifts the moment the system changes |
| Synthetic and public documents only | Real invoices with the identifying details removed | Not worth the risk, and redaction is never as complete as it looks. Generated invoices are easy to produce and can be made to fail in chosen ways, which is better for the corpus anyway |
| Top-level folder, not inside `evaluaters/` | A third sibling next to eval-harness and triage-agent | This is a full system with its own front door and it is the one a reader should land on |
| The name mailman | formfeed, conduit, ledgerline | It says what the thing does: receives what arrives, sorts it, delivers it |

## Still open

Full list in [00-plan.md](00-plan.md). The ones that will bite first:

- **What the required fields are.** A long required list sends everything to review; a short
  one lets incomplete records through. First real design decision, and it lands in stage 2.
- **What the expected invoice-number format is.** The rule needs one and a real corpus has
  several. It may have to be per vendor, which makes it a vendor column.
- **How scans with no text layer are handled.** Page image to a vision model, or OCR first.
  Affects cost and the shape of ingestion. Deferred until after the first ten documents.
- **How line items are matched between extraction and label.** Order is not guaranteed. When
  the matching itself fails, that has to be visible rather than reported as a wrong amount.
- **Whether `status_history` as jsonb holds.** Seven tables is the target and jsonb keeps the
  line. If querying time-in-status gets awkward, an eighth table is the honest answer and
  should be taken rather than worked around.
- **Hosting.** Now part of the deliverable rather than a nice-to-have, because the link is
  what goes on an application. Three separate questions, and only the first is about money:
  what a container plus a hosted PostgreSQL actually costs now that free database tiers have
  got worse; whether the hosted database ships seeded, since a link that opens on an empty
  queue demonstrates nothing; and what a visitor is allowed to do, because an open upload box
  on a public link is an open invoice for provider tokens. To be discussed once there is
  something running.

## Things to hold onto

- **Record the baseline before changing anything.** A baseline taken after the first
  improvement is not one.
- Report the count behind every percentage. Thirty to forty documents is a small corpus and
  a two-document movement is noise. Saying so in the README is worth more than the number.
- Keep the dead ends. "Retrieval did not help at this corpus size" is a stronger README line
  than a third improvement, because it shows the harness was used to decide something rather
  than to confirm a decision already made.
- `/metrics` is small and pays off out of proportion to its size, in the README and in an
  interview. Counts by status and the auto-approval rate.
- The corrections log closes the loop. Every field a reviewer fixes is a hand-verified right
  answer produced by work that had to happen anyway, and `field_path` uses the same dotted
  paths the harness uses, on purpose, so it can become an expected value without translation.
- The generator emits the labels file with the document. Ground truth by construction is what
  makes it safe to build the corpus after the pipeline instead of before it.
- Commit as the work happens, with real messages. The history is on display.
- No employer or client document, in the repository or through the pipeline. Not a
  preference.

## Relationship to the rest of the repo

`../evaluaters/eval-harness` and `../evaluaters/triage-agent` are the other two projects in
this direction. Between them the three cover measuring a model, acting on a model's output
safely, and putting a model inside a working system. They stand alone and none imports
another.

This project breaks the portfolio's usual convention of a single-file static HTML app, for
the same reason `fallacysuspect` does: it needs a backend and a database. The `requirements/`
folder convention it does follow.

## Session log

Appended as work happens. Newest last.

### 2026-08-25 - spec written

First pass. Name chosen from a shortlist. Placement decided: top-level folder, its own
harness. Review UI decided: server-rendered, on the constraint that it has to run from
PowerShell and host later without a build step. All seven documents written. No code.

### 2026-08-25 - spec reconciled against the concrete design

A concrete seven-table schema, an API surface and a build sequence arrived and were adopted
over the first pass wherever they differed. What changed:

- **Thirteen tables down to seven.** `renditions`, `review_tasks`, `document_events` and the
  three `eval_*` tables are gone. Rationale for each is in the decisions table above.
- **The status flow changed.** Now `received -> extracting -> extracted -> validated ->
  (auto_approved | needs_review) -> approved | rejected`, plus `failed`. `extracting` is new
  and makes the in-flight state visible. `auto_approved` and `approved` are deliberately
  separate so the auto-approval rate is measurable from the history rather than inferred.
- **Money changed from integer minor units to `numeric` / `Decimal`.** The first pass
  overstated the case for minor units. The real rule is never float, and `numeric` satisfies
  it while reading better. JSON transport carries amounts as strings, which is where a float
  actually gets in.
- **The build order inverted at the front.** The first pass had the labelled corpus as stage
  0, before any code. The adopted order runs ten documents through first, uses the failures
  to generate the validation rules, and builds the corpus later. The usual objection - labels
  written after seeing model output are worthless - does not apply, because the generator
  emits the labels with the document.
- **The API surface is now fixed** and documented in [03-architecture.md](03-architecture.md),
  including `GET /metrics`.
- **Stack decided:** FastAPI, Docker Compose, Alembic, pdfplumber, Pydantic, pytest.
- **Timeline removed** from every document at the user's request. Stages are dependency
  ordered and carry no dates.
- **Added:** the working agreement about staying close to the code, `NOTES.md` by hand, and
  committing as the work happens rather than squashing.

Three smaller things dropped or resolved in the merge, recorded so they are not
re-introduced by accident:

- **The watched folder is gone.** The API surface is upload-only, and a second ingestion
  path with no endpoint behind it was carrying no weight.
- **The content hash on `documents` is gone**, and with it "the same file cannot be uploaded
  twice". The adopted schema has no hash column. The duplicate that actually costs money -
  the same invoice number recorded twice for a vendor - is caught by the unique constraint
  and by a rule. If re-uploading the same PDF becomes annoying in practice, a
  `content_sha256` column is a cheap addition and the shape does not fight it.
- **Unsupported documents stay in the corpus.** Spreadsheets and scans without a text layer
  are not handled at first. They still go in the corpus, and the harness reports them as
  unsupported rather than as wrong. An unsupported count visible in every run is a roadmap;
  a document quietly kept out of the corpus is a forgotten TODO.

Still no code. Next: stage 0, the scaffold.

### 2026-08-25 - reordered around a running demo

The stated goal was made explicit: **a system that runs, hosted, with a link that can go on
a job application.** Working to a certain extent beats designed thoroughly and half-built.
Testing happens in PowerShell. Hosting gets discussed once there is something running.

What changed:

- **The review queue moved from stage 9 to stage 7**, ahead of the corpus and the baseline.
  It is the demo, and it is also the tool for looking at extractions while the corpus is
  assembled - doing that against jsonb in a database client is miserable work, and miserable
  work gets cut short.
- **A gate replaced the ordering that used to protect the measurement.** The old plan kept
  the UI last so it could not eat the project. The new plan keeps it bare: no styling, no
  second screen, no deployment, until the stage 8 baseline is recorded. The risk is the same
  and it is now handled explicitly rather than structurally.
- **Stages renumbered.** Measurement is now 8 (corpus and baseline) and 9 (iteration).
  Hosting and the README are 10. MCP and AWS stay optional at 11 and 12.
- **Every stage now states what it ends in and how to check it from PowerShell.**
  [05-tasks.md](05-tasks.md) opens with the commands. Two PowerShell 5.1 facts are written
  down there because they will otherwise waste an evening: `Invoke-RestMethod` has no `-Form`
  parameter, so uploads go through `curl.exe`; and `ConvertTo-Json` defaults to a depth of 2
  and will silently flatten an extraction, so it always needs `-Depth 10`.
- **Hosting was promoted from a nice-to-have to part of the definition of done**, and split
  into the three questions it actually is: what it costs, whether the demo database ships
  seeded, and what a visitor is allowed to do. An open upload box on a public link is an open
  invoice for provider tokens.
- **`/docs` noted as a free demo surface.** FastAPI generates it, and it is something that
  can be shown from stage 2 onward, well before the queue exists.

Nothing was dropped from the measurement work. Stage 8 is unchanged and stage 9 is
unchanged; they simply come after something demonstrable rather than before it.

Still no code. Next: stage 0, the scaffold.

### 2026-09-01 - stage 0 built and verified

**Stage 0 is done.** The scaffold runs. Verified end to end, not just written:

- `docker compose up -d --build` brings up PostgreSQL 16 and the API.
- `alembic upgrade head` creates all seven tables plus `alembic_version`.
- `GET /health` returns 200 with `{"status":"ok","database":"ok"}`.
- Stopping the database makes `/health` return **503** with `database: unreachable`, then it
  returns to 200 when the database comes back. The health check was deliberately tested in
  its failing direction, because one that only proves the web server started is worth very
  little.
- `pytest -q`: 6 passed, in the container and on the host.

Standing instruction recorded this session, and now written into this file as **How this
file is maintained**: nothing here is erased, everything is superseded, the session log is
append only, and every session appends an entry even if it changed nothing. This file is the
core of the project's continuity.

Decisions taken while building, none of which were in the spec:

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| The migration is hand-written | `alembic revision --autogenerate` | The constraints that carry the design - the status CHECK, the duplicate-invoice unique key, the index behind the queue query - are visible in the migration rather than implied by the models. It is also the difference between knowing Alembic and knowing the autogenerate button |
| `status` is `text` with a CHECK constraint | A native PostgreSQL ENUM type | An ENUM is a migration to add a value to. A CHECK lists the legal statuses in one readable place and still makes the database reject an unknown one. The list lives in `mailman/status.py` and the constraint is generated from it, so they cannot drift |
| The API waits on a database healthcheck | `depends_on` alone | `depends_on` waits for the container to start, not for PostgreSQL to accept connections. Without the healthcheck the first run races and looks like a broken build |
| `/health` checks the database, not just the process | Returning `{"ok": true}` | The thing that actually breaks is the connection. It returns 503 when the database is unreachable, and it reports the exception class rather than the message, because a connection error can carry the connection string and a connection string can carry a password |
| The provider SDK and pdfplumber are not in `requirements.txt` yet | Installing everything up front | Each stage installs what it uses. An early stage is then never blocked on a dependency it does not need, and the dependency list reads as a history of what the project actually required |
| Source is bind-mounted in Compose with `--reload` | Rebuilding the image to see a change | An edit is picked up by a restart. The image still builds from scratch cleanly, which is what deployment will use |

### 2026-09-01 - two working rules corrected

Both of these came from the author after stage 0 was already committed, and both change how
future sessions should behave.

**`NOTES.md` may be appended to by tooling.** The earlier reading of "kept by hand" was too
strict: it had been taken to mean nothing may write to the file at all. The actual rule is
softer and more useful - the *facts* can be written down by whoever is at the keyboard,
because a fact recorded late is usually a fact lost, and the running record of what was tried
and what the numbers did is worth more complete than pure. The *judgement* stays the author's:
what was surprising, what it meant, what to do next. That half is the record no tool can
produce and it is where the credibility lives. Updated in
[00-plan.md](00-plan.md), [05-tasks.md](05-tasks.md) and this file. A stage 0 entry was
added to `NOTES.md` recording what was built, what was verified, and the two things that
broke, with the reflection left open.

**No commits without being asked.** Committing is the author's, always. The instruction
arrived after two commits had already been made this session - `40b6f83` (the scaffold) and
`e351c0d` (the plan reorder), both on `main`. They were made on the strength of the project's
own "commit as the work happens" habit, which was the wrong thing to infer an authorisation
from: that habit describes how the author works, not a standing permission. The commits stand
unless the author says otherwise; the rule from here is that work is left in the working tree
and the author decides what becomes a commit and when.

The "commit as the work happens, with real messages" habit stays in [05-tasks.md](05-tasks.md)
because it is still the right habit for this project. It is the author's habit to keep, not
an instruction to anyone else.

### 2026-09-01 - the front door was a 404

Clicking the mapped port in Docker Desktop opens `http://localhost:8000/`, and nothing was
routed there. `/health`, `/docs`, `/redoc` and `/openapi.json` all worked; the bare host
returned 404, which reads as a broken build when the build is fine.

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| `GET /` redirects to `/docs` | Leaving `/` unrouted; or building a landing page now | One line, no interface built ahead of stage 7, and the port link lands somewhere useful. The generated docs are a real demo surface on their own at this stage. **Stage 7 should repoint `/` at the review queue** - that is the page a visitor should land on |

A test was added asserting `/` returns a redirect to `/docs`, so the front door cannot
quietly disappear in a later refactor. Seven tests now pass.

The general lesson is worth keeping for a project whose purpose is being shown to someone:
the system was working and the default landing page said otherwise. The front door is not a
detail.

### 2026-09-01 - stage 1 built and verified

**Stage 1 is done.** A PDF can be uploaded and comes back with an id. Verified by uploading
real files rather than only by test:

| Upload | Result |
| --- | --- |
| PDF with a text layer | 201, `received`, text stored beside the original |
| PDF with no text layer | 201, `failed`, reason names the page count and says "probably a scan" |
| Spreadsheet | 415, nothing stored |
| PDF renamed `.xlsx` | 201, `application/pdf`, ingested normally |
| Unknown document id | 404 |

32 tests pass. New modules: `storage.py`, `media.py`, `transitions.py`, `ingest.py`,
`schemas.py`, `api/documents.py`.

Decisions taken while building:

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| A successful document is left at `received` | Moving it to `extracting` | Caught while writing it: there is no extractor until stage 2, so a document parked in `extracting` would sit there forever. A status column that says something is happening when nothing is is a lie, and the state machine is the part of this system that has to be trustworthy |
| `received -> failed` added to the transition map | Only `extracting -> failed` | A file that cannot be prepared at all - no text layer, a corrupt PDF - fails before extraction is ever attempted. It needed its own edge |
| An unreadable **type** is refused with 415 and nothing is stored; an unreadable **PDF** is stored and moved to `failed` | Treating both the same way | A spreadsheet is something the sender should be told about now. A PDF that will not parse is a document the pipeline is meant to handle one day, and its bytes are exactly what someone will want to look at. A visible `failed` count is a roadmap; a refused-and-forgotten upload is not |
| The storage key's extension comes from the **detected type** | Taking it from the uploaded filename | Found by looking at the store after a real upload: a PDF sent as `liar.xlsx` had been written as `original.xlsx`. The store should say what the file is, not repeat what the sender claimed, and it keeps an attacker-controlled string out of the path entirely |
| Byte signatures rather than `python-magic` | libmagic | Another native dependency on Windows for what is a handful of prefixes here |
| `status_history` is reassigned, never appended in place | `document.status_history.append(...)` | SQLAlchemy does not track mutation inside a JSONB value. An in-place append writes nothing and the history silently stays empty - a bug only found when someone finally needs the history |
| Bytes are written before the row is inserted, and before the text is attempted | Row first, or text first | An orphan blob is harmless; a row pointing at bytes that are not there is a broken record. And the document that failed to parse is exactly the one whose bytes will be wanted |
| Test PDFs are built by hand in `conftest.py` | Adding a PDF-writing library | Two test files are not worth a dependency the running system never uses. The real invoice generator arrives in stage 3, where it is the point |
| Test sessions roll back, including across commits | A separate test database | The session joins an outer transaction with `join_transaction_mode="create_savepoint"`, so code under test can commit normally and the database is left as it was found. The fixture skips when there is no database, so the suite still runs on a machine with nothing up |

One thing that cost time and is worth remembering: the connectivity probe in the test fixture
autobegins a transaction, so the explicit `connection.begin()` after it raised "this
connection has already initialized a Transaction". A `rollback()` between them fixes it.

### 2026-09-01 - stage 2 built (not yet run for real)

Extraction is implemented and covered by 70 tests against a fake extractor. **No live API
call has been made** - `ANTHROPIC_API_KEY` is not set - so stage 2 stays open until an
invoice has actually been through a model.

New modules: `parsing.py`, `invoice.py`, `prompts.py`, `extractor.py`, `pipeline.py`.

**A real bug, found by running it rather than by testing it.** With no API key, the SDK
raises `TypeError` at client construction. That was not one of the handled exceptions, so
the background task died *after* the document had been moved to `extracting` - and the
document sat there permanently, in a state nothing could move it out of and no operator
could explain. The specific fix is a credentials check with a readable message. The
structural fix matters more: `extract_document` now catches **any** exception, writes a
failure row and moves the document to `failed`. A state machine whose transitions can be
interrupted by an exception is not a state machine, and this is exactly the hole that
`status_history` exists to make visible.

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Amounts and dates cross the wire as **strings**, as printed | Asking the model for numbers and dates | Two reasons. A float in JSON is how money loses a cent. And a model forced to emit a number has to invent one when it cannot read the field, which destroys the difference between "could not read this" and "this is zero" - and that difference is one of the signals that sends a document to review |
| The model is told not to calculate anything | Letting it compute a missing subtotal | A computed value and a read value are indistinguishable afterwards. One of the validation rules is "the total matches the total printed on the document", and it cannot work if the model helpfully does the arithmetic |
| Structured outputs via `messages.parse(output_format=...)` | A raw JSON schema, or free text plus a parser | One Pydantic definition is the output schema, the parse target and the thing the rules read. Three uses, one definition, so they cannot drift |
| Server-side refusal fallbacks deliberately **not** enabled | `fallbacks: "default"`, which the SDK guidance suggests by default | Every extraction row records `model_name`, and the harness compares runs by it. A server-side fallback would silently answer with a different model while the row said otherwise, which corrupts the measurement this project exists to produce. A refusal is instead recorded as its own failure kind. Worth revisiting if refusals ever actually happen on invoices |
| Four failure kinds, kept apart | One `ExtractionError` | `malformed`, `missing_fields`, `refused` and `unavailable` have different causes and different fixes, and the harness needs to count them separately. A fifth, `internal`, covers the unexpected |
| SDK retries rather than a hand-rolled backoff loop | Writing the retry loop in the extractor | The SDK honours `Retry-After`, which hand-rolled backoff usually gets wrong. The retry policy is still owned by the extractor - it sets `max_retries` and `timeout` explicitly rather than inheriting defaults by accident |
| A crude `confidence` now, labelled as provisional | Leaving the column null until stage 5 | The column gets exercised and the shape is proven. It is commented as not something to route on, and stage 5 replaces it with a composite whose threshold comes from a measurement |
| `claude-opus-5` as the default extraction model | A cheaper tier for a high-volume task | It is the baseline. Stage 9 tries other models *with the harness running*, so the choice is made from a measured accuracy-and-cost tradeoff rather than from an assumption about which is good enough |

One consequence worth noting for stage 8: structured outputs make the `malformed` failure
nearly impossible, because the API constrains the shape. That is right for production and
awkward for measurement - the harness will report close to zero malformed responses, which
says more about the constraint than about the model. The sibling project
`../evaluaters/eval-harness` deliberately does the opposite for exactly this reason.

### 2026-09-01 - no API keys: the extractor becomes something we own

**The premise changed.** No API keys will be used, so the pipeline cannot depend on a hosted
model. Where machine learning is involved, training happens in a Google Colab notebook.

This is the same call already made on `../fallacysuspect`, and for the same reason: a
portfolio project that costs money per request is one nobody can leave running.

It is worth being clear that this makes the project **better**, not merely cheaper. The
original story was "an LLM inside a real system", which is a story thousands of people can
tell. The story now is: a deterministic baseline, a model trained on data labelled by
construction, and an evaluation harness that says which one is actually better and by how
much. That is a harder thing to build and a much harder thing to fake.

**Three extractors, one protocol:**

| Extractor | Needs | Role |
| --- | --- | --- |
| `heuristic` | nothing | **The default and the deployable one.** Regular expressions and layout rules. The baseline every other approach has to beat |
| `trained` | local weights (~250 MB) | A token classifier trained on Colab's free GPU. Free to run, too large for git and for a free hosting tier's memory - so it is the local and showcase path |
| `anthropic` | a key, and money | Kept as a comparison point, not as a dependency. Not the default and never required |

Switching between them is one setting, `MAILMAN_EXTRACTOR`. Nothing in the pipeline, the
rules, the review queue or the harness knows which one produced an extraction - they read
`model_name` on the row. **The Extractor protocol was written in stage 2 for exactly this
reason, before there was any second implementation to justify it, and it paid for itself
within a day.**

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| A heuristic extractor is the default | Requiring the trained model | It runs on a clean checkout with no key, no weights, no GPU and no network, in about 17ms. "It runs" was the stated goal, and this is what makes that true for anyone who clones the repository |
| Token classification (BIO tagging) | A local generative model, or Donut-style image-to-JSON | The pipeline already has the text layer, and every field wanted is a span physically printed on the page. A tagger returns *where* it found a value, so a returned value came from the document - it cannot invent an invoice number that was never printed. That removes a class of failure rather than defending against it |
| DistilBERT, text only | LayoutLMv3 with bounding boxes | Smaller, trains in minutes on a free T4, and serves on CPU in the container - which matters, because there is no GPU in the deployment. LayoutLM is the real upgrade and pdfplumber already provides the bounding boxes it needs; it is written down as the next step rather than done now |
| Training labels generated, not hand-made | Hand-labelling a training set | The generator knows what it printed, so labels are attached as the text is written. Its weakness is stated in the notebook and belongs in the README: a model trained only on generated invoices has learned one author's idea of a layout |
| The Anthropic extractor is kept | Deleting it | It is a comparison point, and the harness measuring "what a hosted frontier model gets" against "what my own trained model gets" is a genuinely interesting number. It is not the default and nothing depends on it |
| Weights are gitignored | Committing them, or Git LFS | ~250 MB, over GitHub's per-file limit, and rebuildable from the notebook in minutes. `models/` is ignored |

**Consequence for stage 8.** The harness now has something much better to compare than two
prompts: three real extractors on the same corpus, with cost and latency alongside accuracy.
The heuristic runs in 17ms and costs nothing; that is the bar. If the trained model does not
clear it by a margin worth the 250 MB, that result is worth reporting honestly rather than
burying.

**Consequence for stage 10.** Hosting gets easier and cheaper. The deployed system needs no
key, no GPU and no provider account, so a public link costs whatever the container and the
database cost and nothing per visitor. The open-upload-box problem from the earlier hosting
note largely goes away with it.

### 2026-09-01 - the notebook now hands over a self-describing model

The export section of `notebooks/train_extractor.ipynb` was extended so a training run
produces everything needed at the other end rather than just weights.

What the export now does:

1. Saves the model and tokenizer to `models/extractor/`.
2. Writes `mailman_model.json` beside them - the label set, the base model, the training set
   size, whether any real documents were in it, the epoch count, the overall F1 and the full
   per-field table, plus the caveats that have to travel with those numbers.
3. **Verifies before zipping.** It asserts the required files are present, then reloads the
   model from disk on CPU - the way the container will - and confirms it still tags a
   document. A 250 MB download that turns out to be missing a tokenizer file is 250 MB of
   wasted time and a confusing failure on the other machine.
4. Zips, prints the size, and starts the download automatically, with a Google Drive
   fallback for when a browser blocks a large transfer or the connection drops.
5. Prints two blocks to copy: the PowerShell commands for the machine running mailman, and
   a formatted per-field table for `NOTES.md`.

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| A `mailman_model.json` manifest ships with the weights | Recording the metrics in the notebook output only | A notebook output is closed and lost. Numbers that cannot be cited later are not evidence, and the weights are the thing that gets moved between machines |
| `TrainedExtractor` **refuses** to load weights whose label set disagrees with the code | Loading them and hoping | Retraining with a changed label set and dropping the weights in place would give an extractor that quietly tags the wrong fields, with nothing downstream noticing. This is the failure that would be hardest to spot and easiest to prevent |
| A missing manifest logs a warning but still loads | Refusing without one | Weights from elsewhere are still usable; their provenance is simply unknown, and saying so in the log is proportionate |
| `model_name` becomes `trained:extractor@2026-09-14` | `trained:extractor` | A stored extraction should point at the training run behind it, not just at a directory whose contents may since have been replaced |
| Verification reloads on CPU specifically | Trusting the in-memory model | The container has no GPU. Testing the path the deployment actually uses is the only test worth running here |
| Forward slashes in the printed PowerShell commands | Backslashes | PowerShell and `curl.exe` both accept them on Windows, and it keeps the cell free of escaping that would have to survive an f-string, a notebook file and a copy-paste. It had already been got wrong twice |

Five tests cover the handover without needing any weights: the BIO label set matches the
field list, a missing model explains how to get one, a mismatched label set is refused, a
matching manifest names the training run, and weights with no manifest still load. 84 tests
pass.

### 2026-09-01 - public training data: what is actually available

Looked into replacing generated-only training data with real documents. Findings, so this
does not have to be researched again:

| Dataset | What it is | Fit for mailman |
| --- | --- | --- |
| **DocILE** (Rossum/CTU) | 6.7k annotated real business documents, 100k synthetic, ~1M unlabeled. 55 annotation classes. Two tracks: KILE (field extraction) and **LIR (line item recognition)**. Ships pre-computed DocTR OCR with word boxes in relative coordinates | **The best fit by a distance.** It is invoices rather than receipts, and it is the only one with real line-item grouping - which is the part of this pipeline that is hardest and most valuable |
| **CORD** (NAVER CLOVA) | ~11k Indonesian receipts with line-item annotations - name, quantity, unit price, price, discount | Good for line items, easy to get from HuggingFace. Receipts, not invoices, and a single regional layout |
| **SROIE** (ICDAR 2019) | ~1k scanned receipts | Only four fields - company, date, address, total. No line items. Thin for this |
| **FUNSD / XFUND** | 199 scanned forms, question/answer/header linking | Form understanding, not invoices. Wrong task |
| Kaggle invoice sets | Various | Mostly synthetic themselves, often unlabelled, provenance usually unclear. The primary sources above are better precisely because their terms and origins are knowable |

**Licence caution, and it matters here.** The MIT badge on the DocILE repository covers the
**code**. The dataset is obtained with a registration token and carries its own terms, which
have to be read before anything derived from it goes into a public repository. Given this
project already has a hard rule about whose documents may exist in it, the same care applies
to a public dataset: cite it, do not redistribute it, and keep the download out of git.

**Two pieces of work this implies, and they are the same piece of work.** These datasets are
images with word boxes, not a PDF text layer. Using them means consuming their OCR output -
which is exactly the input LayoutLMv3 needs. So "train on real documents" and "upgrade from
DistilBERT to a layout-aware model" collapse into one change rather than two.

**The discipline that protects the numbers:** the stage 8 evaluation corpus must contain no
document the model was trained on. Public data makes that easy to get wrong, because the
same set is the obvious source for both. Split first, then train.

Not started. The notebook still trains on generated invoices only, and says so.

### 2026-09-01 - correction and recommendation on training data

**Correction to the entry above: CORD's public release is 1,000 examples, not ~11k.** The
11k figure is from the paper; what is actually downloadable as `naver-clova-ix/cord-v2` is
800 train / 100 validation / 100 test. Licence **CC-BY-4.0** - the cleanest of any set here,
commercial use permitted with attribution. Each example carries the receipt image, a
ground-truth JSON with menu lines (name, count, unit price, price) plus subtotal/tax/total,
and word-level OCR with bounding boxes.

That changes the balance. Set against DocILE's 6.7k annotated real business documents, CORD
is roughly an eighth the size and in the wrong genre - Indonesian restaurant receipts rather
than business invoices.

**Recommendation: submit the DocILE form.** The reasoning:

- It is the only public set that is actually **invoices**. CORD is receipts, and a model
  trained on restaurant receipts is being asked to transfer across both layout and language.
- 6.7k real annotated documents against CORD's 800.
- It has line-item **grouping** (the LIR track), which is the hardest part of this pipeline
  and the part with the most value in it.
- The form is a one-time cost of a couple of minutes. **The conversion work - 55 classes
  down to 13, boxes to words, split discipline - is the same either way**, so avoiding the
  form saves the two minutes and costs the better dataset. That is a bad trade.

**Use CORD while waiting, and treat it as a pipeline test rather than as final training
data.** It is one `load_dataset` call and a permissive licence, so it is the cheapest way to
prove the whole path works - label mapping, box handling, train/eval separation - before the
DocILE token arrives. Whether receipt data actually helps invoice extraction is a question
for the harness, not an assumption; it may well be that generated invoices plus DocILE beats
generated plus CORD, and that is a measurable claim rather than a guess.

Still not started, and still behind stage 3 in the queue.

### 2026-09-01 - DocILE's terms, and a reversal

The DocILE access form was read in full. **It substantially reverses the recommendation in
the entry above**, which was made before the terms were seen.

The terms, in the parts that bite:

- **Non-commercial research purposes only.**
- **"You must not provide or otherwise allow access to the content to any third party."**
- A declaration to **not distribute it**, and to **delete the content** if and when
  permission ends.
- Permission can be withdrawn for non-compliance.

Set that against what this project is for. The definition of done in
[00-plan.md](00-plan.md) includes **a public link that goes on a job application**. A hosted
demo seeded with DocILE documents would be allowing third-party access to the content, which
the terms forbid outright. Publishing weights trained on it is at best unclear - weights are
arguably not "the content", but "all rights not expressly granted are reserved" is broad
enough that it is not a question to be confident about. And "non-commercial research" sits
awkwardly against a portfolio whose honest purpose is getting hired.

**Revised recommendation: train on what can be shipped, and treat DocILE as a private
benchmark rather than as training data.**

| Use | Dataset | Why it is clean |
| --- | --- | --- |
| **Training** | Generated invoices + **CORD** (CC-BY-4.0) | CC-BY-4.0 permits commercial use and redistribution with attribution. Weights can be published, a demo can be public, nothing has to be deleted later |
| **Evaluation only, locally** | DocILE, if the form is submitted | Reporting a measured number is not distributing content. The documents never leave the machine, no model trained on them is published, and nothing derived from them is hosted |

That split also has a virtue beyond compliance: **evaluating against a recognised public
benchmark is exactly what makes a README number checkable.** "89% on invoices I generated" is
weak. "89% on the DocILE evaluation set" is a claim someone else can reproduce.

**If the form is submitted, the answers have to be true**, which means accepting up front
that nothing derived from DocILE gets published or hosted. If that constraint is unwelcome,
the honest thing is not to submit it - CORD plus generated data is a perfectly respectable
training set, and the caveat about genre is one the README can simply state.

The competition question on the form refers to ICDAR 2023 and CLEF 2023, both long past, so
the answer is No. Affiliation is "personal".

**Consequence if DocILE is not used at all:** nothing breaks. The trained extractor is the
showcase path, not the deployed one, and CORD plus generated invoices trains it perfectly
well. The gap between the heuristic and the trained model - the number this project actually
reports - does not depend on DocILE existing.

### 2026-09-01 - the full dataset landscape, sorted by licence

Searched further for sets whose terms survive the public-demo constraint. The licence is the
sorting key, not the size - a dataset that cannot be trained on and shipped is only useful
as a private benchmark.

**Usable for training, publishing weights, and hosting a demo:**

| Dataset | Licence | Size | Genre | Notes |
| --- | --- | --- | --- | --- |
| **Kaggle "High-Quality Invoice Images for OCR"** (mirrored as `Voxel51/high-quality-invoice-images-for-ocr`) | ODbL | **1,489 annotated** + 6,692 unannotated | **Invoices** | Annotations cover invoice number, dates, seller and client, **line items**, subtotal, tax, discount, total, payment details. **Synthetic** - but from a different generator than ours, which is exactly the layout diversity that matters |
| **CORD** (`naver-clova-ix/cord-v2`) | CC-BY-4.0 | 800 / 100 / 100 | Receipts | Real documents, real OCR noise, line items with quantity and unit price. Cleanest licence of the lot |

**Non-commercial - private benchmark only, never shipped:**

| Dataset | Licence | Size | Genre | Friction |
| --- | --- | --- | --- | --- |
| **DocILE** | Non-commercial, no distribution, delete on request | 6.7k real annotated | Invoices | Form and token, and permission can be withdrawn |
| **RealKIE - FCC Invoices** | CC-BY-NC 4.0 | 370 real | Political ad-buy invoices | **Direct download, no form, no delete-on-request clause.** 11 fields including line items |

RealKIE is one of five sets from Indico; the other four are contracts, filings and charity
reports, and are the wrong domain. DeepForm covers the same FCC ad-buy documents from the
journalism side; the underlying filings are US public records, but the useful annotations
are the ones RealKIE and DocILE added.

Rejected on fit rather than licence: SROIE (four fields, no line items), FUNSD and XFUND
(form understanding, wrong task), RVL-CDIP (classification only, no field labels).

**Revised recommendation, replacing the two entries above:**

- **Train on the Kaggle invoice set plus CORD, alongside our own generated invoices.** All
  three are shippable. That is three independent sources of layout - two synthesisers and
  one set of real photographed receipts - which is a materially better training mix than one
  generator, and none of it constrains the demo.
- **If a real-document benchmark is wanted, prefer RealKIE FCC Invoices over DocILE.** It is
  far smaller, but it is a direct download with no form, no token and no clause allowing
  permission to be withdrawn later. For a number quoted in a README, 370 real invoices is
  enough to be worth citing, and the reduced obligation is worth more here than the extra
  volume.

**Honest caveat that does not go away:** the Kaggle set is synthetic. Adding it does not let
the README claim the model was trained on real invoices - it lets it claim two independent
generators plus real receipts, which is a weaker but true statement. Only the non-commercial
sets are real invoices, and those cannot be trained on and shipped.

**ODbL note:** it permits commercial use and requires attribution; its share-alike clause
applies to derived *databases*. Model weights are very unlikely to count as one, but the
attribution requirement is real and belongs in the README.

### 2026-09-01 - what kind of invoice this system is for (PROPOSED, not yet confirmed)

Asked directly: what kind of invoices are we looking for. The answer determines the field
schema, the validation rules, the generator, the corpus and which dataset is worth having,
so it is written down here rather than left implicit.

**Proposed target: business-to-business accounts-payable supplier invoices.** A supplier
sends a bill to a company that has to pay it. That is the document the EDI work this project
grew out of was moving, it is the document the seven-table schema already assumes, and it is
the only genre where the existing validation rules mean anything - a vendor to resolve, a
buyer, an invoice number that must not repeat for that vendor, and arithmetic that has to
reconcile.

**The core profile - what should work:**

| Property | Core case |
| --- | --- |
| Origin | Digital-born PDF with a text layer |
| Parties | One vendor, one buyer, both named |
| Identifier | An invoice number, and often a PO or reference |
| Dates | Issue date, usually a due date |
| Currency | One currency per document, as a code or a symbol |
| Line items | 1 to 20, on one page, each with a description and an amount |
| Tax | A single rate applied once, or none at all |
| Arithmetic | Line items sum to a subtotal; subtotal plus tax equals a printed total |

**The variation that has to be covered, because it is where extraction breaks:**

- Label wording: "Invoice No." against "Inv #" against "Reference".
- Date formats, including the genuinely ambiguous `03/04/2026`.
- Decimal and thousands separators - `1,234.56` against `1.234,56`.
- A discount line, a freight or shipping line, a rounding line.
- Tax as a percentage of the subtotal, versus tax stated per line.
- A credit note: negative amounts, printed in parentheses or with a trailing minus.
- A table continuing across a page break.
- A second currency mentioned but not used - "prices in USD, payable in GBP".
- A document that is not an invoice at all.

**Explicitly out of scope, and it should stay that way until the core is measured:**

- Retail and restaurant **receipts**. No vendor-buyer relationship, no invoice number in the
  accounts-payable sense, no due date. A different document that happens to have line items.
- Utility bills, statements of account, purchase orders, bills of lading.
- Handwritten documents, and scans with no text layer - already rejected with a reason.
- Multi-page documents beyond a continuing line-item table.

**This changes the dataset assessment, and it is worth being explicit about why.** Measured
against the profile above:

- The **Kaggle invoice set** is a direct match. Its annotations carry invoice number, issue
  and due dates, seller *and* client, line items, subtotal, tax, discount and total - very
  nearly the field list this project already settled on.
- **CORD** is not. It is restaurant receipts: no invoice number, no buyer, no due date, no
  vendor-buyer relationship. It would teach a model line items and totals and nothing at all
  about half the fields, and its layouts are receipts rather than invoices.

So CORD's value is narrower than its licence made it look. It is worth including only for
line-item and total extraction, and possibly not worth the mapping work at all. **The Kaggle
invoice set plus our own generator is the stronger pairing**, and that is a change from the
recommendation in the entry above.

Status: proposed. Needs confirming before the generator in stage 3 is built against it,
because the generator is what encodes this profile in code.

### 2026-09-01 - correction: the HuggingFace mirror has lost the annotations

Checked the actual schema of `Voxel51/high-quality-invoice-images-for-ocr` through the
HuggingFace datasets-server before writing a loader against it. One config, one split, and
**one column: `image`.**

The annotations and the OCR text are not there. Voxel51 published it in FiftyOne format,
where labels live as FiftyOne sample fields, and the hub's automatic conversion to Parquet
kept the images and dropped everything else. `load_dataset("Voxel51/...")` therefore returns
invoice pictures and nothing to train against.

**This reverses the "use the HuggingFace mirror, it is easier" advice in the entry above.**
The mirror is the lossy copy. The annotations live in the original Kaggle download.

| Route | Gets the labels | Cost |
| --- | --- | --- |
| **Kaggle original** | **Yes** - JSON annotations and OCR text as files | A free Kaggle API token in Colab. One-time, about two minutes |
| FiftyOne `load_from_hub` | Probably - it is the format the labels were published in | Pulls FiftyOne, a large dependency, for one dataset |
| `datasets.load_dataset` on the mirror | **No** | Nothing, and it is worth nothing |

**Worth generalising from:** a mirror is not the dataset. Format conversions between
ecosystems drop what the target format has no place for, silently and without warning. The
schema check that caught this cost one request; discovering it after writing a loader and a
label mapping would have cost an evening.

**Where the data actually needs to be:** nowhere local. Colab downloads it, trains, and
returns a weights zip. The dataset is never committed, never redistributed, and never
touches the machine running mailman. The repository references it by identifier and carries
the ODbL attribution to the original author.

### 2026-09-01 - the Kaggle loader is in the notebook, and it was run before shipping

`notebooks/train_extractor.ipynb` is now 34 cells and has a section 1b that downloads the
Kaggle invoice set, inspects it, converts it and reports how much of it actually aligned.

The shape of it:

1. `USE_KAGGLE` toggle. Off, the notebook trains on generated invoices exactly as before.
2. Kaggle API token upload, then a download of
   `osamahosamabdellatif/high-quality-invoice-images-for-ocr`. The token is a one-time,
   two-minute setup and Colab does the downloading - the dataset never touches the machine
   running mailman, and never enters the repository.
3. **An inspection cell that prints the directory tree and one full annotation before
   anything is mapped.** Field names in someone else's dataset are not knowable in advance,
   and a mapping written from a guess fails silently: it trains, the loss falls, and the
   model learns nothing.
4. `FIELD_MAP`, a plain dictionary at the top of a cell, edited once against what step 3
   printed.
5. The converter, and **an alignment report per field**.

**Why the alignment report is the important part.** For generated invoices, labels are
attached as the text is written and are correct by construction. For external data there is
no choice but to match values back into the text, which is precisely the labelling method
the generator was designed to avoid. A value that cannot be found leaves its tokens tagged
`O`, which actively teaches the model that the field is absent. So the converter reports its
own hit rate per field, near-zero flags a broken mapping, and any document whose required
fields could not be aligned is **dropped rather than included with a missing label**.

**A real bug, found by running it rather than reading it.** A test harness executed the
notebook's own cells against a mock annotation with deliberate traps. On a line reading
`Freight 1 25.00 25.00`, the unit price and the amount are the same value: the unit price
claimed the first occurrence, the amount matched the same position, found it taken, and gave
up - so it went untagged. The model would have been taught that a line amount equal to its
unit price is not an amount. `find_span` now returns every occurrence and the tagger falls
through to the next unclaimed one. Verified: `LINE_AMOUNT` went from 1 to 2 on that document.

That is the fourth bug this project has found by running code rather than by testing it. The
pattern is consistent enough to be worth stating as a rule: **tests confirm what was thought
of; running the thing on realistic input finds what was not.**

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Inspect the annotation before mapping it | Writing `FIELD_MAP` from the dataset description | The description says what fields exist, not what the keys are called. A guessed mapping produces a 0% alignment rate that looks like bad data rather than a bad guess |
| Report alignment per field | Trusting the conversion | It is the only signal that distinguishes "this dataset does not have that field" from "the mapping names the wrong key" |
| Drop documents whose required fields did not align | Keeping them with the field untagged | A wrong label is worse than one fewer example. An untagged required field is a lesson that the field is not there |
| Match money loosely | Exact string comparison | The annotation says `1234.56` where the document prints `$1,234.56`. Exact matching would fail on every money field and read as a broken mapping |
| Header money fields matched from the end of the document | First occurrence | A grand total is usually also a line amount somewhere above it. The totals block is at the bottom |

### 2026-09-01 - the notebook broke on Colab: torch upgrade

First real run of the notebook failed at the training cell:

    RuntimeError: operator torchvision::nms does not exist
    ModuleNotFoundError: Could not import module 'Trainer'

**Cause: the install cell passed `torch --upgrade`.** Colab ships torch, torchvision and
torchaudio built against one another. Upgrading torch alone leaves torchvision bound to a
version that no longer exists, so its custom operators fail to register. transformers
imports torchvision lazily for image models, so nothing complains until something reaches
for `Trainer` - dozens of cells later, pointing at entirely the wrong thing.

Fixes applied:

| Change | Why |
| --- | --- |
| **`torch` removed from the install line.** Now `%pip install -q -U transformers datasets accelerate seqeval` | Colab's torch already has CUDA and is the one to use. Upgrading it is what broke this |
| **A version-check cell added immediately after the install** | Prints torch, torchvision and transformers versions, actually calls `torchvision.ops.nms`, and stops with a readable message if the two disagree. Three seconds, and it turns a confusing failure forty cells away into an obvious one here |
| **`TrainingArguments` asks the signature which keyword it wants** | transformers renamed `evaluation_strategy` to `eval_strategy`. Reading `inspect.signature` keeps the notebook working as Colab's images move on, without pinning a version that goes stale |
| **The Kaggle cell split, magics moved to the top level** | `%pip` and `!command` inside an indented block depend on IPython transforming a magic at depth. It usually works and is not worth depending on |

**A restart is required after this fix, not just a rerun.** The broken torchvision is already
loaded into the running session, so the fixed cell cannot help until Runtime -> Restart
session.

**The general point, and it is the same one as the mirror that lost its annotations:** the
error surfaced a long way from its cause. `Trainer` failing to import says nothing about a
torch upgrade eleven cells earlier. The version check exists so the next failure of this
shape announces itself where it happens.

Notebook is now 37 cells. The converter test was re-run afterwards and still passes.

### 2026-09-01 - the export check rejected a good export

The verification cell asserted on `special_tokens_map.json` and `vocab.txt` and failed on a
perfectly complete export. DistilBERT's **fast** tokenizer writes `tokenizer.json`, which
carries the vocabulary and the special tokens, so neither of those files is necessarily
written at all; recent transformers also folds `special_tokens_map.json` into
`tokenizer_config.json`.

The shallow fix is a better file list - either tokenizer flavour accepted, weights matched
against `.safetensors` or `.bin`.

**The real error was one of reasoning, and it is worth keeping.** The file list was a
**proxy** for "does this load", and the actual test - reload it from disk on CPU and see if
it still tags a document - was already three lines further down the same cell. A proxy check
placed in front of a real one can only do harm: it cannot pass anything the real check would
fail, and it can fail things the real check would pass. So the presence check is now a
warning that produces a readable message, and **the reload is the gate.**

Same failure mode as guessing `FIELD_MAP` without looking at the annotation, and as
asserting on a mirror's schema without reading it: **asserting on what a thing should look
like instead of testing what it does.**

### 2026-09-01 - the trained model arrived, scored 1.000, and does not work

First trained extractor is on disk: DistilBERT, 3,400 generated training documents, 600
held out, 6 epochs, **overall entity F1 1.000 - every field, precision and recall both
1.000**. `real_examples: 0`.

**A perfect score is not a result. It is a broken benchmark**, and here it was hiding a
model that does not work. Two separate causes, and both are worth keeping.

**Cause 1: train and test came from the same generator.** 3,400 and 600 documents drawn from
one generator with six vendors, four buyers and eight goods descriptions. The held-out split
is the same distribution, the same vocabulary and the same label wording. Nothing was
measured except memorisation.

**Cause 2, and the serious one: the metric scored a task the serving code does not
perform.** Training masked every continuation word-piece with -100, so the model was
supervised only on a word's first piece. Evaluation used the same masking and scored only
first pieces. Serving does something else - it reassembles pieces into spans - and a
continuation the model never learned to label predicts `O`, which ends the span.

Run against a document, the "perfect" model returned:

    invoice_number   "in"          (from INV-2026-0042)
    currency         "GB"          (from GBP)
    description      "##dget assembly"

**The project already had a rule against this** and it was not applied inside the notebook:
*the harness drives the real pipeline, because a harness that measures a copy measures the
copy.* The notebook measured the model; mailman serves the pipeline. Fixes:

| Fix | Where |
| --- | --- |
| Continuation pieces are **labelled**, not masked. `B-X` continues as `I-X` | notebook `encode()` |
| `aggregation_strategy="first"`, matching the labelling scheme the model is trained under | `mailman/trained.py` |
| **A serving-path cell** that runs the real aggregation pipeline over held-out documents and scores reassembled field values | notebook, directly after the per-field table |

`aggregation_strategy="first"` alone recovered `GBP`, `acme corp ltd` and `widget assembly`.
`invoice_number` stayed `"inv"` - that needs the retraining, because the model has to be
supervised on continuation pieces before a hyphenated identifier can survive reassembly.

**Document B is the number that matters.** An invoice in a layout the generator never
produced - different labels, European separators, a discount line, a currency code beside
the total:

| | Heuristic | Trained |
| --- | --- | --- |
| Result | Returns a record, several fields wrong (`invoice_number` = "Ref", subtotal misread) | **Fails outright** - `invoice_number` and `currency` not tagged at all |

A model reporting F1 1.000 cannot extract an invoice number from an invoice that does not
look like its training set. That sentence is the honest summary of this training run, and it
is worth far more in the README than the 1.000 would have been.

**Also fixed, found by the same comparison:** the heuristic read `Widget assembly 2 100.00
200.00` and returned a unit price of `2100.00`. Its money pattern allowed a space as a
thousands separator, so it merged the quantity and the unit price into one plausible-looking
wrong number. Space removed from the separator class when *finding* an amount on a line;
`parse_money` still handles spaces when parsing a value that has already been identified.
Finding is the ambiguous case, parsing is not.

**Two smaller things:** the export unzipped to `models/mailman-extractor` rather than
`models/extractor`, and `MAILMAN_EXTRACTOR` did not work at all - the settings field is
`extractor`, so pydantic-settings was reading plain `EXTRACTOR` while every document in the
project said otherwise. Both spellings are now accepted through `AliasChoices`, along with
`MAILMAN_MODEL_DIR`.

### 2026-09-01 - F1 stayed at 1.000 after the alignment fix, and that is not a metric bug

Retrained with continuation pieces labelled. Every epoch still reports F1 1.000, validation
loss down to 0.0005.

**The metric is not broken. The benchmark is trivial.** The generator draws from six
vendors, four buyers, eight goods descriptions and a handful of fixed label phrasings, and
the evaluation split is drawn from the same generator. The rule "the token after 'Invoice
Number:' is the invoice number" is learnable in one epoch, and an in-distribution split
cannot detect that memorisation is all that happened. A validation loss of 0.0005 on real
extraction would be extraordinary; on this data it is the expected outcome.

Two independent signals already said so before the retrain: the model returned `"in"` for
`INV-2026-0042` while scoring 1.000, and it failed outright on document B.

**Added: a shifted evaluation set (section 4b).** A second generator with a **disjoint
vocabulary** - no vendor, buyer, product or label phrase shared with training - plus date
and money formats the model has not seen. Same document type, nothing else in common. It
then runs the **real serving path** over both sets and prints:

    in-distribution X%   shifted Y%   gap X-Y%

**The gap is the result.** A small gap means the model learned the structure of an invoice.
A large gap means it learned this notebook, and the per-field F1 is noise.

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| A shifted generator with disjoint vocabulary | Trusting the random train/test split | A random split of one generator's output measures memorisation and calls it accuracy. Nothing about the split is held out except the specific rows |
| Shifted set built from the generator, not from external data | Waiting for the Kaggle set to be wired in | It costs nothing, needs no download and no licence, and it isolates one variable - vocabulary and wording - rather than changing the document source entirely. External data is still the better test and is still worth doing |
| Report the **gap**, not either number alone | Reporting the headline F1 | Neither number means much by itself. The distance between them is what says whether the model generalises |

Expect the shifted number to be far below 1.000. That is the point of measuring it, and a
low number here is a finding rather than a failure - it is the first honest thing this
training run will have produced.

### 2026-09-02 - retrained model, and the first honest comparison

Second trained extractor, with continuation word-pieces labelled. Manifest still reports
F1 1.000 and `real_examples: 0` - the Kaggle section did not run, and the token-level score
remains the trivial one. The interesting results came from running it.

**Two serving bugs fixed, both invisible to every metric:**

| Bug | Symptom | Fix |
| --- | --- | --- |
| The pipeline's reassembled `word` is lossy | `INV-2026-0042` came back as `inv - 2026 - 0042`, `Acme Corp Ltd` as `acme corp ltd`. The model is **uncased**, and detokenization inserts spaces around punctuation | Spans carry character offsets into the original text. Slice the source substring instead - it is what the document actually says |
| Model load was inside the latency measurement | 17,708 ms reported for every first document, milliseconds thereafter | Load happens once per process and is now outside the timer. 101 ms |

**Document A - a layout resembling the training data:**

| Field | Heuristic | Trained |
| --- | --- | --- |
| invoice_number | INV-2026-0042 | INV-2026-0042 |
| vendor_name | Acme Corp Ltd | Acme Corp Ltd |
| **buyer_name** | **None** - not attempted | **Orchard Foods** |
| dates, currency, totals, line items | correct | correct |
| latency | 9 ms | 101 ms |

The trained model wins on `buyer_name`, which the heuristic deliberately does not attempt
because no reliable rule finds it. That is a real result: it is the first thing the model
does that the rules cannot.

**Document B - a layout the generator never produced:**

| | Heuristic | Trained |
| --- | --- | --- |
| Outcome | Returns a record. `invoice_number` wrong ("Ref"), subtotal and tax misread | **Fails outright** - `total` and `currency` never tagged |

**This is the finding, and it should go in the README as it stands.** A model scoring F1
1.000 on its own generator's held-out split cannot find a total on an invoice written in an
unfamiliar layout, while eleven lines of regular expressions degrade gracefully and still
produce something. The heuristic is wrong in visible ways; the model is absent.

Neither is good enough yet, and that is the honest state. What it points at is unambiguous:
the model needs training data that is not from this generator. The Kaggle section exists,
was not run, and is now the highest-value next step - ahead of any further prompt or
architecture work.

Three tests added for offset slicing, including the fallback when a strategy omits offsets.
87 tests pass.

### 2026-09-02 - the shifted set worked, and said exactly what was wrong

Full run with the shifted evaluation in place. **This is the first genuinely informative
result the project has produced.**

    in-distribution 100.0%   shifted 40.7%   gap 59.3%

The per-field breakdown is the valuable part, because it says *what* was memorised:

| Collapsed on the shifted set | Survived |
| --- | --- |
| SUBTOTAL 0%, TAX 0%, TOTAL 0%, LINE_DESCRIPTION 0% | LINE_QUANTITY 99%, LINE_AMOUNT 98%, LINE_UNIT_PRICE 94%, BUYER_NAME 93% |
| INVOICE_NUMBER 18%, VENDOR_NAME 20.5%, ISSUE_DATE 14.5%, CURRENCY 33% | |

**The fields that survived are the ones identified by position** - the second, third and
fourth number in a table row. **The fields that hit zero are the ones keyed to a label
word.** Training printed `Subtotal`, `VAT` and `Total Due`; the shifted set printed
`Goods value`, `Duty` and `Balance now due`. The model learned a keyword lookup, not the
structure of a document.

That is a precise, actionable diagnosis, and it came from a measurement rather than a
suspicion. It is exactly what the harness is for.

**The Kaggle dataset has no annotations.** The download produced `0 json files, 8181 jpgs,
0 txt`. The "1,489 fully annotated samples with structured JSON metadata and raw OCR text"
came from the Voxel51 HuggingFace card, describing the FiftyOne dataset they built - not the
Kaggle artifact. So the annotations exist only inside the FiftyOne copy, which is the same
copy whose Parquet conversion dropped them.

**That is the third time this project has been misled by a description rather than the
artifact** - the mirror's schema, the export's file list, and now this. The inspector cell
was itself part of the problem: it counted `.json`, `.jpg` and `.txt` and reported "0 json
files" while saying nothing about what the 8,181 other files were. An inspector that only
looks for what it expects is not an inspector. It now counts every extension present and
says plainly when a download contains no labels at all.

The licence line printed at download time is **DbCL-1.0**, not ODbL as recorded earlier.

**Fixes applied:**

| Fix | Detail |
| --- | --- |
| Training vocabulary greatly enlarged | 6 vendors to 20, 8 goods to 22, 4 total-labels to 13, 3 date-labels to 11, plus subtotal and tax label lists, 5 table-header variants and 6 date formats. Four phrasings for a total is a lookup table; thirteen is something a model has to generalise over |
| Manifest carries the honest numbers | `serving_in_distribution`, `serving_shifted` and `generalisation_gap` now travel with the weights, not just the token-level F1 |
| Inspector counts every file type | And says explicitly when there are no annotations to map |

**A mistake made and caught while doing this.** The patch that enlarged the training
vocabulary also matched the shifted generator cell - `SHIFT_VENDORS` contains the substring
`VENDORS` - and overwrote it. Worse, the words added to training were taken *from the
shifted set*: `Our reference`, `Balance now due` and `Scaffold hire` had been shifted-only
vocabulary minutes earlier. Both errors have the same effect, which is that the held-out set
stops being held out and the measurement silently becomes worthless.

The shifted generator has been rewritten with vocabulary that appears nowhere else, and
there is now an **assertion** that the two phrase sets are disjoint rather than a comment
hoping they are. Both generators were executed to confirm it passes: 374 tokens overlap, of
which 42 contain a letter, all month names, currency codes and unavoidable words like
"Invoice".

**Next, in order:** retrain on the enlarged vocabulary and read the new gap - that single
number says whether label diversity was the problem. Real documents remain the better fix
and the Kaggle route is now closed; CORD and RealKIE are the remaining candidates.

### 2026-09-02 - the notebook validated as a program

Checked the notebook properly rather than by reading it. A notebook is a sequence of cells
sharing one namespace, so a name used in cell N must be bound by an earlier cell, and nothing
enforces that - losing or reordering a cell breaks it silently until someone runs the whole
thing top to bottom.

Written a validator that parses every cell, tracks what each one binds and reads, and reports
any name used before it is defined. It found one real bug, introduced by the inspector
rewrite two entries above:

**`json_files` no longer existed.** The old inspector defined it; the rewritten one built a
`candidates` list instead, and the converter cell still said `for json_path in json_files:`.
With `USE_KAGGLE = True` and annotations actually present, that is a `NameError` in the
middle of a run - and it would not have appeared on the last run, because the download had no
annotations and the loop never executed. A latent failure waiting for the dataset problem to
be solved.

Renamed to `annotation_files`, bound unconditionally at the top of the inspector so the
converter can reference it whether or not the download ran.

**Then ran the data pipeline for real**, everything short of the GPU work: both generators,
the disjointness assertion, the real tokenizer, and the label alignment. The alignment fix is
confirmed working on actual tokenized output -

    hal      B-VENDOR_NAME      in       B-INVOICE_NUMBER
    ##vor    I-VENDOR_NAME      ##v      I-INVOICE_NUMBER
    ##sen    I-VENDOR_NAME      -        I-INVOICE_NUMBER
                                202      I-INVOICE_NUMBER
                                ##6      I-INVOICE_NUMBER

25 labelled continuation pieces in one document, all carrying `I-` labels. Under the old
masking every one of those would have been `-100`, which is precisely why `INV-2026-0042`
came back as `inv`.

Final state: 42 cells, no syntax errors, every name bound before use, pure ASCII, data
pipeline runs end to end.

**Worth keeping as a habit:** the validator is twenty lines of `ast` and it found a bug that
three careful readings had missed. Reading a notebook is not checking it.
