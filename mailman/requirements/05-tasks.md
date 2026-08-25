# mailman - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Nothing is built. Every task below is open.

Stages are ordered by dependency, not by calendar. Each one leaves something that runs.

Two habits that run through all of them:

- **Commit as the work happens, with real messages.** The history is part of what is on
  display. It is not squashed at the end.
- **Keep `NOTES.md` by hand.** What was tried, what the numbers did, what was surprising.
  It is written by the person doing the work, never generated, and it becomes the most
  credible section of the README.

## Stage 0 - Scaffold

- [ ] `git init`, real commit messages from the first commit
- [ ] FastAPI project skeleton
- [ ] Docker Compose bringing up the service and PostgreSQL together
- [ ] Alembic wired in, first migration creating all seven tables
- [ ] `GET /health` returning green
- [ ] PowerShell run instructions in the README, verified from a clean checkout
- [ ] Settings from the environment, including the provider key. Nothing in source
- [ ] `NOTES.md` started

## Stage 1 - Ingestion

- [ ] Document store behind one interface, local files as the first implementation
- [ ] S3-shaped path layout from the start, so the AWS move is a client swap
- [ ] `POST /documents` accepting PDF and image uploads
- [ ] Detect the media type from the bytes, not the extension
- [ ] Insert the `documents` row, return the id
- [ ] One status-transition function that also appends to `status_history`. Nothing else
      writes `status`
- [ ] PDF text extraction with pdfplumber, written beside the original in the store
- [ ] Leave scanned images without a text layer for later, and leave spreadsheets for later.
      Both are recorded as **not supported** rather than half-handled: a document the
      pipeline cannot read fails loudly with a reason, and never produces a thin extraction
      that looks like a real one

## Stage 2 - First extraction

- [ ] Pydantic model for the invoice shape: header fields, line items, totals
- [ ] `Decimal` for every amount, currency carried alongside. No float anywhere
- [ ] Date parsing that records the convention it assumed and flags the ambiguous ones
- [ ] Extractor protocol, one provider implementation, provider client imported lazily
- [ ] Call the model with the Pydantic model as the structured output shape
- [ ] Parse into the model, store the row in `extractions`
- [ ] Store `raw_response` unmodified alongside `extracted_data`
- [ ] Record `model_name` and `prompt_version` on every row
- [ ] Log `latency_ms` and `token_count` from the very first extraction. They cannot be
      backfilled
- [ ] Handle malformed JSON explicitly: row written, `extracted_data` null, `error` set,
      document to `failed`
- [ ] Handle valid JSON with missing required fields explicitly, and distinguish it from
      malformed
- [ ] Handle timeout and transport errors: retry with backoff inside the extractor, then
      `failed`
- [ ] Record the attempt count on the row

## Stage 3 - Ten documents end to end

The stage that generates the validation rules. Do not write rules before it.

- [ ] Synthetic invoice generator with controllable vendor, layout, currency and dates
- [ ] The generator emits the labels file at the same time as the document
- [ ] Ten documents with genuine variety: several vendors, one with many line items, one
      with a discount line, one with an unusual date format, one two-page
- [ ] Run all ten through the pipeline
- [ ] **Write down every place it got something wrong.** That list is the input to stage 4
- [ ] Confirm: upload a PDF, get structured data in PostgreSQL

## Stage 4 - Validation layer

- [ ] Rule as a small, individually testable function with a name and a severity
- [ ] Registry the pipeline runs over
- [ ] One row written to `validation_results` per rule per document, passes included
- [ ] Messages that name the numbers, so a reviewer knows what to look at
- [ ] Required fields present (error)
- [ ] Line items sum to subtotal (error)
- [ ] Subtotal plus tax equals total (error)
- [ ] Line arithmetic: quantity times unit price equals amount (error)
- [ ] Total matches the total printed on the document (error)
- [ ] Currency consistent across all amounts (error)
- [ ] Invoice number matches the expected format (error)
- [ ] Issue date plausible (error)
- [ ] Due date not before issue date (warning)
- [ ] Vendor resolves against `vendors`, with normalisation and the alias list (warning)
- [ ] Invoice number not already recorded for this vendor (error)
- [ ] Add the rules that came out of stage 3 that are not on this list
- [ ] Errors route to `needs_review`. Warnings do not
- [ ] A unit test per rule, including the case where it should pass

## Stage 5 - Confidence and routing

- [ ] Decide what composite confidence is made of, and be able to defend it
- [ ] Required fields populated, fields parsing as their types, validation outcomes, and the
      model's own confidence contributing least
- [ ] Store it on the extraction row
- [ ] Pick a threshold. **Write down why that threshold** in `NOTES.md`
- [ ] Route: any failed error rule, or confidence under threshold, goes to `needs_review`
- [ ] Confidence can send a document to review and never rescue one
- [ ] Threshold from configuration, not a literal in the pipeline

## Stage 6 - Canonical promotion, corrections, tests

- [ ] `POST /documents/{id}/approve` promotes the extraction into `invoices` and
      `line_items`
- [ ] Promotion and the status change to `approved` in **one transaction**
- [ ] Unique constraint on (`vendor_id`, `invoice_number`) enforced in the database
- [ ] `POST /documents/{id}/corrections` logs one row per changed field
- [ ] Corrections re-run validation and write a new set of results rather than updating
- [ ] `field_path` uses the same dotted paths the harness will use
- [ ] `POST /documents/{id}/reprocess`, optionally with a `prompt_version`
- [ ] `GET /documents?status=...&limit=...`
- [ ] `GET /documents/{id}` returning document, latest extraction, validation results
- [ ] `GET /documents/{id}/extraction`
- [ ] `GET /vendors`
- [ ] `GET /metrics`: counts by status, auto-approval rate
- [ ] pytest over the state machine: every legal transition, and every illegal one rejected
- [ ] pytest over the transaction boundary: a failure mid-promotion leaves no partial invoice
- [ ] pytest over corrections and re-validation

## Stage 7 - Corpus and baseline

The pivot. Everything before this was building; everything after is measured.

- [ ] Grow the corpus to thirty to forty documents
- [ ] Generator emits labels for the synthetic ones, so ground truth is by construction
- [ ] Hand-label the public sample documents, which is the only hand-labelling needed
- [ ] Cover the failures worth catching, not just clean invoices: second currency, an
      unusual date format, a discount line, many line items, two pages, a document that is
      not an invoice at all
- [ ] Include documents the pipeline **cannot yet handle** - no text layer, a skewed scan, a
      spreadsheet with the columns out of order - and let the harness report them as
      unsupported rather than as wrong. An unsupported count that is visible in every run is
      a roadmap; a document quietly left out of the corpus is a forgotten TODO
- [ ] Labels file beside each document, in the same shape the extractor produces
- [ ] Harness: run every document through the real pipeline via the command line
- [ ] Field-by-field comparison, by field kind: exact, normalised, date, decimal
- [ ] Line items matched as a set, reported as precision and recall over lines
- [ ] Record every wrong field with its expected value, actual value and document
- [ ] Record model name, prompt version and rule set on every run
- [ ] Report per-field accuracy with the count behind each rate
- [ ] Score already-stored extractions without calling the provider again
- [ ] **Record the baseline before changing anything**
- [ ] Write the baseline and the list of fields it gets wrong into `NOTES.md`

## Stage 8 - Iteration against the harness

The part that makes the project worth talking about. One change at a time, measured, and the
result written down whether it helped or not.

- [ ] Restructure the prompt around the document layout rather than a flat field list
- [ ] Line items in a separate pass from the header fields
- [ ] Supply similar labelled documents as examples
- [ ] A different model
- [ ] Page image alongside the text where the text layer is poor
- [ ] Whichever specific fixes the baseline's per-field failures point at
- [ ] Revisit the confidence threshold now there is a measurement behind it
- [ ] Record every attempt in `NOTES.md`, including the ones that did nothing or made it
      worse

## Stage 9 - Review queue

- [ ] Queue page reading `GET /documents?status=needs_review`, oldest first
- [ ] Show the reason each document is waiting
- [ ] Review page: the document beside the fields, on one screen
- [ ] Failed rules highlighted on the fields they implicate
- [ ] Editing a field and approving in one pass
- [ ] Reject with a reason, filing nothing
- [ ] Time one full pass through a queue of ten and see whether it is actually usable

## Stage 10 - Deployment and README

- [ ] Deploy with a public link
- [ ] README: the problem, the pipeline diagram, the accuracy numbers, what was tried that
      did not work, the known limitations
- [ ] Accuracy figures on `GET /metrics` as well as in the README
- [ ] Export the corrections log as candidate labels, closing the loop back to the corpus

## Stage 11 - MCP server (optional)

- [ ] Decide which tools are exposed: extraction only, or the queue as well
- [ ] Tools over the API that already exists
- [ ] A confirmation gate on anything with a side effect
- [ ] Drive it from a client and confirm it behaves

## Stage 12 - AWS (optional)

- [ ] Documents in S3, as a second implementation of the storage interface
- [ ] Database in RDS
- [ ] Extraction in Lambda
- [ ] Work out what one document costs to process end to end

## Blocked

| Task | Waiting on |
| --- | --- |
| The validation rules | The failure list from stage 3 |
| The confidence threshold | A measurement from stage 7 |
| Everything in stage 8 | A recorded baseline |
| Deployment | A decision on what hosted PostgreSQL costs |

## Explicitly not doing

- A second document type before stage 10 is finished.
- Automatic learning from corrections. They are recorded for a person to use.
- Fuzzy vendor matching beyond normalisation and the alias list.
- Multiple users, roles, or authentication beyond one shared secret.
- A front-end build step.
- Deleting documents. Rejection is the mechanism.
- Reporting a percentage without the count behind it.
- Squashing the git history at the end.
