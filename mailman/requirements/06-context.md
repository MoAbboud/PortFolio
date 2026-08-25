# mailman - Context and handoff

## Read this first

Nothing is built. As of 2026-08-25 this folder is the entire project.

The current work is **stage 0 in [00-plan.md](00-plan.md): the scaffold.** FastAPI, Docker
Compose with PostgreSQL, Alembic migrations for the seven tables, `/health` green, git
initialised with real commit messages from the first commit.

The single most important thing about this project: **stages 7 and 8 are the point.** The
pipeline is the setting; the recorded baseline and the measured iteration are what make it
worth building. If effort has to be cut, cut the review UI, cut the deployment, cut the MCP
server - never cut the measurement.

There are no dates anywhere in these documents. Stages are ordered by dependency.

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

`NOTES.md` is written by hand and never generated. What was tried, what the numbers did,
what was surprising. It is the record no tool can produce, and it is where the credibility
lives. It becomes the README's most credible section.

## Decisions, with what was rejected

| Decision | Rejected alternative | Why |
| --- | --- | --- |
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
- **Hosting cost.** A container plus hosted PostgreSQL may not be free any more. The public
  link is worth something to a reader, but not a monthly bill for a portfolio project. Worth
  checking before stage 10 rather than during it.

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
