# mailman

A document intake pipeline. Messy invoices in - PDFs, scans, spreadsheets - validated
structured records out, with a review queue for anything doubtful.

**Status: stages 0-9 of 12 complete.** Upload a PDF, get structured fields, watch the rules
judge them, fix one in a browser and file it. No API key, no network call, no cost.
Hosting is the remaining step.

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
pytest -q                                                   # 303 passed, 6 xfailed
```

`PowerShell 5.1 has no Invoke-RestMethod -Form`, so uploads go through `curl.exe`; and
`ConvertTo-Json` defaults to `-Depth 2` and will silently flatten an extraction.

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
- **Not hosted yet.**

## Where to read

| | |
| --- | --- |
| [`requirements/06-context.md`](requirements/06-context.md) | Every decision, what it replaced, and what turned out to be wrong. Read this first |
| [`NOTES.md`](NOTES.md) | The lab notebook - the baseline, the failed experiments, the numbers that did not move |
| [`requirements/00-plan.md`](requirements/00-plan.md) | The twelve stages and why they are in that order |
| [`evaluations/`](evaluations/) | Every scored run, append-only |
