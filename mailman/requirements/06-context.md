# mailman - Context and handoff

## Read this first

Nothing is built. As of 2026-08-25 this folder is the entire project.

**Stages 0 and 1 are done.** The scaffold runs, the seven tables exist, and a PDF can be
uploaded and comes back with an id, its text stored beside it. The current work is **stage 2
in [00-plan.md](00-plan.md): the first extraction.** A Pydantic invoice model as the
provider's output schema and the parse target, with malformed JSON, missing required fields
and timeouts handled as three different things.

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
