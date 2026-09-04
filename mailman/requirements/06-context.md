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
- **An entry per exchange, not per session.** Stated 2026-09-02: this file is what makes the
  work survive across many separate assistant instances, so it is updated after every prompt
  rather than at the end of a sitting. An instance that is interrupted between the work and
  the write-up has lost the work. Record what was asked, the reasoning, the alternatives that
  were turned down, and the exact changes - in as much detail as can be written down. A later
  reader with none of the context has to be able to reconstruct why, not just what.

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
| Credit notes are invoices with the signs reversed | Marking `04-credit-note` as `should_fail` and treating credit notes as out of scope; or deferring the call to stage 4 | One arrives in the same post, from the same vendor, against the same purchase order. Refusing it means a real document the system cannot file. Nothing downstream needed a special case, which is the argument rather than a lucky outcome: `parse_money` already read both negative conventions, and -100.00 plus -20.00 is still -120.00. The only new fact is that `total` can be negative, and no rule may assume otherwise |
| The corpus is compared field by field, and every document's own arithmetic is checked | Comparing the fields the run happens to print, and asserting counts where writing out the values is tedious | `08-two-page` was counted clean with the right number of line items and seven wrong amounts among them, because `line_item_count: 40` is a label that cannot fail on the content of a line. A corpus checked by counting agrees with whoever wrote the fix. The arithmetic check is the cheaper half - it needs no labels at all, and it found both of this session's problems in one pass |
| Corpus totals are computed from the corpus line items | Typing the totals block beside generated lines, as `02-many-lines` originally did | "Ground truth by construction" only covers the parts actually constructed. Twelve computed lines under three hand-typed totals is a hand-written answer key wearing a generator's clothes, and it put a document in the corpus that failed the first rule on the stage 4 list |
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
  makes it safe to build the corpus after the pipeline instead of before it - **but only for
  the parts genuinely constructed.** `02-many-lines` shipped with computed line items under a
  hand-typed totals block that disagreed with them by 182.00. Anything a label asserts should
  be derived from the same values the document is rendered from.
- **Compare the corpus field by field, and add the amounts up.** A count is a label that
  cannot fail on the content of a line: `08-two-page` was called clean with forty line items
  of which seven carried the wrong amount. The arithmetic self-check - lines to subtotal,
  subtotal plus tax to total, quantity times unit price to amount - needs no labels at all and
  catches the silent class of bug that every extraction fix so far has belonged to.
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

### 2026-09-02 - session close: state, and what to pick up next

Colab's GPU quota ran out mid-session. Nothing is blocked by it; the notebook now sizes
itself for whatever runtime it gets.

**Where the project actually is.**

| Stage | State |
| --- | --- |
| 0 Scaffold | Done |
| 1 Ingestion | Done |
| 2 Extraction | Done, keyless. `heuristic` is the default and needs nothing |
| 3 Ten documents end to end | **Not started.** Still the next stage, and still the thing that generates the validation rules |

The trained extractor is a side quest that ran ahead of the plan. It works, it is measured,
and it has produced the project's most interesting result so far - but stage 3 has still not
happened, and the validation rules it is supposed to produce do not exist.

**The state of the model, honestly.** Trained on 3,400 generated invoices. Token-level F1
1.000, which means nothing. Serving-path accuracy 100% in-distribution and **40.7% on a
shifted set**, a 59.3-point gap. Per field, everything positional survived and everything
keyed to a label word collapsed. Running against an invoice in an unfamiliar layout, the
heuristic returns a flawed record and the model returns nothing at all.

**Changes made this session that are waiting on a run:**

- Training vocabulary greatly enlarged, aimed directly at the label-word memorisation the
  shifted set exposed. **Untested** - the next run's gap is the test.
- Shifted generator rewritten with disjoint vocabulary, plus an assertion enforcing it.
- Run size now adapts: GPU gets 6 epochs and batch 16, CPU gets 2 epochs and batch 8. Two
  epochs is not a compromise - the last run reached F1 1.000 at epoch 1 and the remaining
  five changed nothing.
- `max_length` deliberately left at 512. Measured: median 132 word-pieces, p99 188, longest
  197, and the collator pads per batch rather than to the cap. Lowering it would save
  nothing, and the reasoning is in the notebook so it does not get "optimised" later.
- Cell 1 crashed on a CPU runtime: `subprocess.run(["nvidia-smi", ...])` raises
  `FileNotFoundError` when the binary is absent, so the `or "No GPU"` fallback never ran.
  Guarded with `shutil.which` now.

**Notebook state:** 44 cells, validated as a program - no syntax errors, every name bound
before use, pure ASCII, and the data pipeline runs end to end locally short of the GPU work.

**Next session, in priority order:**

1. **Stage 3.** Ten documents through the real pipeline and the written list of what went
   wrong. It is what generates the validation rules, it needs no GPU, and it has been queued
   behind model work for two sessions.
2. Rerun the notebook and read one number: the shifted gap. If the enlarged vocabulary
   narrowed it, label diversity was the problem. If it did not, only real documents will fix
   it.
3. Real labelled invoices remain unsolved. The Kaggle set has no annotations; CORD is
   receipts under CC-BY-4.0; RealKIE FCC Invoices is 370 real invoices under CC-BY-NC, direct
   download, no form.

**Uncommitted.** Everything from stage 1 onward is in the working tree by request - the
author commits.

### 2026-09-02 - second measured run, and a methodology mistake of mine

Retrained on CPU with the enlarged vocabulary. Manifest now carries the honest numbers.

    in-distribution 100.0%   shifted 46.4%   gap 53.6%
    previous run:            shifted 40.7%   gap 59.3%

**+5.7 points. And the comparison is not valid, because I changed two things at once.**

The previous run was 6 epochs on the small vocabulary; this one is 2 epochs on the large
one. Both variables moved, so the net cannot be attributed to either. [00-plan.md](00-plan.md)
already says, under stage 9, *"One change at a time. Measure."* - and the person who wrote
that then changed two. The CPU fallback made the epoch reduction feel like an environmental
detail rather than an experimental variable, which is exactly how this mistake happens.

**Per field, against the previous run:**

| Field | Before | After | |
| --- | --- | --- | --- |
| CURRENCY | 33.0% | **100.0%** | more currency-label variants clearly worked |
| TOTAL | 0.0% | **44.0%** | thirteen total-labels instead of four |
| DUE_DATE | 58.5% | 76.0% | |
| LINE_DESCRIPTION | 0.0% | 15.0% | |
| VENDOR_NAME | 20.5% | 27.0% | |
| **LINE_AMOUNT** | **98.0%** | **32.0%** | a large regression, and 2 epochs is the likely cause |
| SUBTOTAL | 0.0% | 0.0% | unmoved |
| TAX | 0.0% | 0.0% | unmoved |
| INVOICE_NUMBER | 18.0% | 16.0% | unmoved |
| ISSUE_DATE | 14.5% | 14.0% | unmoved |

**The real diagnosis, which is sharper than "it memorised label words".** Looking at what it
actually returns on shifted documents:

    ISSUE_DATE   wanted '01/02/2026'
                 got    '117/2026/1701/02/202602/05/2026'
    TAX          wanted 'gbp3,410.29'
                 got    'gbpgbp3,410.29gbp20,461.75'
    SUBTOTAL     wanted 'gbp17,051.46'      got nothing
    TOTAL        wanted 'gbp20,461.75'      got nothing
    VENDOR_NAME  wanted 'nakamuraopticsgmbh'
                 got    'nakamuraopticsgmbhregisteredleeds'

**Adjacent fields are merging into one span.** The invoice number, issue date and due date
become a single ISSUE_DATE. The subtotal, tax and total become a single TAX. The vendor name
runs on into the address.

That is not a vocabulary problem. **The model has learned label words as delimiters, not
fields as things.** On familiar text the known labels tell it where each field stops; on
unfamiliar text it cannot find a boundary, fails to emit `B-` at the start of the next
field, and the aggregation step - which correctly splits only on `B-` - merges them.

It explains the pattern exactly. `SUBTOTAL` and `TOTAL` report 0% not because they are
untagged but because they are swallowed into a neighbouring span. `LINE_QUANTITY` and
`LINE_UNIT_PRICE` survive because a number surrounded by other numbers in a table row has a
positional identity that does not depend on any label.

**What follows from it:**

1. **Rerun at 6 epochs on the new vocabulary** when a GPU is available, changing nothing
   else. That isolates the variable and settles whether `LINE_AMOUNT` regressed because of
   undertraining. It is one number and it costs six minutes.
2. Vocabulary alone will not fix boundaries. The generator needs **structural** variety -
   different field orders, different filler between fields, fields sometimes absent - so
   that position and neighbouring words stop being reliable cues.
3. Real documents remain the strongest fix and are still unsolved.

### 2026-09-02 - run 3 on GPU: the controlled comparison, and two measured dead ends

Third run, 6 epochs on the enlarged vocabulary. This is the controlled version of the
comparison I botched last time.

| Run | Epochs | Vocabulary | Shifted | Gap |
| --- | --- | --- | --- | --- |
| 1 | 6 | small | 40.7% | 59.3% |
| 2 | 2 | large | 46.4% | 53.6% |
| 3 | 6 | large | **47.4%** | **52.6%** |

Now the variables separate:

- **Vocabulary** (run 1 against run 3, both 6 epochs): **+6.7 points.**
- **Epochs** (run 2 against run 3, both large vocabulary): **+1.0 point.**

**Both levers are marginal, and the gap is still 52.6%.** Tripling the label vocabulary -
four ways of saying "total" becoming thirteen - bought under seven points. Tripling the
training time bought one. Neither touches the structural failure.

**Before reading the per-field table, its noise was measured.** The same model was run over
two disjoint samples of 100 shifted documents: largest per-field spread **6 points**, overall
spread **0.5 points**. So the per-field movements between runs are real, not sampling.

That makes the next observation solid rather than speculative. Run 2 against run 3 - same
data, same vocabulary, only the epoch count differing:

| Field | 2 epochs | 6 epochs | |
| --- | --- | --- | --- |
| VENDOR_NAME | 27% | **100%** | +73 |
| LINE_AMOUNT | 32% | 72% | +40 |
| TOTAL | 44% | **6%** | -38 |
| BUYER_NAME | 86% | 67% | -19 |
| CURRENCY | 100% | 85% | -15 |
| INVOICE_NUMBER | 16% | 4% | -12 |
| **OVERALL** | **46.4%** | **47.4%** | **+1** |

**Training longer redistributed which fields it gets right without making it better.** Some
fields swung seventy points in each direction and the total moved by one. That is a model
reallocating capacity across a task it has not learned, not a model improving at it.

**What is constant across all three runs**, and is therefore the real finding:

- In-distribution accuracy is 100% every time.
- The shifted gap never drops below 52 points.
- `SUBTOTAL` is 0% in every run.
- The merging failure is always present: the invoice number, issue date and due date collapse
  into one span; the subtotal, tax and total collapse into another.

**Two measured dead ends, which is exactly what stage 9 is supposed to produce** - and this
is stage 9 work happening early and out of order. Neither vocabulary nor training time
addresses a model that has learned label words as delimiters. The remaining levers, in order
of expected value:

1. **Structural variety in the generator** - varying field order, the filler between fields,
   and whether a field appears at all, so that neither position nor neighbouring words are a
   reliable cue. This targets the actual failure rather than its surroundings.
2. **Real documents.** Still unsolved, and still the strongest fix.
3. Layout-aware modelling (LayoutLMv3 with bounding boxes), which is a larger change and
   should wait until the cheaper two have been measured.

### 2026-09-02 - stage 3 done: ten documents, and the failure list

**On being asked what the next step was.** It had been stage 3 for three sessions, and I kept
naming it in a closing aside under a page of model results instead of leading with it. The
model work was a side quest that got ahead of the plan and then set the agenda. Worth
recording as a working failure, not just a scheduling one: the interesting results were
coming from the model, so that is what got reported, while the thing actually blocking the
demo went unstarted.

**What stage 3 needed that did not exist.** The notebook's generator emits *text*; the
pipeline ingests *PDFs* through pdfplumber. So the corpus needed a real PDF writer.

Two new modules:

| Module | What it is |
| --- | --- |
| `mailman/pdfwriter.py` | A minimal PDF writer - text layer, multi-page, correct xref offsets. Hand-written rather than a dependency the running service never uses. Verified round-tripping 62 lines across 2 pages through pdfplumber |
| `mailman/corpus.py` | Ten hand-written cases, each with a stated reason for existing, plus `write_corpus()` producing `NN-name.pdf` and `NN-name.labels.json` |

**The cases are hand-written, not randomly generated.** Ten random invoices measure a
generator's average case; what is wanted is its worst cases. Each document tests one known
difficulty and says so in its `tests` field, which is what gets read when the pipeline fails
on it.

| Case | Tests |
| --- | --- |
| 01-clean | The baseline |
| 02-many-lines | Twelve line items |
| 03-discount | A negative discount line that must not be read as a total |
| 04-credit-note | Every amount negative, in parentheses |
| 05-european-separators | `1.234,56` and a dotted date |
| 06-ambiguous-date | `03/04/2026`, which must be flagged rather than guessed |
| 07-no-due-date | An optional field genuinely absent; the answer is null |
| 08-two-page | A line-item table crossing a page break |
| 09-symbol-currency | A symbol and no ISO code anywhere |
| 10-not-an-invoice | A delivery note. Must be refused, not mined for a record |

The tenth matters as much as the rest: a corpus containing only documents that should succeed
cannot measure refusal.

**Result: 5 of 10 clean.**

    01-clean                 extracted    1 problem
    02-many-lines            FAILED       total not found
    03-discount              extracted    1 problem
    04-credit-note           FAILED       invoice_number not found
    05-european-separators   ok
    06-ambiguous-date        ok
    07-no-due-date           ok
    08-two-page              FAILED       total not found
    09-symbol-currency       ok
    10-not-an-invoice        correctly refused

**The failure list, with root causes traced:**

**1. The money pattern cannot read a bare number over 999.** The severe one.

    'GBP 270.00'    -> ['270.00']
    'GBP 1404.00'   -> []            <-- nothing
    'GBP 1,404.00'  -> ['1,404.00']
    'GBP 29520.00'  -> []            <-- nothing

`\d{1,3}(?:[,.]\d{3})*` requires a separator before any further digits, so any amount of a
thousand or more written without one is **invisible**. That is most of the invoices this
system exists for. It caused both `02-many-lines` and `08-two-page` to fail outright.

**Eighty-seven tests did not catch it**, because every fixture written so far used an amount
under a thousand or one with a comma. The corpus caught it on its second document.

**2. A slash-formatted date is read as two amounts.**

    'Invoice Date: 03/09/2026' -> ['03', '09']
    'Due: 2026-08-01'          -> ['08', '01']

Two money tokens on a line is the rule for "this is a priced row", so a date line becomes a
phantom line item. That is the extra line in `03-discount`.

**3. "Credit Note Number" is not recognised as an invoice-number label.** `04-credit-note`
found no invoice number, because the pattern only looks for `invoice` or `inv`. This is a
scope question rather than a bug - either credit notes are in scope and the label list grows,
or they are out of scope and the corpus case should say so.

**4. `buyer_name` is never populated.** By design - the heuristic does not attempt it. Worth
stating because it means the field is always null on the deployed path, and the trained model
is currently the only thing that finds it.

**What this produces for stage 4.** The first two are extraction bugs and get fixed. The
value for the rules is what they reveal: a total that is silently absent, and a line item
conjured out of a date, are both failures that produce a *plausible-looking record*. Rules
that would have caught them:

- line items sum to the subtotal (the phantom line breaks it)
- subtotal plus tax equals the total (a missing total breaks it)
- every required field present (the missing total)
- a line item whose description contains a date is suspect

Those are the first four rules written from evidence rather than imagination, which is the
whole reason this stage comes before stage 4.

### 2026-09-02 - stage 3 continued: the fixes, and one that made things worse

Fixed the two extraction bugs the corpus found, and the corpus immediately caught a third
that the first fix introduced. Worth recording in that order, because the sequence is the
point.

**Fix 1 - the money pattern reads a bare amount over 999.** Two alternatives now: a grouped
form (`1,404` or `1.404`) or a plain run of digits (`1404`). Result: `02-many-lines` and
`08-two-page` both went from failing outright to clean.

**Fix 2 - dates are masked before amounts are looked for.** Cheaper and more honest than
teaching the money pattern what a date is. `03/09/2026` no longer yields `['03','09']`.

**Then the corpus caught the third one on the very next run.** Every remaining document grew
**exactly one extra line item.** Cause: allowing plain digit runs made the parts of an
identifier visible - `INV-2026-0042` offered up `2026` and `0042`, two amounts on a line is
the rule for a priced row, and so the invoice-number line became a line item. The old,
broken pattern had been hiding it, because `2026` did not match either.

**Fix 3 - a hyphen in the lookbehind.** A digit group preceded by a hyphen belongs to
something larger. Genuine negatives still parse, because the match begins at the minus sign
and the lookbehind sees the space before it.

    01-clean                 5/10 clean at the start
    after fixes 1 and 2      5/10, different failures - one extra line item everywhere
    after fix 3              8/10 clean

**The lesson is about the corpus, not the regex.** A fix that trades one silent wrong answer
for another is the most expensive kind of change, and it is invisible to unit tests written
by the person who wrote the fix. The corpus caught it in one run because it compares against
labels written before any of this existed.

**Four regression tests added**, one per bug plus one asserting negatives survived the
tightening - that last one because the lookbehind change could easily have broken them and
nothing else would have said so. 91 tests pass.

**The two remaining failures are deliberate, not bugs:**

| Case | Why it fails | Decision needed |
| --- | --- | --- |
| `01-clean` - `buyer_name` null | The heuristic does not attempt it; no rule finds a buyer reliably | It stays null on the deployed path. The trained model is currently the only thing that finds it, which is the clearest case yet for the model earning its place |
| `04-credit-note` - no invoice number | The pattern looks for `invoice` or `inv`, and the document says "Credit Note Number" | **Scope question.** Either credit notes are in scope and the label list grows, or they are out of scope and the corpus case is marked `should_fail`. Not a decision to make silently |

Stage 3 is done. Stage 4 writes the rules, and it now has evidence to write them from:
line items summing to the subtotal would have caught the phantom line, subtotal plus tax
equalling the total would have caught the missing one, and both failures produced a
record that looked entirely plausible.

### 2026-09-02 - review of the stage 3 session: what reproduced, and a fourth money bug

**What was asked.** "Look into my mailman app, look into the requirements and check out what
is going on, let me know where you are ready, i need you to continue and review the work of a
previous claude chat that made some mistakes." So: an audit of the stage 3 session recorded
in the two entries above, then continue from wherever the audit left things.

**How the audit was done, and why that choice mattered.** By running it, not by reading it.
Reading the diff would have found nothing - the regexes above are correct as described, the
comments are accurate, and the reasoning in both entries holds up. The method was:

1. Read `00-plan.md`, `05-tasks.md`, the tail of this file, and `NOTES.md` before any code,
   so the claims to be checked were known before the code that makes them was read.
2. Regenerate the corpus from `mailman/corpus.py` and confirm the ten PDFs on disk are
   byte-identical to what the generator produces. They were, so the labels on disk describe
   the documents on disk.
3. Put every PDF through pdfplumber and `HeuristicExtractor`, exactly as the pipeline does,
   and compare **every field** in `expected` - not just the ones the previous run printed.
4. Separately, check each extracted document against the four stage 4 rules the previous
   entry proposed, before those rules exist, because a rule that fails on the corpus is
   either a bad rule or a bad document and it is cheaper to know which now.

Step 3 found nothing new. **Step 4 found both problems in one pass**, which is itself the
finding: the arithmetic self-check is worth more than the field comparison here, because it
does not need to know what the right answer is.

**What reproduced.** 8 of 10 clean, exactly as recorded. All three money fixes are real and
correctly explained. `01-clean`'s null `buyer_name` and `04-credit-note`'s missing invoice
number are correctly identified as deliberate rather than broken. The previous session's
account of its own work is honest. Two things were nevertheless wrong.

**The bug: the date mask deleted four-figure line amounts.**

Fix 2 of the previous session masks dates before looking for amounts. `_DATE` matched
`\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}` - a number, *any word*, a four-digit number - and `\b`
allowed a match to begin inside a number, because there is a word boundary between the "."
and the "00" of "30.00". So:

    'Reel stock lot 34   34   GBP 30.00   GBP 1020.00'

contains `00   GBP 1020`, which is a date by that pattern. The mask removed it, and the line
amount of 1020.00 was **gone**:

    wanted   ['34', '34', '30.00', '1020.00']
    got      ['34', '34', '30']

**The blast radius, and why it is the same shape as the first three bugs.** The trigger is
`<one or two digits> <any word> <four digits>`, which on an invoice is the extremely common
`30.00 GBP 1020.00` - a unit price whose pence end in two digits, a currency code, and a line
amount of a thousand or more. In `08-two-page` it hit lines 34 to 40, the first where `i*30`
reaches four figures. Probed directly:

    'Reel stock lot 34   34   GBP 30.00   GBP 1020.00'  ->  ['34', '34', '30']
    'x 12 GBP 1250.00'                                  ->  []
    'Item 1 GBP 5.00 GBP 1500.00'                       ->  ['1', '5']

The second returns nothing at all. Like the three before it, it does not crash and it does
not produce an obviously wrong record - it produces a line item with a plausible smaller
amount, which is the failure mode this whole system exists to survive.

`05-european-separators` escaped it by luck: `12 EUR 1.250,00` has a dot after the first
digit, so the four-digit run never forms. A corpus of ten documents caught this on one of
them, and only because that one happened to have amounts over a thousand *and* line items.

**Why the corpus said the document was clean.** `08-two-page` asserts `line_item_count: 40`
and a total, and both were right. Forty line items were found; seven of them carried the
wrong amount. The check that was run **counted the line items instead of adding them up.**

That is the more useful half of this finding, and it is a correction to the previous entry's
conclusion rather than to its facts. That entry argues - correctly - that the corpus catches
what unit tests written by the person making the fix will not, because its labels were
written before the fix existed. True, but insufficient: the labels only help if they are
actually *compared*. `line_item_count: 40` is a label that cannot fail on the content of a
line. **A corpus checked by counting is a corpus that agrees with you**, and it agrees with
you in exactly the cases where the fix you just made went wrong.

Two things follow, and both are now written into the plan:

- `expected` needs per-line values wherever the case has few enough lines to write them
  (`01-clean` already has them; `02` and `08` have counts because forty lines are tedious).
- The cheaper check, which needs no labels at all, is the document's own arithmetic. Summing
  each document's extracted line items against its own printed subtotal found this bug in
  seconds and found the second problem below in the same pass, on a corpus of any size.

**The fix, and what was rejected.** The month in a written date has to be an actual month
name, and the pattern can no longer begin in the middle of a number:

    _MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
    _DATE  = ... r"(?<![\w.])(" ... r")(?![\w])" ... re.IGNORECASE

Rejected: **dropping the written-date alternative entirely.** It would have fixed the bug and
lost `14 August 2026`, which is `01-clean`'s and `04-credit-note`'s issue date - trading a
wrong line amount for a missing date. Also rejected: **requiring the month to be capitalised**,
which works on the corpus and fails on the first uppercase invoice header. A closed set of
twelve month prefixes is the honest version of what that alternative was reaching for, and
`re.IGNORECASE` is now on the pattern, so `AUG` and `august` both parse.

Two regression tests, and the second is the one that matters more: one for the bug itself,
and one asserting that **every** format in `parsing._UNAMBIGUOUS_FORMATS` is still both
recognised as a date and masked out of the amounts. Narrowing a pattern is precisely how a
date stops being masked, and an unmasked date is the phantom line item of fix 2 coming back.
The two tests pull against each other on purpose.

**The second problem: `02-many-lines` had ground truth that contradicted itself.**

Its twelve line items are generated - `(i+1)` at `(10+i)` each - and they sum to **1352.00**.
The totals block underneath was typed by hand: `Subtotal 1170.00`, `VAT 234.00`,
`Total 1404.00`. The labels matched the printed text, so extraction passed and the case was
counted clean. The *document* was wrong about itself.

Where 1170 came from is not recoverable and does not matter. What matters is that it is
internally consistent in the wrong way - 234 really is 20% of 1170, and 1404 really is their
sum - so nothing about the totals block looks suspicious on its own. Only the line items
disagree with it.

**Why this is worse than a bug.** The first rule on the stage 4 list is *line items sum to
the subtotal*. Written and run against this corpus, it would have failed on `02-many-lines`,
and the next question would have been "is the rule wrong or is the document wrong" at exactly
the moment the rule was new and least trusted. A rule that fails on its own reference corpus
gets weakened or deleted. This entry exists so that does not happen.

It also punctures a claim made twice in this file and once in `00-plan.md`: that the labels
are safe because the generator emits them with the document, so ground truth exists **by
construction**. That is only true of the parts that are actually constructed. Twelve computed
line items under three hand-typed totals is a hand-written answer key wearing a generator's
clothes.

Fixed by computing the totals from the same list the lines are rendered from:

    _NORTHGATE_ITEMS    = [(i + 1, Decimal(10 + i)) for i in range(12)]
    _NORTHGATE_SUBTOTAL = sum(q * u for q, u in _NORTHGATE_ITEMS)   # 1352.00
    _NORTHGATE_TAX      = (subtotal * Decimal("0.20")).quantize(...) # 270.40
    _NORTHGATE_TOTAL    = subtotal + tax                             # 1622.40

Rejected: **keeping 1170.00 and marking the case as one that should fail the sum rule.** It
was offered as an option and turned down, and the reasoning is worth keeping - that case's
stated purpose is "twelve line items, does line extraction degrade as the table grows", and
a document that also fails arithmetic tests two things at once and its `tests` field stops
being true. If a deliberately non-adding document is wanted for stage 4, it should be an
eleventh case that says so.

**The credit-note scope question, put to the author and answered: credit notes are in scope.**

The previous entry left this open on purpose - "either credit notes are invoices for our
purposes or they are not" - and it was the right thing to leave open, because the two answers
lead to different systems. Both were put up:

| Option | What it would have meant |
| --- | --- |
| **In scope** (chosen) | `_INVOICE_NUMBER` learns the label. `04-credit-note` extracts, and the corpus gains a document where every amount is negative |
| Out of scope | `04-credit-note` marked `should_fail`, and the corpus measures refusal on two documents rather than one |
| Defer to stage 4 | Decide once the arithmetic rules exist and it is clear how signed amounts flow through them |

**Chosen: in scope.** A credit note is an invoice with the signs reversed. It arrives in the
same post from the same vendor against the same purchase order, and a system that refuses it
is a system that cannot file a document its user actually receives. `_INVOICE_NUMBER` now
reads `credit note` alongside `invoice` and `inv`, placed first in the alternation so that
"Credit Note Number" is not consumed by the `invoice` branch.

**Nothing downstream needed touching**, and that is the argument for the decision rather than
a happy accident. `parse_money` already reads both negative conventions - parentheses and a
trailing minus - because that was decided in stage 2. The arithmetic rules hold unchanged:
-100.00 plus -20.00 is still -120.00, and 4 times -25.00 is still -100.00. The only thing
that changes is that `total` can be negative, which no rule on the stage 4 list assumes it
is not. If one ends up assuming it, the assumption is the bug.

Moved out of "still open" and into the decisions table, with the rejected alternative beside
it.

**Where the corpus stands: 9 of 10 clean.** More usefully, every extracted document is now
arithmetically self-consistent for the first time - line items summing to the subtotal,
subtotal plus tax equalling the total, and quantity times unit price equalling the amount on
every line of every document. That was not true before this session and nothing was checking
it. The one remaining failure is `01-clean`'s `buyer_name`, which is deliberate and is still
the clearest case for the trained model earning its 250MB.

**A count to correct.** The entry above says "91 tests pass". 91 is the number **collected**;
73 passed and 18 skipped for want of a database, because Docker was not running. It is now 77
passed and 18 skipped. A small thing, and worth correcting anyway: the entire pitch of this
project is that its numbers are the honest ones, including the ones that did not move. A
skipped test is not a passing test, and the 18 skipped ones are the DB-backed tests over
ingestion and extraction - the stage 6 work will make that gap matter.

**Still outstanding, and it is the gap stage 8 fills.** The corpus run is not reproducible
from the repository. `mailman/corpus.py` writes the documents but nothing reads them back,
so both "8/10" and "9/10" came from a script written for the occasion and thrown away.
Whatever else stage 8 does, the per-field comparison wants to live in the repository - and
on the evidence above, so does the arithmetic self-check.

It was deliberately **not** built this session. Stage 8 owns the harness, the model work
already ran three stages ahead of the plan once, and the lesson recorded two entries above is
that doing that has a cost. But the position is now uncomfortable: three of the four numbers
in this file's stage 3 entries came from throwaway scripts, and the fourth - "91 tests" - was
the one that turned out to be wrong. If stage 4 is going to be checked against the corpus at
all, and it should be, the reader belongs in the repository before the rules are written
rather than after.

**Every change made this session.**

| File | Change |
| --- | --- |
| `mailman/heuristic.py` | `_DATE` requires a real month name (`_MONTH`, twelve prefixes, `re.IGNORECASE`) and uses `(?<![\w.])`/`(?![\w])` instead of `\b` so it cannot start inside a number. `_INVOICE_NUMBER` accepts `credit\s+note`, first in the alternation |
| `mailman/corpus.py` | `02-many-lines` derives its subtotal, tax and total from `_NORTHGATE_ITEMS` instead of carrying typed literals. `Decimal` imported. Corpus regenerated - `02` and `04` PDFs and labels changed, the other eight are byte-identical |
| `tests/test_heuristic.py` | Four tests added: the date-mask regression; every `_UNAMBIGUOUS_FORMATS` date still masked; a credit note extracted end to end with negative subtotal, tax, total and line; and "CREDIT NOTE" alone not read as an invoice number. `Decimal` imported |
| `NOTES.md` | Entry appended, in the author's voice as facts and numbers - the bug, the counting-versus-comparing lesson, the 02 correction, the scope decision, the test-count correction |
| `requirements/00-plan.md` | Stage 3 marked done and stage 4 named as current work. Two rows added to the decisions table: credit notes in scope, and the corpus compared field by field with the amounts added up |
| `requirements/05-tasks.md` | Stale "Nothing is built. Every task below is open." replaced with the real state. Stage 3's failure list corrected from two bugs to four, and two `[x]` items added for the scope decision and the comparison method |
| `requirements/README.md` | Stale "Nothing is built yet ... as of 2026-08-25" and "The current work is stage 0" corrected |
| `requirements/06-context.md` | This entry, plus the two decisions-table rows |

**Verification, before and after.**

    corpus, previous session       8/10 clean
    corpus, after the date fix     8/10 clean, 08-two-page's line amounts now correct
    corpus, after credit notes     9/10 clean
    arithmetic self-check          2 documents inconsistent -> 0
    pytest                         73 passed / 18 skipped -> 77 passed / 18 skipped

The middle line is the one worth noticing: **fixing the date bug did not change the score.**
`08-two-page` was already being counted clean and stayed counted clean. Nothing in the number
moved, and the document went from seven wrong line amounts to none. A score that cannot see a
seven-field correction is a score with a hole in it, and that is the second argument for the
arithmetic check going into the repository.

**What has not been touched, and is still true from the previous entries.** The trained
extractor and the notebook are untouched this session; the three runs and their 52.6-point
shifted gap stand as recorded. `buyer_name` is still never populated by the heuristic. The
four stage 4 rules the previous entry derived from evidence are still unwritten, and are now
joined by a fifth candidate: a line item whose description contains a date is suspect - though
note that the date mask makes such a description come back as `//` rather than as a date, so
that rule needs the masking to preserve what it removed, or it needs to look at the raw line.

**Next session, in priority order.**

1. **Stage 4, the validation layer.** It has evidence to write from now: four bugs, all
   silent, all producing plausible records. The rules that would have caught them are in the
   entry above.
2. **Decide where the corpus reader lives.** Either a `tests/test_corpus.py` that runs the
   ten documents and asserts per-field plus arithmetic - cheap, and it would have caught both
   of this session's findings - or pull stage 8's harness forward. The first is smaller and
   does not jump the plan.
3. `03-architecture.md` carries a validation-rules section written before any document had
   been through the pipeline. Read it against the stage 3 failure list before writing code
   from it.

**Uncommitted.** Everything from stage 1 onward remains in the working tree by request - the
author commits.

### 2026-09-02 - second review pass: what reproduced, and a fifth silent bug

**What was asked.** Word for word the same prompt as the entry above: "Hi Claude, please look
into my mailman app, look into the requirements and check out what is going on, let me know
where you are ready, i need you to continue and review the work of a previous claude chat that
made some mistakes. GIve me a summary of this app so far and where its heading." The previous
entry answered that prompt by auditing the stage 3 session. This one audits *that* audit, and
then the state of the corpus as it now stands.

**Method, and why it was the same method.** By running it, again. The previous entry argues
that reading the diff would have found nothing, and that is still true - everything in
`heuristic.py` is correct as described and the comments accurately explain their own bugs.
Reading `00-plan.md`, `05-tasks.md` and the tail of this file before any code, then:

1. `pytest` on the working tree.
2. Regenerate all ten PDFs from `mailman/corpus.py` and byte-compare against `corpus/`, and
   separately compare each `.labels.json` on disk against the `expected` dict in the module.
   Both, because a stale label file is invisible to a PDF comparison.
3. Every PDF through pdfplumber and `HeuristicExtractor`, comparing **every key** in
   `expected`, plus the three arithmetic self-checks on each document's own extracted values.
4. Probe the extractor with documents the corpus does not contain, looking for the same
   *class* of bug as the four already found - silent, no crash, plausible record.

Step 4 is the new part. The first three were the previous session's method and they were run
to confirm its numbers, not to find anything.

**Everything the previous entry claims reproduced.**

    pytest                          77 passed, 18 skipped        as recorded
    PDF drift (disk vs generator)   none
    label drift (disk vs module)    none
    corpus, field by field          9/10 clean
    the one failure                 01-clean buyer_name -> None  deliberate, as recorded
    arithmetic self-check           0 inconsistencies on 10/10   as recorded

The `.labels.json` files on disk describe the PDFs on disk, and both describe what
`corpus.py` produces today. The three money fixes and the date-mask fix are real, and the
credit-note scope decision is implemented as described - `04-credit-note` extracts
`CN-2026-0019` with subtotal -100.00, tax -20.00, total -120.00. **The previous session's
account of its own work is accurate in every number checked.** Three things are nevertheless
wrong, and the first is a bug of exactly the family the previous four belong to.

**The fifth silent bug: `_TOTALS_WORDS` is a substring test, so real line items disappear.**

`_line_items` skips any line containing one of `("total", "subtotal", "tax", "vat",
"balance", "due")`. The membership test is `word in line.lower` - a substring search over the
whole line, not a word match - so any description that happens to *contain* one of those six
letter-sequences is dropped before its amounts are ever read. Probed with a document written
for the purpose:

    Site survey                 1      GBP 320.00   GBP 320.00     kept
    Overdue account fee         1       GBP 40.00    GBP 40.00     DROPPED  ("due" in "Overdue")
    Tax advisory services       2      GBP 100.00   GBP 200.00     DROPPED  ("tax")
    Total station hire          1       GBP 90.00    GBP 90.00     DROPPED  ("total")

    line items found   1 of 4
    subtotal read      650.00
    lines sum to       320.00

None of those three descriptions is contrived. "Overdue account fee" and "Tax advisory
services" are ordinary invoice lines; a total station is a surveying instrument that gets
hired by the day. And the failure is the shape this system exists to survive: no exception,
a record that looks complete, and three quarters of the invoice gone.

**It is caught by the arithmetic check and by nothing else.** Lines summing to 320.00 under a
subtotal of 650.00 is exactly the stage 4 rule that has not been written yet. The corpus does
not catch it, because no corpus document has a description containing one of the six words -
which is the same reason 87 unit tests missed the bare-thousands bug. Not fixed in this pass;
see the note on ordering at the end.

**Three labels in the corpus cannot fail.**

    03-discount        has_negative_line: true
    06-ambiguous-date  issue_date_is_ambiguous: true
    08-two-page        spans_pages: true

None of the three names a field on `InvoiceFields`, so no comparison of extracted output
against `expected` can evaluate them. A checker either reports them as failures on every
document (they read as `None`) or, more likely, skips the keys it does not recognise - which
is what a checker written by whoever wrote the labels will do.

**`06-ambiguous-date` is the case this actually costs something.** Its stated purpose is that
`03/04/2026` "must be flagged rather than picked quietly", and `issue_date_is_ambiguous` is
the only assertion carrying that purpose. The case has **no `issue_date` label at all**. So
the one document in the corpus that exists to test ambiguity currently asserts nothing about
ambiguity and nothing about the date either. It cannot fail on its own subject.

Worth adding, from a direct probe: `parse_date` flags **both** `03/04/2026` and `03/09/2026`
ambiguous, and `03/09/2026` is `03-discount`'s issue date, labelled with a confident
`2026-09-03` and no ambiguity note.

    03/09/2026   -> 2026-09-03  day-first  ambiguous=True
    03/04/2026   -> 2026-04-03  day-first  ambiguous=True
    14.08.2026   -> 2026-08-14  day-first  ambiguous=False

That is the parser behaving correctly and two labels disagreeing about what to record about
it. The value labels are right; what is missing is that ambiguity is a field the corpus never
asserts on, on either document.

This is the previous entry's own lesson landing one step short. It correctly diagnoses
`line_item_count: 40` as "a label that cannot fail on the content of a line" and writes that
into the plan - and then leaves three labels that cannot fail on anything at all. A count is
a weak assertion; an unevaluable key is not an assertion.

**Per-line values are still missing where the previous entry said they should go.** That entry
records: "`expected` needs per-line values wherever the case has few enough lines to write
them (`01-clean` already has them; `02` and `08` have counts because forty lines are
tedious)." `03-discount` has three lines, `04-credit-note` one, `05-european-separators` two,
`07-no-due-date` one, `09-symbol-currency` an unchecked count. All five still carry only
`line_item_count`. Five documents, nine line items between them, and not one amount asserted.
The follow-up was written down and not done, and it is the same hole that hid seven wrong
amounts in `08-two-page`.

**Ordering, and why nothing was fixed in this pass.** The bug above wants a fix, a corpus case
that would have caught it, and a regression test. The previous session's clearest lesson is
that a fix made without a comparison that runs is how one silent wrong answer gets traded for
another - fix 1 bought fix 3, and the date mask went unnoticed for a session. There is still
no corpus reader in the repository: every number in these three entries, including the ones
above, comes from a script written for the occasion. Fixing a fifth bug by that method repeats
the thing the log keeps saying not to do.

So this pass reports rather than patches, and the ordering question goes to the author,
because both candidate next steps are in the two areas he has said he owns - the validation
rules and the evaluation harness.

**State of the project, unchanged by this pass.** Stages 0-3 done. Stage 4 is the current
work. 77 passed / 18 skipped, the 18 needing Docker. Corpus 9/10 with `01-clean`'s
`buyer_name` the deliberate failure. Trained extractor untouched: 100% in-distribution,
40.7% shifted, 59.3-point gap, retrain with the enlarged vocabulary not yet run.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `requirements/06-context.md` | This entry. No other file was touched - nothing was fixed, by the reasoning above |

**Next, in the order this pass would take them.**

1. **`tests/test_corpus.py`** - the reader, in the repository. Per-field comparison plus the
   three arithmetic self-checks, and it must **fail on an `expected` key it does not know how
   to evaluate** rather than skipping it, which is what makes the three unevaluable labels
   above impossible to reintroduce. Cheap, and it is the precondition for trusting anything
   stage 4 does.
2. **Fix `_TOTALS_WORDS`**, with an eleventh corpus case carrying a description that contains
   one of the six words, plus a regression test.
3. **Fill in the per-line values** on 03, 04, 05, 07 and 09, and give `06-ambiguous-date` a
   real assertion about ambiguity.
4. **Stage 4, the validation layer** - now with five bugs behind it rather than four, and the
   fifth is the strongest argument yet for the lines-sum-to-subtotal rule, because it is the
   only thing that catches it.

**Uncommitted.** Everything from stage 1 onward remains in the working tree by request.

### 2026-09-02 - the corpus reader is in the repository, and it caught the fifth bug on the way in

**What was asked.** Continuing the prompt in the entry above. The ordering question at the
end of it was put to the author as four options - build the reader first, write the stage 4
rules first, fix the bug alone, or fix the labels first - and he chose **the corpus reader
first**. That is the recommendation the entry made, and the reasoning it made it on: both
remaining candidates sit in the two areas he owns, and a fifth silent bug fixed by another
throwaway script is the exact move the log keeps recording as a mistake.

**What was built: `tests/test_corpus.py`.** Five tests, parametrised over the cases.

| Test | What it asserts |
| --- | --- |
| `test_every_expected_key_is_checkable` | Every key in every case's `expected` block has an entry in `_CHECKS`. This is the guard the corpus went three sessions without |
| `test_case_extracts_every_expected_field` | Every key compared, per line and per field where line items are labelled. Amounts compared numerically, so `270.40` and `Decimal("270.4")` are not called a disagreement |
| `test_case_adds_up` | Quantity times unit price against the line amount; the line amounts against the printed subtotal; subtotal plus tax against the total. No labels involved |
| `test_case_is_refused` | A `should_fail` case raises `ExtractionError`, **and** the fields its label says are absent are absent from the read carried on the error. A refusal for the wrong reason is not the behaviour being asserted |
| `test_files_on_disk_match_the_generator` | `corpus/*.pdf` and `corpus/*.labels.json` are byte-for-byte what `corpus.py` produces. Everything else runs against freshly generated bytes, so a stale corpus directory would otherwise be invisible - and those label files are what stage 8's harness will read |

**Why it is a test file and not the harness.** They measure different things. Stage 8 reports
per-field accuracy across thirty to forty documents and records a baseline that goes in the
README; this asserts that eleven known documents still come out right, which is a regression
test. Pulling stage 8 forward to get a reader would have been the model-work mistake again -
running ahead of the plan because the thing ahead is more interesting. When the harness
arrives it should read these same files, and this stays as the fast check.

**The three unevaluable labels now name something real**, rather than being deleted:

    has_negative_line        any line item whose amount is negative
    issue_date_is_ambiguous  "issue_date" in fields.ambiguous_dates
    spans_pages              pdfplumber returned more than one page

All three pass. That is worth stating plainly: they were not wrong, they were *unchecked*,
and the difference did not show up as a failure anywhere. `06-ambiguous-date` now genuinely
asserts that `03/04/2026` is flagged rather than guessed, which is the reason the document is
in the corpus.

**`_CHECKS` is a closed set, and that is the design decision.** A new label has to say how it
is measured or the suite fails on it by name, with the message "a key nothing evaluates reads
as a passing assertion". Adding a label is now slightly harder and adding a decorative one is
impossible. Rejected: **skipping unknown keys with a warning**, which is what a checker
written by the person writing the labels naturally does, and which is precisely how three of
them survived three sessions.

**`01-clean`'s `buyer_name` is a named `KNOWN_GAPS` entry, not a deleted label.** The label is
right - the document does say "Bill To: Orchard Foods Ltd" - and the heuristic is the thing
that is short. Deleting the label would hide the gap; failing on it would make the suite red
for a known, deliberate reason and it would be ignored within a week. Naming it in one place
means removing that entry is how the trained model's contribution gets noticed.

**Then the negative control, in the order that makes it one.** A reader that passes on
everything the day it is written has demonstrated nothing. So case 11 was written *before*
the fix, labelled with the document's truth, and run:

    11-totals-words-in-description   FAILED  test_case_extracts_every_expected_field
    11-totals-words-in-description   FAILED  test_case_adds_up

        line_items: expected 4 lines, got 1: 'Site survey'
        tax: expected '166.00', got Decimal('200.00')
        1 line items sum to 320.00, subtotal says 830.00 (difference 510.00)
        subtotal 830.00 + tax 200.00 = 1030.00, total says 996.00

The document is an ordinary surveying invoice: a total station hired for three days, an
overdue account fee, tax advisory services, and a site survey. Three of its four lines
vanished, and its tax became 200.00 - a figure that is plausible against a subtotal of 830.00
and is the confidently-wrong answer the whole system is designed around.

**The fix, and why word boundaries alone were not enough.** The first instinct is that
`word in line.lower` should be a word match, and it should - `Overdue` contains `due`, and
`Duesenberg Motors` was not a usable vendor name for the same reason. `_has_label` now
compiles the labels into a `\b`-bounded alternation, cached, and every label test in the
module goes through it: `_line_items`, `_labelled_amount`, `_labelled_date`, `_total`,
`_issue_date`, and `_NOT_A_NAME`.

But `Tax advisory services` and `Total station hire` contain the whole words. Word boundaries
do nothing for them, and a total station is a real instrument that really is hired by the day.
So the second half of the fix keys on **shape rather than wording**:

- A totals row carries a label and one amount (`Total Due   GBP 996.00`), or two when the
  rate is printed beside it (`VAT 20%   GBP 166.00`). A priced row carries three - quantity,
  unit price, amount. So in `_line_items` the totals words only disqualify a line **with
  fewer than three amounts**.
- In `_labelled_amount` and `_total`, a line with three or more amounts is skipped outright:
  it is a priced row, whatever its description says.

Alternatives turned down. **Anchoring the label to the start of the line** - totals rows do
start with their label, but so does "Total station hire". **A word-count threshold on the
label** ("Total Due" is two words, "Total station hire" is three) - it works on this document
and is arbitrary everywhere else. **Dropping `due` from `_TOTALS_WORDS`** - "Balance Due" and
"Amount Due" are ordinary totals labels and it would have traded a dropped line item for a
missed total, which is the shape of every bad fix in this log.

The residual is worth writing down, because it is not zero: **a two-amount line item whose
description contains a totals word is still dropped.** A priced row with no quantity column,
described as "Tax advisory services  GBP 200.00  GBP 200.00", would still be read as a totals
row. Narrower than what was fixed, and the arithmetic rule catches it, which is one more
argument for stage 4.

**Two of the previous entry's three findings are now closed. The third is not.** Per-line
values were only added to case 11. `03-discount`, `04-credit-note`, `05-european-separators`,
`07-no-due-date` and `09-symbol-currency` still carry `line_item_count` alone - nine line
items between them with no amount asserted. The reader makes filling them in cheap and the
guard makes it obvious what is missing, but it was not done in this pass.

**Verification, before and after.**

    pytest, before                      77 passed / 18 skipped
    pytest, after                      114 passed / 18 skipped     (+33 corpus, +4 heuristic)
    corpus, case 11 before the fix     1 line item of 4, tax 200.00 instead of 166.00
    corpus, case 11 after the fix      4 of 4, tax 166.00, adds up
    corpus, all eleven                 10 of 11 clean; 01-clean's buyer_name the known gap
    arithmetic self-check              0 inconsistencies on 11 of 11
    files on disk vs generator         identical, all eleven

The 18 skipped are still the DB-backed tests, still waiting on Docker, and still not passing
tests.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `tests/test_corpus.py` | New. The reader: five tests, `_CHECKS` as a closed set of measurable keys, `KNOWN_GAPS` for `01-clean.buyer_name` |
| `mailman/corpus.py` | Case 11, `11-totals-words-in-description`, with full per-line labels. Written to fail, then fixed |
| `mailman/heuristic.py` | `_has_label` with `\b`-bounded cached patterns, used by every label test. `_line_items` applies the totals words only to lines with fewer than three amounts. `_labelled_amount` and `_total` skip three-amount lines. `_NOT_A_NAME` word-bounded. `lru_cache` imported |
| `tests/test_heuristic.py` | Four tests: the dropped line items, the corrupted tax, the totals block still excluded (the loosening this fix could cause), and `_has_label` asserted directly |
| `corpus/` | Regenerated. Eleven documents; the first ten byte-identical to before |
| `requirements/00-plan.md` | Three decision rows: the reader in the repository, an unevaluable key is a failure, totals rows told by shape. Stage 4 note now says five bugs |
| `requirements/05-tasks.md` | Stage 3's failure list corrected from four bugs to five. Two `[x]` items for the reader and case 11. The score line rewritten honestly |
| `NOTES.md` | Entry appended |
| `requirements/06-context.md` | This entry |

**Next, in priority order.**

1. **Stage 4, the validation layer.** It now has five bugs behind it and a reader that will
   run the rules against eleven documents the moment they exist. The rule "line items sum to
   the subtotal" is the one that catches the bug fixed today, and it is the one that would
   have caught it a session earlier.
2. **Per-line labels on 03, 04, 05, 07 and 09.** Cheap now, and the third finding of the
   previous entry is still open.
3. `03-architecture.md`'s validation-rules section was written before any document had been
   through the pipeline. Read it against the five-bug failure list before writing code from
   it. Still not done, and now two entries old.
4. The trained model's retrain with the enlarged vocabulary is still unrun. Untouched again
   this pass, which is the right call while the plan is behind it, but the 59.3-point shifted
   gap is the project's most interesting unfinished number.

**Uncommitted.** Everything from stage 1 onward remains in the working tree by request.

### 2026-09-02 - the notebook audited: the vocabulary experiment was half-applied

**What was asked.** "Before we move on, could the notebook be improved on to get better
accuracy and results? i dont feel like it was great cause we had a lot of bugs and a lot of
retries." So: an audit of `notebooks/train_extractor.ipynb` against the three runs recorded
above, and an honest answer about whether the ceiling is the notebook or the approach.

**Nothing was changed in this pass.** The findings below need a Colab run to confirm, and
that run costs the author time rather than me, so it is his call whether and how far to go.

**The finding: four of the eight label vocabularies were enlarged and never wired in.**

The 2026-09-02 entry records the response to the first shifted-set result as "training
vocabulary greatly enlarged - 6 vendors to 20, 8 goods to 22, 4 total-labels to 13, 3
date-labels to 11, plus subtotal and tax label lists, 5 table-header variants and 6 date
formats." The lists were all written, in cell 8. Four of them are never read by
`generate_invoice` in cell 9. Counted across the whole notebook, they appear only where they
are defined and in the shifted generator's disjointness assertion:

    SUBTOTAL_LABELS    defined c8, used c30 (assertion only)     NOT in the generator
    TAX_LABELS         defined c8, used c30 (assertion only)     NOT in the generator
    TABLE_HEADERS      defined c8, used c30 (assertion only)     NOT in the generator
    CURRENCY_LABELS    defined c8, used c30 (assertion only)     NOT in the generator

    VENDORS BUYERS GOODS CURRENCIES NUMBER_LABELS DATE_LABELS DUE_LABELS TOTAL_LABELS
                                                              all used in the generator

What the generator actually emits at those four points is a constant:

    emit("Subtotal")                                 every training document, all 4000
    emit(rng.choice(["VAT", "Tax", "Sales Tax"]))    a hardcoded list of three
    emit("Currency")                                 every training document
    emit("Description Qty Unit Price Amount")        every training document

**This predicts the measured per-field results exactly, and that is why it is worth
believing.** Across three runs the constants in the log are: `SUBTOTAL` 0% in every run, and
`TAX` 0% in runs 1 and 2. Those are the two totals-block fields whose label lists were never
connected. `TOTAL` - the one totals-block field whose list *is* read by the generator - is
the one that moved, 0% to 44% between run 1 and run 2.

There is a second, sharper version of the same evidence. `CURRENCY` reached 100% on the
shifted set despite `emit("Currency")` being a hardcoded label, because the shifted generator
draws its currency *values* from the same `CURRENCIES` list the training generator uses. The
one field where training and shifted share a value vocabulary scores 100%; the fields where
they share nothing score 0%. That is a model doing lexical lookup, stated as plainly as the
data can state it.

**What this does to the recorded conclusion.** The 2026-09-02 run 3 entry concludes that
vocabulary is a measured dead end - "+6.7 points, tripling the label vocabulary bought under
seven points" - and files it as one of stage 9's two dead ends. That measurement is real for
the fields that received the treatment. It is not evidence about `SUBTOTAL`, `TAX`, the
currency label or the table header, because those never received it. **A dead end recorded
in the README is supposed to be the differentiator; a dead end that was never actually walked
down is worse than none.** The conclusion needs narrowing to what was tested, and the
untested half needs one run.

**A second half-applied change, same shape.**

    training generator:  date_style = rng.randrange(4)      styles 0,1,2,3
    shifted generator:   style      = rng.randrange(6)      styles 0..5
    a_date supports:     6 styles

So `%d-%b-%Y` (14-Aug-2026) and `%d.%m.%Y` (14.08.2026) appear in a third of shifted documents
and in **no training document at all**. The entry claims "6 date formats" were added; four are
reachable. `ISSUE_DATE` scored 14.5% and 14.0% across the two runs, essentially unmoved, and
roughly a third of that failure is guaranteed by construction rather than by anything the
model did or did not learn.

**The structural problem, confirmed by reading rather than inferred.** Every training document
emits its fields in one fixed order, with fixed filler:

    vendor, <number> <one of three street names>, "INVOICE", numberlabel, number,
    datelabel, date, [duelabel, due at 85%], "Bill To:", buyer,
    "Description Qty Unit Price Amount", {description qty unit amount} x1-6,
    "Subtotal", subtotal, taxlabel, tax, totallabel, total, "Currency", code

The due date is the only field that is ever absent, and the order never varies. Position is a
perfect predictor of field identity in the training set, so nothing in the objective rewards
learning anything else. This is the "label words as delimiters" diagnosis from the run 2
entry, and the code says it outright: the model is never shown a document where the
subtotal is somewhere other than four tokens after the last line amount.

**Two further mismatches between training and everything it is asked to read.**

| | Training | Corpus / real |
| --- | --- | --- |
| Line items per document | `rng.randrange(1, 7)` - one to six | `08-two-page` has 40 |
| Sequence length | fits easily | truncation is `max_length=512`, and the totals block is the **last** thing in the document, so a long invoice loses exactly the fields already scoring 0% |

The model has never seen a document longer than a few lines, and the fields it is worst at
are the ones a long document truncates away.

**Model selection is by accident.** `save_strategy: "no"`, no `load_best_model_at_end`, and
the `eval_dataset` is the in-distribution split whose F1 is 1.000 from epoch one. So the
exported weights are whatever the final epoch produced, chosen by nothing. The run 2 against
run 3 table is the cost of that: `VENDOR_NAME` +73, `TOTAL` -38, `BUYER_NAME` -19, overall
+1. Fields swinging seventy points in both directions between epochs, with the epoch picked
by where the loop stopped.

The fix is not to select on the shifted set, which would spend the only honest measurement
in the notebook on model selection. It is a **three-way split with disjoint vocabularies** -
train, a shifted dev set to select on, a shifted test set that is read once.

**Smaller things, listed and not weighted heavily.** `distilbert-base-uncased` throws away
case, which on an invoice is signal - vendors in capitals, label words capitalised - and the
serving path already had to work around detokenization damage for the same reason; a cased
model is a one-line change worth one measurement. No weight decay, no warmup, learning rate
at the default 5e-5, none of which is where 52 points live.

**What the answer to the question is.** Yes, and the reason the last two runs disappointed is
not that the approach is at its ceiling. Two of the changes made in response to the first bad
result were only half-applied, and both of them landed on precisely the fields that then
failed to move. That is a bug in the experiment, not a result from it - and it is the same
class of bug as the five in `heuristic.py`: nothing raised, the notebook ran clean, the
manifest reported numbers, and the numbers were measuring something other than what the
entry above said they measured.

Recorded now, unfixed, because the confirming run is the author's to spend.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `requirements/06-context.md` | This entry. Nothing else touched |

**The order the fixes are worth doing in.**

1. **Wire in the four unused lists and fix `randrange(4)` to `randrange(6)`.** Roughly five
   lines. It is a bug fix rather than an experiment, and it targets the three fields that
   have never moved off zero. One run says whether vocabulary was a dead end or was never
   tried on the fields that needed it.
2. **Structural variety in the generator** - vary field order, vary the filler, let fields be
   absent, and let line-item tables run to realistic length. This targets the merging failure
   directly and is the lever the run 3 entry already ranked first.
3. **Three-way split and model selection on a shifted dev set**, so the exported weights are
   chosen rather than whatever the last epoch left behind.
4. Cased model, measured once against uncased.
5. Real documents - CORD or RealKIE FCC. Still the strongest fix, still unsolved, and now
   clearly not the *only* thing standing between this notebook and a better number.

One change at a time, and the stage 9 rule that was broken once already applies to all five.

### 2026-09-02 - the notebook's vocabulary is wired in, and the guard took three attempts

**What was asked.** The audit in the entry above offered four scopes and the author chose
**bug fixes only**: wire in the four unused label lists and make every date format reachable,
and stop there. The reasoning for that choice is the reasoning the entry recommended - it is
a bug fix rather than an experiment, it moves one thing, and one Colab run then says whether
vocabulary was a dead end or was never tried on the fields that needed it.

**The fix itself is small.** Five call sites in `generate_invoice`, plus a named constant:

| Before | After |
| --- | --- |
| `emit("Description Qty Unit Price Amount")` | `emit(pick(rng, "TABLE_HEADERS"))` |
| `emit("Subtotal")` | `emit(pick(rng, "SUBTOTAL_LABELS"))` |
| `emit(rng.choice(["VAT", "Tax", "Sales Tax"]))` | `emit(pick(rng, "TAX_LABELS"))` |
| `emit("Currency")` | `emit(pick(rng, "CURRENCY_LABELS"))` |
| `date_style = rng.randrange(4)` | `date_style = rng.randrange(DATE_STYLES)` |

`DATE_STYLES = 6` is defined once beside `a_date` and used by **both** generators, so the
training set and the shifted set cannot drift apart again. The shifted generator's
`rng.randrange(6)` becomes `rng.randrange(DATE_STYLES)`, which is a no-op today and is the
point - the two are now the same fact rather than two numbers that happen to agree.

**The guard is the part worth writing down, because it was wrong twice.**

The obvious guard is to check that every vocabulary list shows up in the generated text.
Written, run against the bug it was written to catch, and it **passed**:

    attempt 1   "does any phrase from this list appear in the emitted text?"
                PASSED on the bug. The hardcoded constants were "Subtotal" and "Currency",
                which are themselves members of SUBTOTAL_LABELS and CURRENCY_LABELS.

    attempt 2   "do at least two distinct phrases appear?"
                PASSED on the bug. The hardcoded tax list was ["VAT", "Tax", "Sales Tax"] -
                three members of TAX_LABELS. And SUBTOTAL_LABELS scored two because "Net"
                turns up inside the table header "Details Qty Rate Net".

    attempt 3   record the draw at the call site.
                CAUGHT all four.

`pick(rng, name)` draws from `VOCABULARY[name]` and records the name in a `Counter`. The
assertion is then `set(VOCABULARY) - set(DRAWS)`, which asks whether the generator called for
the list at all. **A check that reads the output can be satisfied by a coincidence; a check on
the call cannot.**

That is the same lesson as `tests/test_corpus.py` from earlier today, arrived at by a
different road, and it is the third time this project has produced it: a corpus checked by
counting agrees with whoever wrote the fix; a label nothing evaluates reads as a passing
assertion; a vocabulary guard that greps the output passes on a constant that happens to be
in the list. The pattern is that a check written from the same understanding as the code
inherits the code's blind spot, and the fix each time has been to move the check onto
something the bug cannot fake.

Both failed attempts are in the cell's comment, not just here, because the next person to
simplify that guard will reach for exactly attempt 1.

**Verified by running it, not by reading it.** Cells 8, 9 and 30 were executed locally -
they need only `random` and `datetime`, so no GPU and no Colab:

    negative control, subtotal hardcoded                    CAUGHT
    negative control, currency hardcoded                    CAUGHT
    negative control, tax hardcoded to 3 of its own members CAUGHT
    negative control, table header hardcoded                CAUGHT

    real cell, 4000 documents:
      BUYERS           12/12    CURRENCY_LABELS   5/5     DATE_LABELS      11/11
      DUE_LABELS        9/9     GOODS            22/22    NUMBER_LABELS    15/15
      SUBTOTAL_LABELS  10/10    TABLE_HEADERS     5/5     TAX_LABELS        9/9
      TOTAL_LABELS     13/13    VENDORS          20/20
      date formats     6, all reachable
      shifted-set disjointness assertion   PASSED  (522 tokens overlap, no shared phrases)

Every phrase in every list now appears in the training data. Before this change, four of
those eleven rows would have read 1/10, 3/9, 1/5 and 1/5.

The disjointness assertion in cell 30 was re-run deliberately: enlarging what training
actually emits is exactly the change that could make the held-out set stop being held out,
and that has happened here once before. It passes.

All 44 code cells still compile.

**What was NOT changed, and why.** Structural variety, the three-way split with model
selection, the cased model and real documents are all still open - they were offered and
turned down for this pass. The single most valuable of them remains structural variety: the
field order in `generate_invoice` is still identical in every document, which is what the
merging failure is made of. This change cannot fix that and is not expected to.

**What the next run will say.** One number, and it is a genuine test rather than a hope.
`SUBTOTAL` has been 0% in all three runs and `TAX` 0% in two of three, and both have now been
given the treatment that moved `TOTAL` from 0% to 44%. If they move, the "vocabulary is a
dead end" conclusion in the run 3 entry needs narrowing to the fields it was actually
measured on. If they stay at zero with a properly varied label vocabulary, that conclusion
becomes much stronger than it currently is - it would then be evidence that the problem is
structural, which is what the merging diagnosis predicts.

Either result is worth having. The run to compare against is **run 3: 6 epochs, shifted
47.4%, gap 52.6%** - same epochs, same seed, only the emitted vocabulary differing.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `notebooks/train_extractor.ipynb` cell 8 | `DATE_STYLES = 6` named beside `a_date`, with the reason |
| `notebooks/train_extractor.ipynb` cell 9 | `VOCABULARY`, `DRAWS`, `pick()`; five call sites wired to the lists; the never-drawn assertion; the date-style assertion; a per-list draw report |
| `notebooks/train_extractor.ipynb` cell 30 | `rng.randrange(6)` becomes `rng.randrange(DATE_STYLES)` so the two generators share one fact |
| `NOTES.md` | Entry appended |
| `requirements/06-context.md` | This entry |

**Next.** Stage 4 is still the plan's current work and this was a detour taken on request.
When the retrain happens it is one variable against run 3, and the result goes in the table
in the run 3 entry rather than replacing it.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - next steps, and two rules that will fail on our own corpus

**What was asked.** "What should i do now, always give me some steps." A planning exchange;
no code changed. Recorded because the log is per-prompt and because two things came out of
reading `03-architecture.md`'s validation section against the stage 3 failure list - which
the last two entries both listed as an open item and neither did.

**Two rules on the architecture's list will fail against this corpus if written as stated.**

**1. "Invoice number matches the expected format" (error).** The corpus already carries at
least three shapes:

    INV-2026-0042  BW-2026-771  CN-2026-0019  TS-2026-4417
    CE-2026-0088   AP-2026-5120 SS-2026-0143       <- prefix-year-serial
    NS-88213                                       <- prefix-serial, no year
    MPW-3310                                       <- three-letter prefix, short serial

and the shifted generator produces `123/2026/45`, a fourth. A single format regex marks two
of eleven corpus documents as errors on documents that are perfectly well formed. This is the
`02-many-lines` trap exactly: a new rule failing on its own reference corpus, at the moment
the rule is least trusted, with "is the rule wrong or is the document wrong" the next
question. The honest versions are per-vendor (which makes it a `vendors` column and a rule
that only fires on the second invoice from a vendor) or a much weaker shape check. The open
question in "Still open" above already anticipated this; it now has evidence and a count.

**2. "Total matches the total printed on the document" (error).** On the heuristic path this
catches nothing, because the heuristic *reads* the total and never computes one - the rule is
guarding against a model that computes rather than reads. It is a real rule for the `trained`
and `anthropic` extractors and a no-op for the default one. Worth keeping and worth knowing
it will report a 100% pass rate on every deployed document, otherwise that pass rate reads as
evidence of correctness later.

Neither is a reason to change the architecture document. Both are reasons to write those two
rules last, and to expect the rule set to shrink.

**The state everything is in.** 114 passed / 18 skipped. Corpus 10 of 11 with `01-clean`'s
`buyer_name` the known gap. Notebook fixed and locally verified but **not rerun** - `run 3:
shifted 47.4%, gap 52.6%` is still the number to beat, and the rerun is one variable. Nothing
committed; the tree carries three distinct pieces of work.

**Steps handed over, in order.**

1. Commit, in three commits rather than one - the corpus reader, the `_TOTALS_WORDS` fix, the
   notebook vocabulary fix. The history is on display and these are three different stories.
2. Start the Colab retrain before anything else, because it runs unattended. **Set
   `USE_KAGGLE = False` in cell 11 first** - it currently defaults to `True`, and the Kaggle
   route is closed (8181 jpgs, zero annotations), so leaving it on downloads a gigabyte and
   asks for a token to no purpose.
3. Stage 4, the validation layer, while the model trains.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `requirements/06-context.md` | This entry. No code touched |

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - the notebook made ready to run, not merely correct

**What was asked.** "make sure to update the notebook then ill take it to collab." The
previous pass fixed the vocabulary bug in the generator; this pass makes the rest of the
notebook fit to be run by someone who is not going to reread this file first.

**Five changes, and each one is a trap that was going to cost a run.**

**1. `USE_KAGGLE` was still `True`.** The route has been closed since the download was
inspected - 8181 jpgs, zero annotations - and the flag has sat at `True` through three
sessions of writing that down. Running the notebook as it stood would have prompted for a
Kaggle token upload and pulled roughly a gigabyte of unlabelled images before training on
exactly the generated data it would have used anyway. Now `False`, with the reason on the
line itself, and the `else` branch says which state it is in rather than staying silent.

**2. The markdown above it still advertised the dataset.** It described "1,489 annotated
invoices with invoice number, dates, seller and client, line items, subtotal, tax, discount
and total" and told the reader to get it from Kaggle rather than the HuggingFace mirror. That
is the claim that turned out to be about the Voxel51 FiftyOne copy rather than the Kaggle
artifact, and it is the most persuasive text in the notebook arguing for the thing that does
not work. Rewritten as **THIS ROUTE IS CLOSED**, with the file counts, the corrected licence
(DbCL-1.0, not ODbL), what turning it on actually costs, and the two remaining candidates -
CORD and RealKIE - in a table. The converter cells below are left intact and correct; they
simply have nothing to read.

**3. The run would have silently stopped being a comparison.** The whole point of the next
run is one variable against run 3: 6 epochs, large vocabulary, shifted 47.4%, gap 52.6%. But
`EPOCHS` is set from `torch.cuda.is_available()`, and on a CPU runtime it drops to 2 - which
is *exactly* the confound run 2 introduced, where a vocabulary change and an epoch change
moved together and the +5.7 points could not be attributed to either. Colab hands out CPU
runtimes when the GPU quota is gone, so this was not a remote possibility.

`BASELINE = {"run": 3, "epochs": 6, "shifted": 0.474, "gap": 0.526}` is now declared in the
run-size cell, before the run, and the cell compares against it and says which case it is in:

    epochs match the baseline - this is a one-variable comparison, and the only
    thing that differs is the label vocabulary the generator now actually emits.

or, on CPU:

    WARNING: 2 epochs against the baseline's 6.
    Two variables will have moved - vocabulary AND training time - and the result
    cannot be attributed to either. This is exactly the mistake run 2 made.

Both branches were executed to confirm the wording, the second by forcing `ON_GPU = True`
rather than by trusting that it reads correctly.

**4. The markdown claiming epochs do nothing was stale and wrong.** It said the previous run
"settles the epoch count: F1 hit 1.000 at epoch 1 and epochs 2 to 6 changed nothing
measurable" - and that was the saturated in-distribution F1 talking. Run 3 against run 2, same
data, only epochs differing: `VENDOR_NAME` 27% to 100%, `LINE_AMOUNT` 32% to 72%, `TOTAL` 44%
down to 6%. Training longer redistributes which fields it gets right, and a metric pinned at
1.000 cannot see any of it. Corrected in place, with the reason it was wrong, because that
claim is what made the CPU fallback feel harmless.

**5. The result cell now prints the verdict rather than a number to go and look up.** It
carries run 3's per-field shifted scores and prints, beside each, this run's figure and the
movement - with `SUBTOTAL` and `TAX` marked `<-- wired in for the first time`, and both
readings of the outcome spelled out underneath:

    SUBTOTAL and TAX move       -> vocabulary was never the dead end it was recorded as
    SUBTOTAL and TAX stay at 0  -> that finding gets much stronger, and the failure is
                                   structural. Next lever is field order, not more words.

Writing down what each outcome would mean *before* the run is the cheap defence against
reading whichever result arrives as confirmation. It cost four lines.

**The manifest now describes the run's data, not just its scores.** `mailman_model.json`
gains `vocabulary_phrases_emitted` (distinct phrases drawn per list, over the list size),
`date_formats`, `baseline`, `comparable_to_baseline`, and `per_field_shifted`. The reason is
this session's whole finding: three sets of weights were exported carrying a note about a
"greatly enlarged vocabulary" describing a change that had half happened, and nothing in the
manifest could have contradicted it. A run's data is now described by the run. A fourth
caveat is added always - field order is identical in every training document - and a fifth
appears automatically when the epoch count does not match the baseline.

**Verified by executing it, not by reading it.** All 44 code cells compile. Then a dry run
with a stub tagger and no torch, no GPU and no download, exercising every changed cell: the
run-size warning on both branches, both generators, the vocabulary guard, the Kaggle skip
path, `all_examples` with zero real documents, the shifted set's disjointness assertion, and
the scoring and comparison cell. No `NameError`, no format error. The stub returns no spans,
so the printed accuracies are all 0.0% - that is the stub, not a finding.

`serving_accuracy` now returns `(overall, rates)` rather than a bare float; cell 31 is its
only caller and was updated with it.

**Every change made this pass.**

| Cell | Change |
| --- | --- |
| 5 (markdown) | Rewritten: the run is a controlled comparison, needs 6 epochs, and the old "epochs do nothing" claim corrected with the run 2 / run 3 per-field evidence |
| 6 | `BASELINE` declared; prints whether this run is a valid one-variable comparison, with a loud warning when it is not |
| 10 (markdown) | Rewritten as THIS ROUTE IS CLOSED, with file counts, corrected licence, and the CORD / RealKIE alternatives |
| 11 | `USE_KAGGLE = False`, with the reason inline and an `else` branch that says so |
| 31 | Returns per-field rates; prints the run 3 comparison, the movement, and what each outcome would mean |
| 35 | Manifest carries `vocabulary_phrases_emitted`, `date_formats`, `baseline`, `comparable_to_baseline`, `per_field_shifted`, and two more caveats |

**What was deliberately not done.** Structural variety in the generator, the three-way split
with model selection, and the cased model are all still open and were declined for this round
of work. Field order is still identical in every training document, and that remains the
biggest single lever on the 52.6-point gap.

**Next.** The author runs it on Colab with a T4. The number to read is the three-line block at
the end of cell 31, and the two rows to read are `SUBTOTAL` and `TAX`. Whatever it says goes
into the run table in the run 3 entry as run 4, rather than replacing anything. Then stage 4.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - the NOTES.md cell was pasting the meaningless number

**What was asked.** "There is no 31, it goes up to 25, is it this one?" - with the source and
output of the cell the author was looking at.

**My error first: I referred to cells by their index in the notebook JSON, which counts
markdown cells. Colab numbers only code cells.** There are 44 cells in the file and 25 of them
are code, so every cell number I gave was wrong from the author's side of the screen. The
mapping for the ones that matter:

| Colab | File index | What it is |
| --- | --- | --- |
| 4 | 6 | Run size, `BASELINE`, the epoch warning |
| 5 | 8 | Vocabulary lists, `DATE_STYLES` |
| 6 | 9 | Generator, `pick()`, the vocabulary guard |
| 7 | 11 | `USE_KAGGLE = False` |
| 15 | 24 | Train |
| 17 | 28 | Serving pipeline |
| 18 | 30 | Shifted set |
| **19** | **31** | **in-distribution / shifted / gap, and the run 3 comparison** |
| 21 | 35 | Manifest and export |
| 25 | 42 | PowerShell commands and the NOTES.md block |

Cell numbers in this log should be Colab numbers from here on, because that is the only
numbering the person running it can see.

**What the paste revealed, which is worth more than the numbering.** The output carried the
`Field order is identical in every training document` caveat, which was added earlier today.
It also showed 3400 training examples and 6 epochs - `TRAINING_DOCUMENTS = 4000` at a 0.15
split, and the GPU branch. **So the retrain has already been run, on a GPU, with the fixed
generator.** The result exists in the author's session at Colab 19 and has not been read yet.

**And it exposed a real bug in Colab 25.** That cell exists to print a block to paste into
`NOTES.md`. It printed:

    Overall F1      1.000

    INVOICE_NUMBER       P 1.000  R 1.000  F1 1.000  (n=600)
    VENDOR_NAME          P 1.000  R 1.000  F1 1.000  (n=600)
    ... thirteen rows, every one 1.000

and **nothing else numeric**. No `serving_in_distribution`, no `serving_shifted`, no
`generalisation_gap` - all three of which the manifest has carried since the run 1 post-mortem.

That is the single number this project has spent four entries establishing is meaningless:
train and test are drawn from the same generator, it has been 1.000 on every run including the
one that could not find a total on an unfamiliar invoice, and the log already records "a
perfect score is not a result, it is a broken benchmark". The cell whose entire job is to
produce the record was handing over the broken benchmark and dropping the honest numbers.

Nobody would have noticed from inside the notebook. The manifest was right, the export was
right, and the human-facing summary was wrong - which is the same shape as the four silent
extraction bugs and the half-applied vocabulary change: the machinery was correct and the
thing a person actually reads was not.

**Colab 25 rewritten.** The serving scores now come first under a heading that says they are
the ones that mean something, followed by the run 3 comparison and the movement, whether it
was a valid one-variable comparison, the per-field shifted table with `SUBTOTAL` and `TAX`
marked, and the vocabulary draw counts. The token-level F1 appears last, on its own, with the
sentence that has to travel with it. Caveats unchanged.

Dry-run with a fabricated manifest to check every format string and both branches of
`comparable_to_baseline`. The numbers in that test output are invented and must not be
mistaken for a result.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `notebooks/train_extractor.ipynb` Colab 25 (index 42) | Serving scores first, run 3 comparison, per-field table, vocabulary evidence; token F1 demoted to last with its caveat attached. Sample upload path fixed to a corpus file that exists |
| `requirements/06-context.md` | This entry |

**Next.** Read Colab 19's output, which already exists. The two rows that answer the
question are `SUBTOTAL` and `TAX`, both 0.0% in every run so far and both given a real label
vocabulary for the first time in this run. Then it goes in the run table as run 4.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - run 4: the dead end was a bug, and the gap halved

**What was asked.** The author ran the fixed notebook on a Colab GPU and pasted Colab 19's
output. This entry records run 4 and corrects a conclusion that has been in this file, in
`00-plan.md` and in `NOTES.md` since the run 3 entry.

**The result.**

    in-distribution 100.0%   shifted 70.7%   gap 29.3%
    run 3 baseline           shifted 47.4%   gap 52.6%
    movement                        +23.3%        -23.3%

| Run | Epochs | Generator variety | Shifted | Gap |
| --- | --- | --- | --- | --- |
| 1 | 6 | small vocabulary | 40.7% | 59.3% |
| 2 | 2 | enlarged, **half-applied** | 46.4% | 53.6% |
| 3 | 6 | enlarged, **half-applied** | 47.4% | 52.6% |
| 4 | 6 | enlarged, **fully applied** | **70.7%** | **29.3%** |

Run 3 against run 4 is a controlled comparison - same seed, same 4000 documents, same 6
epochs, GPU both times - and the notebook asserted that before printing the number.

**The conclusion that has to be withdrawn.** The run 3 entry says: *"Both levers are marginal,
and the gap is still 52.6%. Tripling the label vocabulary - four ways of saying 'total'
becoming thirteen - bought under seven points."* It files vocabulary as one of stage 9's two
measured dead ends.

**That was wrong, and it was wrong because the experiment had never been run.** Four of the
eight label lists were defined and never drawn from, and they governed exactly the fields that
had not moved. The +6.7 points attributed to "tripling the vocabulary" was the effect of
tripling *half* of it. With all of it wired in, at the same 6 epochs:

| Field | run 3 | run 4 | move | |
| --- | --- | --- | --- | --- |
| SUBTOTAL | 0.0% | **73.0%** | +73.0 | label list wired in for the first time |
| TAX | 0.0% | **71.5%** | +71.5 | label list wired in for the first time |
| TOTAL | 6.0% | **80.5%** | +74.5 | list was already wired in - see below |
| LINE_AMOUNT | 72.0% | 100.0% | +28.0 | |
| CURRENCY | 85.0% | 100.0% | +15.0 | |
| INVOICE_NUMBER | 4.0% | 13.0% | +9.0 | still the second worst field |
| BUYER_NAME | 67.0% | 64.0% | -3.0 | within noise |
| VENDOR_NAME | 100.0% | 91.0% | -9.0 | outside the 6-point noise band |

Vocabulary is not a dead end. Measured end to end at constant epochs, **run 1 to run 4 is
40.7% to 70.7% - thirty points, and the gap halved from 59.3 to 29.3.** It is the largest
single improvement this project has produced, and it came from five call sites.

**The mechanism, which is the part worth understanding.** `TOTAL` moved +74.5 even though
`TOTAL_LABELS` was already wired in and unchanged. Its own vocabulary did not change; its
*neighbours'* did.

That is the span-merging diagnosis from the run 2 entry being confirmed and explained. That
entry observed that on shifted documents the subtotal, tax and total collapse into a single
span, and concluded the model had "learned label words as delimiters, not fields as things".
Correct - and the reason it could only learn them as delimiters is that two of the three
delimiters were *constants*. Every training document said `Subtotal`, so the only rule
available was the literal string. On a document saying `Chargeable value` no boundary is
found, the model fails to emit `B-` at the start of the next field, and aggregation - which
splits only on `B-` - merges all three.

Give the subtotal and tax labels ten and nine phrasings and the model has to learn something
shaped like "a label-ish phrase followed by an amount". That generalises to `Chargeable value`,
the boundary appears, and the total stops being swallowed. **Vocabulary and structure were not
competing explanations. The constant labels were manufacturing the structural failure.**

The same reading explains `LINE_AMOUNT` reaching 100%: the table header was also a constant
(`Description Qty Unit Price Amount`) and now has five variants, so the row structure has to
be learned rather than looked up.

**An honest limit on the attribution.** The intervention bundled two changes - four label
lists wired in, and the date formats going from four reachable to six. The totals-block moves
cannot be explained by date formats and belong to the label lists. The date-field moves cannot
be cleanly separated: `DUE_DATE` is 92.5% in run 4, and part of that may be the two new
formats rather than the labels. One edit, two kinds of change. Better than runs 1-3, not
perfect, and worth saying rather than glossing.

Also: run 3's `TAX` figure of 0.0% used in the comparison table was **inferred, not recorded**.
The run 3 entry states `SUBTOTAL` was 0% in every run and does not list `TAX`. `TAX` was 0% in
runs 1 and 2 and its label was hardcoded to three phrasings through run 3, so 0% is very
likely - but the +71.5 for `TAX` rests on an inference and the +73.0 for `SUBTOTAL` does not.

**What is still broken, and the next lever is the same bug in a different costume.**

    INVOICE_NUMBER   13.0%      the worst two, and their numbers are nearly identical
    ISSUE_DATE       12.5%
    LINE_DESCRIPTION 34.0%

`INVOICE_NUMBER` and `ISSUE_DATE` sitting within half a point of each other is the merging
signature again, and the run 2 entry recorded exactly this pair merging:

    ISSUE_DATE   wanted '01/02/2026'
                 got    '117/2026/1701/02/202602/05/2026'

which is an invoice number, an issue date and a due date in one span. `DUE_DATE` has now
escaped to 92.5%, so the tail has separated; the head has not.

**And the cause is a constant of exactly the kind just fixed.** The training generator emits
one invoice-number format, every time:

    emit(f"INV-{issued.year}-{rng.randrange(1000, 9999)}", "INVOICE_NUMBER")

So `INVOICE_NUMBER` is learnable as "the token beginning `INV-`". The shifted generator emits
`123/2026/45`, which shares nothing with that and is additionally date-shaped, so it merges
with the issue date that follows it. The **values** are now the constant, where the **labels**
used to be. It is the same bug class, one layer down, and the real corpus already proves the
constant is wrong: `INV-2026-0042`, `NS-88213`, `BW-2026-771`, `MPW-3310`, `AP-2026-5120` -
at least three shapes across eleven documents, with the prefix varying by vendor.

**Decisions table updated**: the row recording vocabulary as a marginal lever is rewritten,
with the half-applied experiment named as what actually produced the 6.7-point figure.

**The README line this produces is better than the one it replaces.** "Vocabulary did not
help" would have been a dead end honestly reported. "We recorded vocabulary as a dead end, and
it was not - the experiment had only half run, and finding that took a guard that asserts the
generator drew from every list it defines" is a story about measurement discipline, which is
what the project is actually for.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `requirements/06-context.md` | This entry; run 4 in the table |
| `requirements/00-plan.md` | Decisions row on vocabulary rewritten from dead end to largest single lever, with the half-applied experiment named |
| `NOTES.md` | Run 4 recorded, with the withdrawal of the earlier claim |

**Next, in order.**

1. **Vary the invoice-number format in the generator**, the way the label words now vary -
   several prefixes, several shapes, some with a year and some without. Same bug class,
   targeted at the worst field, and the corpus says what the shapes should be.
2. **Confirm the merging before fixing it.** One cell printing wanted-versus-got for
   `INVOICE_NUMBER` and `ISSUE_DATE` on ten shifted documents settles whether they are merging
   or simply wrong. That is how the run 2 diagnosis was made and it cost nothing.
3. Structural variety - field order, filler, optional fields - is still untouched and is still
   the lever nothing has tested.
4. Stage 4 remains the plan's current work. The model has now run four stages ahead of it.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - run 5 prepared: the remaining constants, behind flags

**What was asked.** "Fix the cell or whatever is needed to get a good model." An open mandate,
so this pass takes the three levers the log has been naming and does not stop at the one bug.

**The principle applied.** Run 4's finding was that a constant in the generator becomes a
lookup rule in the model, and that the constant does not have to be the field's own text -
`TOTAL` gained 74.5 points because its *neighbours* stopped being constant. So the work was to
find every remaining constant and remove it. There were three.

| Constant | Field it was pinning | Was |
| --- | --- | --- |
| One invoice-number shape, `INV-{year}-{4 digits}`, in every document of every run | INVOICE_NUMBER 13.0% | The values were the constant where the labels used to be |
| One field order, in every document of every run | the whole header | Position was a perfect cue in training and none at all elsewhere |
| Twenty-two fixed strings for an open-vocabulary field | LINE_DESCRIPTION 34.0% | A lookup table for something unbounded |

**Everything is behind a flag, and that is the design decision.** Four changes at once is how
run 2 produced a number nobody could attribute, and the log has recorded that mistake twice.
So `GENERATOR` is a dict of four independent booleans rather than one switch:

    GENERATOR = {"vary_labels": True,        # the run 4 fix
                 "vary_identifiers": True,   # NEW
                 "vary_structure": True,     # NEW
                 "vary_descriptions": True}  # NEW

All on is the good model. Turning one off and rerunning is the attribution, and everything
else is seeded identically, so each ablation is genuinely one variable. With all four off the
generator reproduces run 1's. The dict is written into `mailman_model.json`, so a set of
weights can say which experiment produced it - which is exactly what three sets of weights
described as "enlarged vocabulary" could not do.

**What varies now.** Measured over 500 generated documents:

    distinct field orderings           1  ->  127
    distinct invoice-number shapes     1  ->   17
    distinct line descriptions        22  ->  778   (1056 combinations reachable)
    vocabulary lists drawn from       11  ->   15

Field order shuffles the number, issue-date, due-date, buyer and currency blocks; the vendor
stays first because it is first on real invoices and the heuristic's `_vendor_name` depends on
it, and the table always precedes the totals because the arithmetic does. Filler lines
labelled `O` are inserted between blocks - `PO Number PO-4471`, `Sort code 20-00-00`, `Order
ref ORD-99120` - deliberately identifier-shaped and money-shaped, so that "a token that looks
like a reference" stops being a usable rule. The subtotal line is now absent 10% of the time
and the tax line 15%, because a field that is always present is a field whose absence has
never been seen.

**The held-out set was not touched, and is now marked FROZEN in the cell.** Runs 1 to 4 were
scored against it; changing it would void the run table. Every change belongs in the training
generator.

**Two new assertions, because two new ways to leak.** The phrase-level disjointness check
cannot see either of the new mechanisms - composed descriptions are not in any list, and
invoice numbers are generated rather than drawn. So:

- all 1056 reachable description combinations are checked against `SHIFT_GOODS`;
- 20000 generated invoice numbers are checked against `^\d{3}/\d{4}/\d{2}$`, the shifted
  set's shape. If training could produce it, `INVOICE_NUMBER` would stop being held out and
  the field this run exists to fix would be the one field it cannot measure.

Both pass. This matters more than it looks: the last time the training vocabulary was enlarged,
words were taken *from* the shifted set and the held-out set quietly stopped being held out.

**The guard caught me, which is the first useful thing it has done.** `BUYER_LABELS` and
`STREETS` were added to `VOCABULARY` and then drawn with `rng.choice` instead of `pick`, so
they were never recorded as drawn - the same class of mistake the guard was written for,
committed by the person who wrote the guard, within an hour. It failed the run by name. Both
now go through `pick`, and the assertion is flag-aware: with `vary_structure` off there is no
title, no filler, one street and one buyer label, so expecting those lists to be drawn would
make the ablation impossible to run.

**A metric that was lying, found while reading the output.** The description-variety print
joined every description in a document into one string and counted those, so it was reporting
document uniqueness as vocabulary size - 428 with composition off, which sounds like variety
and is not. It counts individual description spans now: 22 off, 778 on.

**New diagnostic cell, Colab 20.** Wanted-versus-got for the four weakest fields, and for each
miss it checks whether the wanted string appears *inside* another field's predicted span and
names the field that swallowed it. That is the check that produced the run 2 merging diagnosis
by hand, and run 4 confirmed the diagnosis was right, so it is worth having permanently rather
than reconstructing it each time. The cell prints how to read itself:

    got is EMPTY and wanted appears inside another field  -> spans are merging;
        fix the neighbouring labels or values, not this field
    got is a PREFIX or fragment of wanted                 -> reassembly, not tagging
    got is a different plausible value from the document  -> genuinely mislabelled, and the
        only case where more examples of THIS field is the right answer

**Cell numbering has changed** - the diagnostic insert makes 26 code cells. Colab 19 is still
the scores; Colab 20 is the new diagnostic; the manifest is now Colab 22 and the NOTES.md
block Colab 26.

**Verified by executing, not by reading.** All 45 cells compile. The generator and the
shifted-set cell were run at the full 4000 documents in every flag configuration - all on,
each of the four turned off in turn, and all off - and the assertions hold in each. The new
diagnostic cell was run against a stub tagger to prove the plumbing works. No GPU involved in
any of that.

**Not done, and deliberately.** Model selection on a shifted dev set is still absent:
`save_strategy` is `"no"`, so the exported weights are whatever the last epoch produced, and
run 2 against run 3 showed per-field scores swinging seventy points between epochs. Doing it
honestly needs a third disjoint vocabulary, or a dev/test split of the shifted set with the
limitation stated. That is the next methodological change and it is separate from this one.
The cased base model is also untried.

**Every change made this pass.**

| Cell (Colab) | Change |
| --- | --- |
| 5 | `an_invoice_number` with seven shapes and 25 prefixes; `FILLER_LINES`, `TITLES`, `BUYER_LABELS`, `STREETS`, `GOODS_PREFIXES`, `GOODS_SUFFIXES` |
| 6 | `GENERATOR` flags; block-based `generate_invoice` with shuffled header blocks, filler, optional subtotal and tax; `a_description`; flag-aware never-drawn assertion; ordering, shape and description-variety checks |
| 18 | Shifted generator marked FROZEN; disjointness now covers every list in `VOCABULARY`; composed-description and invoice-number-shape collision assertions |
| 20 | New: the wanted-versus-got diagnostic |
| 22 | Manifest records `generator` |

**Next.** Run 5 on a T4, all flags on, and compare against run 4 (shifted 70.7%, gap 29.3%).
Then read Colab 20 before deciding anything. If run 5 is good, the ablations are worth three
more runs at six minutes each, because "field order was worth N points" is a README line and
"we changed four things and it got better" is not.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - "run 5" explained, and a stale baseline caught by the question

**What was asked.** "What does run 5 mean, am i running the latest notebook and that will be
run 5?" A clarifying question, and it found a bug.

**The answer.** "Run N" is this file's bookkeeping, not anything in the notebook. Each
execution of the training notebook that produces a measured result gets the next number and a
row in the table, so results can be compared across sessions. Runs 1 to 4 have happened; the
next execution is run 5. Nothing in the notebook was ever called that.

**What the question exposed: the notebook was still comparing against run 3.** `BASELINE` was
written before run 4 existed and never updated, so a run 5 launched today would have printed
its improvement against `shifted 47.4% / gap 52.6%` instead of run 4's `70.7% / 29.3%` - and
overstated itself by 23.3 points. `RUN3_PER_FIELD` carried eight fields transcribed from the
log, four of them absent.

Fixed, and the fix is better than a corrected number: run 4's paste carried **all thirteen**
per-field shifted scores, so `BASELINE_PER_FIELD` is now complete rather than partial, and the
comparison table no longer has blank rows.

    BASELINE = {"run": 4, "epochs": 6, "shifted": 0.707, "gap": 0.293}

    INVOICE_NUMBER 13.0   VENDOR_NAME 91.0   BUYER_NAME 64.0   ISSUE_DATE 12.5
    DUE_DATE 92.5   CURRENCY 100.0   SUBTOTAL 73.0   TAX 71.5   TOTAL 80.5
    LINE_DESCRIPTION 34.0   LINE_QUANTITY 88.0   LINE_UNIT_PRICE 98.5   LINE_AMOUNT 100.0

The full run table is now a comment beside `BASELINE`, with the instruction to update it after
every run, because a stale baseline is silent: the run completes, the arithmetic is right, and
the number flatters itself.

**`NEVER_WIRED_IN` became `WATCH`.** It marked SUBTOTAL and TAX as "wired in for the first
time", which was run 4's story and would have been wrong on run 5's output. It now marks
INVOICE_NUMBER, ISSUE_DATE and LINE_DESCRIPTION - what run 5 actually targets.

**And the "how to read it" block was rewritten**, because the old one asked run 4's question.
It now states the three outcomes in advance, including the one that matters most: if a targeted
field stays flat, read the diagnostic cell before doing anything, because a value swallowed by
a neighbouring span is a boundary problem and more variety in that field is the wrong fix. A
noise floor is quoted too - 6 points per field over 100 documents, measured in the run 3
session - so a movement under about 5 points is read as nothing.

**Also flagged to the author, and not a code change:** his Colab session is running the
notebook as it was when he last uploaded it, which is the run 4 version. The file has changed
substantially since - a new diagnostic cell, the generator rewrite, and the baseline above -
so Run all in the existing tab would re-run run 4. The updated file has to reach Colab first.

**Every change made this pass.**

| Cell (Colab) | Change |
| --- | --- |
| 4 | `BASELINE` is run 4; the whole run table as a comment; instruction to update it after each run; the "one variable" message no longer names the vocabulary specifically |
| 19 | `BASELINE_PER_FIELD` with all thirteen of run 4's fields; `WATCH` replaces `NEVER_WIRED_IN`; table iterates `FIELD_LABELS` so nothing is dropped; column header and "how to read it" rewritten |
| 26 | Same rename, and the header names the baseline run rather than hardcoding 3 |

Verified: 45 cells, no syntax errors, no surviving `RUN3_PER_FIELD` or `NEVER_WIRED_IN`
reference; Colab 4 rendered on the GPU path; Colab 19 rendered against a fabricated run 5
result to check every format string and the marker logic; the generator and shifted-set cells
re-run at 4000 documents with the assertions holding.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - run 5: 84.1% shifted, and a regression that explains run 4

**The result.**

    in-distribution 100.0%   shifted 84.1%   gap 15.9%
    run 4 baseline           shifted 70.7%   gap 29.3%
    movement                        +13.4%        -13.4%

| Run | Epochs | Generator | Shifted | Gap |
| --- | --- | --- | --- | --- |
| 1 | 6 | small vocabulary | 40.7% | 59.3% |
| 2 | 2 | vocabulary half-applied | 46.4% | 53.6% |
| 3 | 6 | vocabulary half-applied | 47.4% | 52.6% |
| 4 | 6 | vocabulary fully applied | 70.7% | 29.3% |
| 5 | 6 | + identifiers, structure, descriptions | **84.1%** | **15.9%** |

Run 1 to run 5, at constant epochs and constant everything except what the generator emits:
**40.7% to 84.1%, and the gap from 59.3 points to 15.9.** Every point of that came from
removing constants from the training data. Not one came from the model, the optimiser, the
architecture or the training length.

**Per field, against run 4.**

| Field | run 4 | run 5 | move |
| --- | --- | --- | --- |
| INVOICE_NUMBER | 13.0% | **99.0%** | +86.0 |
| ISSUE_DATE | 12.5% | 68.0% | +55.5 |
| TOTAL | 80.5% | 99.5% | +19.0 |
| LINE_DESCRIPTION | 34.0% | 46.0% | +12.0 |
| LINE_QUANTITY | 88.0% | 98.5% | +10.5 |
| VENDOR_NAME | 91.0% | 99.5% | +8.5 |
| BUYER_NAME | 64.0% | 69.0% | +5.0 |
| TAX | 71.5% | 73.0% | +1.5 |
| LINE_UNIT_PRICE | 98.5% | 100.0% | +1.5 |
| CURRENCY, SUBTOTAL, LINE_AMOUNT | | unchanged | 0.0 |
| **DUE_DATE** | 92.5% | **68.0%** | **-24.5** |

The invoice-number fix is the cleanest result the project has produced: one constant removed,
one field from 13% to 99%, and the prediction was written down before the run.

**The regression is the interesting part, and it reinterprets run 4.**

`DUE_DATE` fell 24.5 points, far outside the 6-point noise floor. And `ISSUE_DATE` and
`DUE_DATE` now sit on **exactly** the same number - 136/200 each. So do `SUBTOTAL` and `TAX`,
at 146/200 each. Two adjacent same-type pairs, each landing on an identical count, is not
coincidence: it is what within-pair confusion looks like. When it gets one right it gets both
right, and when it fails it fails both.

**Why the due date got worse when everything else got better.** Until run 5 the training
generator always emitted the issue date before the due date. **So does the shifted generator.**
So a model that learned nothing more than "the first date is the issue date, the second is the
due date" scored 92.5% on the held-out set - not because it had generalised, but because the
held-out set happened to share training's field order.

Run 5 shuffles the header blocks, so position stops being a rule. What is left is the label
word, and on the shifted set the label words are unseen - `Rendered`, `Supply date` against
`Discharge by`, `Clearance required`. The model cannot tell them apart, and both dates land at
68%.

**That means run 4's 92.5% was partly an artifact of the test set, and run 5's 68% is the more
honest number.** The shifted generator varies vocabulary but has exactly one field order, so
it has never tested structural generalisation at all - a positional cue transferred for free
in runs 1 to 4. This is the third time a number in this project has looked better than the
thing it was measuring, and the second time the cause was the evaluation rather than the model.

It also means **the overall 84.1% is understated relative to runs 1-4**, which were collecting
free points from a coincidence that run 5 gives up.

**What this does not license.** The shifted generator is frozen and must stay frozen - runs 1
to 5 are scored against it and varying its order now would make the table meaningless. The
right move is a *second* held-out set that varies structure as well as wording, reported
alongside rather than instead. That is a new measurement, not an edit to an old one.

**The remaining failures, and what they are not.** Three things are now weak, and none of them
looks like a vocabulary problem:

    ISSUE_DATE / DUE_DATE   68.0% each   the two are not distinguished
    SUBTOTAL   / TAX        73.0% each   the two are not distinguished
    LINE_DESCRIPTION        46.0%        open vocabulary, improved but still the worst

The pairs are the story. Both are adjacent, both are the same shape (a label then a value),
and in both cases the only thing separating them is the meaning of an unseen label word.
`Discharge by` is a payment deadline to anyone who reads English, and DistilBERT knows that
before fine-tuning ever starts. **The hypothesis worth testing next is that six epochs at
5e-5 on a narrow generated task destroys the pretrained semantics that would carry it.** The
model is at 100% in-distribution from epoch one; everything after that is memorising a
generator at the cost of the language model underneath.

That is cheap to test and it is the first lever in this project that is not the data.

**Not yet confirmed, and it should be before anything is changed.** The diagnostic cell
(Colab 20) was not read. The identical pair counts are strong evidence of confusion, but
whether the model is swapping the two labels, merging them into one span, or emitting nothing
for one of them are three different faults with three different fixes. The cell prints exactly
that, and the standing rule in this file is diagnose then fix.

**Every change made this pass.**

| File | Change |
| --- | --- |
| `notebooks/train_extractor.ipynb` Colab 4 | `BASELINE` is run 5; run table extended |
| `notebooks/train_extractor.ipynb` Colab 19 | `BASELINE_PER_FIELD` is run 5's thirteen; `WATCH` is now the two pairs plus descriptions; the identical-pair finding written into the comment |
| `requirements/06-context.md` | This entry, run 5 in the table |
| `NOTES.md` | Run 5 recorded |

**Next, in order.**

1. **Read Colab 20** on the run 5 model. Swap, merge or silence - three faults, three fixes.
2. **An epoch and learning-rate sweep.** 2, 4 and 6 epochs on run 5's data, nothing else
   changed. The claim being tested is that the fine-tune is destroying the pretrained
   semantics the unseen label words depend on. First non-data lever in the project.
3. **The three ablations** - identifiers, structure, descriptions - one flag off each, six
   minutes apiece. "Varying the invoice number was worth 86 points on that field" is a README
   line; "we changed three things" is not.
4. **A structurally shifted evaluation set**, reported alongside the frozen one, because the
   frozen one cannot see field order and has been handing out free points for five runs.
5. Heuristic against trained on the eleven-document corpus. Still the comparison that decides
   whether the model ships at all.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - run 6: the diagnostic read, and a variance finding that outranks it

**What was asked.** The author re-ran the notebook to recover the model files, uploaded the
result as `models/extractor`, and pasted Colab 20 from that run. Then: "do i need to paste
anything for step 3 and 4 you gave?"

**The re-run is a sixth training run, and comparing it to run 5 is the most important thing in
this entry.** Identical code, identical generator, identical seed for the data, identical 6
epochs. Only the training process differed.

    field              run 5     run 6    move
    SUBTOTAL           73.0%     49.0%   -24.0
    TAX                73.0%     50.0%   -23.0
    ISSUE_DATE         68.0%     56.5%   -11.5
    LINE_DESCRIPTION   46.0%     55.0%    +9.0

**Run-to-run variance on a single field is at least 24 points.** That is not a small
correction; it is larger than most of the per-field movements this log has spent four entries
attributing to specific causes.

**What this invalidates, stated plainly.**

- The 6-point noise floor quoted since the run 3 session is a **sampling** floor - the same
  model over two disjoint samples of documents. It says nothing about training variance, and
  it has been used as though it did. Every "outside the noise band" judgement made against it
  is unsupported.
- **The DUE_DATE regression story from the run 5 entry is not established.** The mechanism
  argued there - that runs 1-4 read the due date positionally because training and the shifted
  set share a field order, and that shuffling removed the crutch - is still a good a priori
  argument, and the fact that ISSUE_DATE and DUE_DATE landed on identical counts still points
  at within-pair confusion. But a 24.5-point move cannot be distinguished from a 24-point noise
  band on one pair of runs. The explanation stands as a hypothesis; the evidence does not.
- Small per-field claims across runs 1-5 - TAX +1.5, LINE_UNIT_PRICE +1.5, BUYER_NAME +5.0 -
  mean nothing and should not be repeated.

**What survives.** The large effects are far outside any plausible noise band and the overall
figures moved monotonically across five runs: INVOICE_NUMBER 13% to 99%, SUBTOTAL and TAX 0%
to the seventies, overall 40.7% to 84.1%. The headline - that every point came from removing
constants from the generator - is unaffected. What is gone is the fine-grained attribution.

**Why it happens, and what was done.** `TrainingArguments` defaults to `seed=42` and `Trainer`
calls `set_seed` with it, but that happens *after* `AutoModelForTokenClassification` is
constructed, so the classifier head was initialised from whatever state the process was in.
`set_seed(SEED)` now runs before the model is built, and `seed` is passed explicitly.

That does not buy determinism. cuDNN kernel selection and GPU reduction order are still free,
and Colab hands out different GPUs between sessions. So the manifest now records `gpu` and
`seed` alongside the scores, because two runs cannot be compared without knowing what they ran
on. **The honest handling of the remainder is to repeat a configuration and quote a range**,
and that is now the first thing the next sitting should do.

**The diagnostic, which is what was actually asked for.** Colab 20 on the run 6 model, and it
is unambiguous. Three distinct faults, not one.

**1. SUBTOTAL and TAX merge into a single span, in both directions.**

    wanted  €9,623.69      got  €9,623.69€1,684.15      (subtotal swallowed the tax)
    wanted  $13,247.54     got  (nothing)               ^ swallowed by TAX
    wanted  cad4,012.24    got  cad4,012.24cad802.45
    wanted  eur1,817.65    got  eureur                  ^ swallowed by TOTAL

Confirmed: this is a boundary failure, not a vocabulary gap. On the shifted set the label
between the two amounts is unseen - `Chargeable value`, `Levy` - so no `B-` is emitted at the
tax label and the subtotal span runs straight through it. Exactly the mechanism run 4
demonstrated, still present between the two fields whose labels are hardest.

**More variety in SUBTOTAL or TAX examples is therefore the wrong fix**, which is what the
cell was built to tell us and what would have been done otherwise.

**2. LINE_DESCRIPTION absorbs the last word of the table header.**

    wanted  nightshiftpremium...      got  extensionnightshiftpremium...
    wanted  perfectbinding,per100...  got  binding,per100...            (truncated)

The shifted header is `Narrative Count Tariff Extension`. `Extension` and `Tariff Extension`
are being pulled into the first description span. Five training headers are not enough for the
model to recognise an unseen header row as `O`.

**And a measurement artifact worth recording**: `serving_accuracy` joins every line-item value
in a document into one string, so a single bad boundary on line 1 fails the whole document's
LINE_DESCRIPTION. The field is scored document-level, not per line. That is a defensible
metric but it is not what the column heading implies, and it partly explains why
LINE_DESCRIPTION sits in the forties while LINE_AMOUNT is at 100%.

**3. ISSUE_DATE has two separate faults.**

    wanted  01/02/2026    got  11720261701/02/202602/05/2026   merge: number + issue + due
    wanted  2026-08-27    got  2026-08-272026-09-17            merge: issue + due
    wanted  03/08/2026    got  03/08                           truncation, lost the year
    wanted  15.04.2026    got  15.04.                          truncation
    wanted  14june2026    got  14                              truncation, lost two thirds

The merging is the same boundary failure. The truncation is new and is not a boundary problem
at all - the span simply ends early, most severely on written dates. That is a third fault
needing a third fix, and nothing in the plan currently addresses it.

**Answering the question asked.** For an epoch sweep or an ablation, Colab 19 is the paste -
it carries the overall figures and all thirteen per-field rows. Colab 20 is only worth pasting
when a field moves and the reason is not obvious. But both of those steps are now demoted:
with a 24-point noise band, an ablation cannot say what it was built to say.

**Every change made this pass.**

| Cell (Colab) | Change |
| --- | --- |
| 15 | `set_seed(SEED)` before the model is constructed; `seed` passed to `TrainingArguments`; the 24-point observation recorded as the reason |
| 22 | Manifest records `seed` and `gpu` |

**Next, reordered by what the variance finding implies.**

1. **Measure the noise floor properly.** Three runs of the current configuration, changing
   nothing, quoting the range per field. Eighteen minutes, and without it no ablation can be
   read. This is stage 9 work and it is the kind of thing an interviewer asks about.
2. **Then the ablations**, interpreted against that range rather than against 6 points.
3. **The boundary fault** is now confirmed and is the largest remaining lever. The candidates
   are more label variety between adjacent money fields, and a gentler fine-tune - fewer
   epochs or a lower learning rate - on the theory that the pretrained semantics that would
   let `Levy` read as a tax word are being trained away.
4. **Date truncation** is a separate, newly identified fault.
5. Heuristic against trained on the eleven-document corpus. Unchanged in priority and still
   the comparison that decides whether the model ships.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - addendum to run 6: the full variance table, read off the manifest

The entry above was written from the four fields Colab 20 happened to print. The installed
model's `mailman_model.json` carries `per_field_shifted` for all thirteen, so the comparison
can be complete. **Run 5 against run 6, identical code, identical data, identical epochs, and
nothing different but the training process:**

    FIELD                   run 5    run 6    swing
    INVOICE_NUMBER          99.0%    99.0%    +0.0
    VENDOR_NAME             99.5%    69.5%   -30.0   <--
    BUYER_NAME              69.0%    77.5%    +8.5
    ISSUE_DATE              68.0%    56.5%   -11.5
    DUE_DATE                68.0%    56.5%   -11.5
    CURRENCY               100.0%   100.0%    +0.0
    SUBTOTAL                73.0%    49.0%   -24.0
    TAX                     73.0%    50.0%   -23.0
    TOTAL                   99.5%    99.0%    -0.5
    LINE_DESCRIPTION        46.0%    55.0%    +9.0
    LINE_QUANTITY           98.5%    99.0%    +0.5
    LINE_UNIT_PRICE        100.0%    99.5%    -0.5
    LINE_AMOUNT            100.0%   100.0%    +0.0

    OVERALL                 84.1%    77.7%    -6.4

**The largest swing is 30 points, not 24.** `VENDOR_NAME` went from 99.5% to 69.5% with
nothing changed. The overall figure moved 6.4 points.

**The structure of the variance is the useful part, and it is not uniform.** Two groups:

- **Stable to within a point**: INVOICE_NUMBER, CURRENCY, TOTAL, LINE_AMOUNT, LINE_QUANTITY,
  LINE_UNIT_PRICE. All at 99-100% in both runs. These are solved, and repeated runs agree.
- **Unstable by 8 to 30 points**: VENDOR_NAME, BUYER_NAME, both dates, SUBTOTAL, TAX,
  LINE_DESCRIPTION. Every one of them is a field the diagnostic shows failing on a *boundary*.

That is not a coincidence and it sharpens the diagnosis. A field the model has genuinely
learned scores the same every time. A field whose answer depends on finding a span edge in
text it has never seen is decided by where the weights happened to land, and lands differently
every run. **The variance is a symptom of the boundary problem rather than a separate issue.**

**Two things stay stable across both runs and are therefore real findings, not noise:**

- ISSUE_DATE and DUE_DATE score identically in both runs - 68.0/68.0, then 56.5/56.5.
- SUBTOTAL and TAX score within a point of each other in both - 73.0/73.0, then 49.0/50.0.

Within-pair confusion reproduces across independent training runs even as the level swings 24
points. The pairs finding survives; the levels do not.

**The model now installed at `models/extractor` is run 6, not run 5.** Its manifest reads
`serving_shifted: 0.7773`. The re-run to recover the files produced a different and materially
worse model - 6.4 points overall, 30 on a field - and run 5's weights are gone unless that
Colab session still exists. Nothing depends on them yet, and the honest reading is that
"run 5's model" was never a thing to preserve: it was one sample from a distribution whose
spread nobody had measured.

Its manifest also carries `"baseline": {"run": 4 ...}` and no `seed` or `gpu` key, which dates
it to the notebook as it stood before this session's last two edits. Useful confirmation that
the manifest can identify which notebook produced a set of weights, which is what it is for.

**A workflow note that follows.** `Colab 22` already prints the manifest minus the token-level
per-field block, and that print contains everything needed to record a run - the serving
scores, all thirteen shifted per-field figures, the generator flags, the baseline, the epoch
count, and now the seed and GPU. It is a few kilobytes. **Pasting Colab 22 is strictly better
than pasting Colab 19**, and it removes any reason to download 250MB of weights for a run
whose only purpose is measurement.

**This supersedes the "at least 24 points" figure in the entry above.** It is 30, and the
noise is concentrated entirely in the boundary-dependent fields.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - run profiles, because the GPU quota is a real constraint

**What was asked.** "This might blow out the GPU free tier, this will take time but if it ends
my limit, i will do it without a gpu."

**Why that mattered more than it looked.** The plan handed over was six GPU runs - three to
measure the noise floor, three ablations - at roughly six minutes each. On Colab's free tier
that is a plausible way to run out mid-series, and the old CPU fallback made running out
actively harmful: it silently dropped `EPOCHS` from 6 to 2. Epochs are the one variable already
known to move individual fields by seventy points, and dropping them silently is precisely how
run 2 became uninterpretable. So the fallback that existed for exactly this situation was a
trap set for it.

**The change: two named run profiles, and epochs are fixed in both.**

    full    4000 documents, 6 epochs, batch 16, 200 eval documents.   What runs 1-6 used.
    cheap   1500 documents, 6 epochs, batch 8,  150 eval documents.   About a third of the
                                                                     work; viable on CPU in
                                                                     tens of minutes.

`PROFILE = "auto"` picks full on a GPU and cheap on CPU, and either can be forced. **Cutting
documents rather than epochs is the whole point**: it keeps the variable known to matter fixed
and moves one that has never been shown to.

**The comparability rule is now structural rather than a single check on epochs.** `RUN_SHAPE`
carries profile, documents and epochs, and `COMPARABLE` is true only when all three match the
baseline. The manifest records `run_shape` and `comparable_to_baseline`, and a non-matching run
gets an automatic caveat naming both shapes.

The message a cheap run prints is the useful part:

    NOT COMPARABLE TO THE BASELINE: this run is cheap profile, 1500 docs, 6 epochs.
    This is fine for an ABLATION SERIES - every run at the same profile is comparable
    to every other, which is what an ablation needs. It is not a number to put beside
    run 5.

That is the distinction that makes a CPU fallback worth having. **An ablation asks which of
three changes did the work, and that question is answered entirely by differences within a
series.** The absolute level can be lower without costing anything, as long as every run in the
series shares a shape and the shape travels with the result. What a cheap run cannot do is
extend the run table, and now it cannot pretend to.

**The plan handed over was also wrong on priorities, and is corrected here.** Three runs to
measure a noise floor was the right instinct against an unmeasured spread, but `set_seed` now
runs before the model is constructed, and the classifier head's initialisation was one
identified source of that spread. **Two seeded runs of the same configuration answer the
question a three-run spread was going to answer**, and answer it better: if two seeded runs
agree, the variance is largely gone and every ablation afterwards is readable from a single
run. If they disagree, no affordable number of runs was going to make per-field ablation
attribution work, and the honest response is to report ranges and trust only large effects.

So the GPU budget is now: **two runs to find out whether the notebook is reproducible, then
three ablations that are only worth spending on if it is.** If the quota dies after the first
two, nothing has been wasted and the ablations move to CPU at the cheap profile.

**Verified.** All 26 code cells compile; the run-size cell was executed on both branches, with
`ON_GPU` forced true and false, to confirm the messages and the numbers.

**Every change made this pass.**

| Cell (Colab) | Change |
| --- | --- |
| 4 | `PROFILE` with full and cheap; epochs fixed at 6 in both; `RUN_SHAPE` and `COMPARABLE`; the run table extended with run 6 and a note that runs 5 and 6 are the same configuration |
| 22 | Manifest records `run_shape`; `comparable_to_baseline` uses the structural check; the automatic caveat names both shapes |

**Next.**

1. Two full-profile GPU runs, identical, paste Colab 22 from each. Does seeding hold.
2. If yes: three ablations, one flag off each, GPU if the quota allows and cheap profile on
   CPU if not.
3. If no: stop running ablations, report ranges, and treat only large effects as real.

**Uncommitted.** Everything remains in the working tree by request.

### 2026-09-02 - runs 7 and 8: seeding worked, and the ablations are cancelled

**What was asked.** Two full-profile GPU runs of an identical configuration, to find out
whether `set_seed` before model construction made the notebook reproducible. Both manifests
pasted. Both on a Tesla T4, both `comparable_to_baseline: true`, both seed 20260901.

**Seeding worked, and it worked well.**

    runs 7 vs 8, identical seed        overall spread  1.4%   worst field  6.5%
    runs 5 vs 6, unseeded head         overall spread  6.4%   worst field 30.0%

Constructing `AutoModelForTokenClassification` before `set_seed` ran was a real bug and fixing
it cut run-to-run variance by roughly a factor of four.

**And it did not solve the problem, because the variance that matters is across
initialisations, not within one.**

    FIELD               run 5   run 6   run 7   run 8    same-seed   across inits
    OVERALL             84.1%   77.7%   76.0%   74.6%        1.4%           9.5%
    CURRENCY           100.0%  100.0%  100.0%  100.0%        0.0%           0.0%
    LINE_AMOUNT        100.0%  100.0%  100.0%  100.0%        0.0%           0.0%
    LINE_UNIT_PRICE    100.0%   99.5%  100.0%  100.0%        0.0%           0.5%
    INVOICE_NUMBER      99.0%   99.0%  100.0%   98.5%        1.5%           1.5%
    BUYER_NAME          69.0%   77.5%   76.0%   73.5%        2.5%           8.5%
    DUE_DATE            68.0%   56.5%   74.5%   75.0%        0.5%          18.5%
    ISSUE_DATE          68.0%   56.5%   74.5%   76.0%        1.5%          19.5%
    SUBTOTAL            73.0%   49.0%   54.0%   47.5%        6.5%          25.5%
    LINE_QUANTITY       98.5%   99.0%   74.0%   71.0%        3.0%          28.0%
    TOTAL               99.5%   99.0%   71.5%   71.5%        0.0%          28.0%
    LINE_DESCRIPTION    46.0%   55.0%   25.5%   24.0%        1.5%          31.0%
    TAX                 73.0%   50.0%   37.5%   32.5%        5.0%          40.5%

Four runs of one configuration. **Overall ranges from 74.6% to 84.1%, and `TAX` ranges from
32.5% to 73.0% - forty points, from nothing but where the weights started.**

**The clean split, and it is the finding.** Exactly four fields are stable across every
initialisation: `CURRENCY`, `LINE_AMOUNT`, `LINE_UNIT_PRICE` and `INVOICE_NUMBER`, all at
98.5-100% every time. Every one of them has an unambiguous surface form - a three-letter code,
money in a fixed column position, and since run 5 an identifier that follows a label. **Every
unstable field is one the diagnostic shows failing on a span boundary.** A field the model has
genuinely learned scores the same whatever the seed; a field that needs a boundary found in
unseen text is decided by initialisation luck.

**What this cancels.** The ablation series is off. Detecting whether `vary_structure`
contributed five points or fifteen, against a 9.5-point spread from initialisation alone,
needs several runs per configuration - twelve or more runs for four configurations. That is
not affordable on a free GPU tier and it was not worth it even if it were.

**What it costs, honestly:** the individual contributions of identifier variety, structural
variety and description variety cannot be separated. Run 5 changed three things at once and
the budget to unpick them does not exist. That goes in the README as a limitation, not as a
result.

**What survives, and it is not nothing.** Two effects are far outside any plausible band and
reproduce across independent initialisations:

- **Vocabulary fully applied.** Run 1's 40.7% against runs 5-8 averaging 79.0%. Thirty-eight
  points against a band of ten.
- **Identifier variety.** `INVOICE_NUMBER` from 13.0% to 98.5-100% across four independent
  initialisations, having sat at 4-13% for four runs before it. As close to certain as this
  setup produces.

**A correction that follows immediately: 84.1% was the best of three draws, and quoting it was
the same error as quoting a token-level F1 of 1.000.** The honest figure for this
configuration is **79.0% mean, range 74.6-84.1 over three initialisations**. The run 5 entry's
headline number is superseded on those grounds - not because the run was wrong, but because
one run was never the measurement.

`BASELINE` in the notebook is now that range rather than a point, and Colab 19 judges a result
against it:

    INSIDE the range already observed for this exact configuration (74.6%-84.1%).
    That is not evidence of anything. Whatever changed, this run does not show it.

That message is the whole lesson made mechanical. Any future change producing less than about
ten points overall gets told, before anyone can get attached to it, that it has shown nothing.

**Why this is a better result than the ablations would have been.** The project exists to
demonstrate measurement discipline, and "we measured the noise before we attributed anything,
found it was forty points on a field, and cancelled a planned experiment because it could not
have supported its own conclusion" is a stronger thing to walk an interviewer through than
three attribution numbers would have been. It is also the fourth time in this project that
measuring the measurement changed the answer - after the token-level F1, the corpus counted
rather than compared, and the half-applied vocabulary.

**Every change made this pass.**

| Cell (Colab) | Change |
| --- | --- |
| 4 | `BASELINE` is a range - mean, low, high, initialisation count - with the full run table and the variance breakdown; prints the range |
| 19 | Judges the run against the observed range and says plainly when a result is inside it |

**Next.**

1. **Stop training.** The model has now run five stages ahead of the plan, and this session
   produced the result that says further runs cannot pay for themselves at this budget.
2. **Heuristic against trained on the eleven-document corpus.** Zero GPU, no Docker. The
   comparison that decides whether a 250MB model ships at all, and the one the notebook's own
   final line has been asking for since stage 3.
3. **Stage 4, the validation layer.** The actual current work.

**Uncommitted.** Everything remains in the working tree by request.
