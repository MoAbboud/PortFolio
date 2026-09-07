# mailman

A document intake pipeline. Messy invoices in - PDFs, scans, spreadsheets - validated
structured records out, with a review queue for anything doubtful.

**Status: stages 0-9 of 12 complete. Runs locally, not hosted yet - hosting is the next
update.** This is a working web application, not a notebook and not a model file: upload a PDF,
get structured fields, watch the rules judge them, fix one in a browser and file it. No API
key, no network call, no cost per document.

It is deployment-ready rather than deployed - one 301MB container, one database, a health check
and a shared secret that closes every write. What is left is choosing where to put it. See
[Hosting](#hosting) for exactly what is built and what remains.

```
python -m mailman.eval run --corpus ./corpus --label baseline

    accuracy   98.3%   (529 of 538 fields, 34 documents)
    baseline   75.1%   recorded before any improvement
```

---

## The problem

Systems that exchange structured data work when both ends already agreed on a format. The
agreement is the expensive part, and most senders never make it. A supplier emails a PDF, a
partner sends a scan, a customer attaches a spreadsheet with the columns in the wrong order.
All of it lands on a person, who retypes it.

I spent three years building an EDI system that cut manual processing by eighty percent and
only ever worked when the sender already spoke the format. mailman is the layer in front of
that agreement.

## The pipeline

```
upload -> store bytes -> pull text -> extract -> validate -> route -> queue or auto-approve
                                                                  -> approved record
```

Every stage writes a row. `extractions` is append-only, so an answer can be re-run and
compared against what it said before; `validation_results` records passes as well as failures,
because a rule that used to pass and now fails is only visible if the pass was recorded; and a
reviewer's correction writes a `corrections` row plus a **new** extraction rather than editing
the old one - overwriting the model's answer would destroy both the measurement and the
labelled example the correction just created.

## The interface

There is one, and it is the point. A pipeline that files a document without a person is only
half the problem - the other half is the document it should not file, and that needs somewhere
for a person to look at it.

Three surfaces, one process, no build step. Server-rendered templates rather than a front-end
project, because the whole thing has to deploy as a single container.

**`/` - the review queue.** What is waiting, oldest first, and *why* each document is waiting:
the rule that failed and what it said, or the confidence score that fell short. Underneath, a
count of every document by status. When nothing is waiting it says so and explains how to make
something wait, because on a clean corpus an empty queue is the correct behaviour and looks
exactly like a broken page.

**`/review/{id}` - the document beside its fields.** The extracted text on one side, the fields
on the other as editable inputs, with failed rules highlighted on the fields they implicate.
Line items in a table. Three buttons - save and re-check, save and approve, reject with a
reason - so a correction and the decision it leads to happen in one pass rather than two. The
document's full status history is at the bottom, which is how "why is this here?" gets answered
a week later.

**`/docs` and `/metrics`.** The OpenAPI page is free and is a demo surface in its own right.
`/metrics` reports counts by status, the auto-approval rate, and the accuracy figure from the
newest recorded run.

Deliberately unstyled beyond what makes a table readable. The plan gated a styling pass behind
the stage 8 baseline; the baseline exists, so it is allowed now and has not been spent yet.

**On "is this just a model?"** - the trained model is the smallest part of this and the most
replaceable. It scores 74/92 on its own, loses to eleven lines of regular expressions, and on
the corpus contributes nothing measurable over them. What is actually here is a pipeline, ten
validation rules, a state machine where one function moves every document, an append-only
record of every answer the system has ever given, a review interface, and a harness that
measures the whole thing. The model is one of four interchangeable implementations behind a
single protocol.

## The numbers

Measured by `mailman/eval.py` over 37 documents, run history in [`evaluations/`](evaluations/).

| | baseline | after stage 9 |
| --- | --- | --- |
| Fields correct | 75.1% (329/438) | **98.3% (529/538)** |
| Documents with every field right | 21 / 34 | 31 / 34 |
| Wrongly refused | 12 | 1 |
| Line item recall | 56.2% | 95.3% |
| Unsupported, reported separately | 2 | 2 |

**All 23.2 points came from vocabulary breadth**, not from cleverness. The extractor knew
`invoice`, `inv` and `credit note`, and twelve documents said `Our reference` or `Document ID`.

### The number I nearly reported was 99.7%

The first version of the harness skipped documents it refused, so the corpus reported 99.7%
while producing nothing at all for a third of it. **A system that refuses everything it finds
hard would have scored 100%.** A refusal now counts every field on that document as wrong.

### Two documents it cannot handle, counted in every run

An image-only PDF with no text layer, and a CSV. They are reported separately and never as
wrong, because the difference between "98.3%" and "98.3% on the 94% of documents we accept" is
the whole honesty of the figure. An unsupported count in every run is a roadmap; a document
quietly kept out of the corpus is a forgotten TODO.

## Rules, not a model, do the arithmetic

Ten validation rules, each a small function with a severity, written from a list of things
that actually went wrong rather than from imagination. Errors route to a person; warnings do
not.

Arithmetic is checked in Python on `Decimal`, never by asking a model whether its own answer
adds up - a model asked that agrees with itself. The rule that earns its place most often is
**line items sum to the subtotal**: it needs no answer key, so it works on documents nobody has
labelled, and it has caught three bugs no field comparison did - including one I introduced
myself while widening a vocabulary, which silently moved a subtotal into the tax field.

Two rules from the original design were **removed after contact with real documents**:

- *"Total matches the total printed on the document"* is unimplementable as stated. It guards
  against a model computing a total instead of reading one, but the total **is** what was read;
  there is no second signal to compare against.
- *"Invoice number matches the expected format"* as an error fails on two of eleven perfectly
  good documents. The corpus carries `INV-2026-0042`, `NS-88213` and `MPW-3310`. It is a weak
  warning until vendors can carry a per-vendor format.

## The model, and why it barely ships

A DistilBERT token classifier, trained on Colab's free tier, is one of four interchangeable
implementations of one `Extractor` protocol. The deployed default is `hybrid`: rules, with
`buyer_name` taken from the model when weights are present, and identical to the rules alone
when they are not.

On the eleven-document corpus, before stage 9:

| | heuristic | hybrid | trained |
| --- | --- | --- | --- |
| Documents clean | 1/11 | **11/11** | 1/11 |
| Fields correct | 82/92 | **92/92** | 74/92 |
| Arithmetic breaks | 0 | 0 | 4 |
| Latency, 11 documents | 6 ms | 931 ms | 835 ms |

**The trained model loses to eleven lines of regular expressions**, and the reason is worth
more than the result. `CURRENCY` scored **100% on its own held-out set and 1/11 on real-shaped
documents**, because every training document ended with a dedicated currency line and no real
invoice has one. **A held-out set cannot detect a convention it also holds** - the training set
and the test set were written by the same person with the same mental model.

### What did not work, and what it cost to find out

- **Vocabulary was recorded as a dead end after three runs.** It was not. Four of the eight
  label lists had been written and never wired into the generator, so the experiment measured
  half a change. Wired in, the shifted score went 47.4% to 84.1%.
- **The ablations were cancelled.** Across-initialisation variance is 9.5 points overall and up
  to 40 on a single field, so separating three changes would have needed twelve or more runs.
  Measuring the noise before attributing anything is what said the planned experiment could not
  support its own conclusion.
- **84.1% was the best of three draws.** The honest figure for that configuration is 79.0%,
  range 74.6-84.1 over three initialisations.
- **A rule beats the model on `buyer_name`** - 33 of 34 against 30, because the model truncates
  multi-word names. But the model gets buyer labels the rule has never seen. Neither wins, and
  the hybrid gets both properties because it overlays the model only where the rule found
  nothing.

Every improvement across eight training runs came from the data. None came from the model, the
optimiser, the architecture or the training length.

## Running it

```powershell
docker compose up -d --build
alembic upgrade head

curl.exe -F "file=@corpus/01-clean.pdf" http://localhost:8000/documents
Invoke-RestMethod http://localhost:8000/documents/<id>/extraction | ConvertTo-Json -Depth 10
```

The review queue is at `/`, the API docs at `/docs`.

```powershell
python -m mailman.eval run --corpus ./corpus --label mine   # score every document
python -m mailman.corpus_check                              # compare every extractor
pytest -q                                                   # 355 passed, 6 xfailed
python -m mailman.sweeper --dry-run                         # documents abandoned mid-pipeline
```

`GET /metrics` reports counts by status, the auto-approval rate, and the accuracy figure from
the newest run in `evaluations/`. Set `MAILMAN_API_KEY` and everything that writes requires it
as an `X-API-Key` header - the queue page has an unlock form for the browser, which cannot put
a header on a form post. Reads stay open, so a public link is a read-only demo by default.

`PowerShell 5.1 has no Invoke-RestMethod -Form`, so uploads go through `curl.exe`; and
`ConvertTo-Json` defaults to `-Depth 2` and will silently flatten an extraction.

## Hosting

**Not hosted yet. It is built to be, and that is the next update.**

Being honest about the difference: everything below is done and verified, so what remains is a
decision and an afternoon, not a rewrite. There is no link in this README because there is no
link, and a portfolio that claims a deployment it does not have is worth less than one that
says which step it is on.

**What is ready**

| | |
| --- | --- |
| One container | `Dockerfile`, **301MB**. It was 1.67GB until a missing `.dockerignore` stopped `COPY . .` taking the virtualenv, torch included |
| One dependency | PostgreSQL. Nothing else - no broker, no cache, no object store, no worker fleet |
| Schema on release | Alembic migrations for all seven tables. `alembic upgrade head` is the release command, and it has to be in it: neither the Dockerfile nor compose runs it |
| A real health check | `/health` probes the database rather than proving the web server started, and reports whether writes are locked. This is what a platform's health probe should point at |
| Public-safe by default | Set `MAILMAN_API_KEY` and every write - upload, correct, approve, reject, reprocess - requires it. Reads stay open, so a public link is a read-only demo until that policy is deliberately changed |
| Nothing to pay per request | No hosted-model API key, no network call. Extraction is rules plus an optional local model, so an idle demo costs whatever the container costs and nothing more |
| Survives a restart | A document abandoned mid-pipeline by a dying process is swept to `failed` with a reason at startup, and can be reprocessed |
| Storage that can move | Document bytes go through one interface at S3-shaped paths, so object storage is a client swap rather than a schema change |

**What the deploy will actually run.** The trained weights are gitignored - 250MB, over
GitHub's file limit - so a hosted instance runs the heuristic path. On this corpus that costs
nothing measurable: the rules alone score the same 98.3%, including `buyer_name` at 33 of 34.
The model's claim is buyer labels the rules have never seen, and that was always a claim
measured off the corpus.

**What is left, and it is decisions rather than code**

- Where it goes, and what a container plus a managed Postgres costs there.
- Whether the database ships seeded. A link that opens on an empty queue demonstrates nothing,
  and the corpus is 37 documents that can seed one.
- Whether a visitor may upload at all, or only read. The mechanism supports either; the policy
  is not chosen yet.

## Limitations

- **Synthetic documents only.** Everything in the corpus was generated or hand-written by me,
  which is the same blind spot that produced the currency bug. Real invoices as an *evaluation*
  set is the highest-value next step; fifty of them would have caught it on the first run.
- **No OCR.** A scan with no text layer is refused, not read.
- **Invoices only.** `doc_type` is the hook for a second type; the claim that it generalises
  waits until one runs.
- **512 word-pieces** in the trained model, so a long multi-page invoice is truncated.
- **The corpus is 37 documents.** Every rate here carries its count for that reason: a
  two-document movement is noise.
- **One shared secret, and only on writes.** Reads are open by design, so a hosted link is a
  read-only demo. There are no users, no roles and no sessions beyond a cookie holding that one
  secret. It was not enforced at all until it was found four stages after the comment in the
  configuration said it would be.
- **Nothing retries by itself.** A document abandoned mid-pipeline by a dying process is failed
  by the sweeper, with the reason, and reprocessing it is a person's decision. That is the
  no-broker trade the architecture makes deliberately.
- **Not hosted yet**, though it is built to be and the container, the health check, the
  migrations and the shared secret are all in place. See [Hosting](#hosting) for what is done
  and what is still a decision. A link goes here in the next update.

## Where to read

| | |
| --- | --- |
| [`requirements/06-context.md`](requirements/06-context.md) | Every decision, what it replaced, and what turned out to be wrong. Read this first |
| [`NOTES.md`](NOTES.md) | The lab notebook - the baseline, the failed experiments, the numbers that did not move |
| [`requirements/00-plan.md`](requirements/00-plan.md) | The twelve stages and why they are in that order |
| [`evaluations/`](evaluations/) | Every scored run, append-only |
