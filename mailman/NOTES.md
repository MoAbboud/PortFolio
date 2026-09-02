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

## The notebook hands over more than weights

Extended the export so a training run produces something self-describing rather than a bare
directory of tensors. It writes `mailman_model.json` beside the weights: label set, base
model, training set size, whether any real documents were in it, epochs, overall F1, the
full per-field table, and the caveats. `mailman/trained.py` reads it on load.

**Worth being able to explain: why the label set is checked at load.** If the notebook is
rerun with a changed label set and the new weights are dropped in place, an extractor that
quietly tags the wrong fields is the result - and nothing downstream would notice, because
every field would still be populated with something. `TrainedExtractor` refuses to load
weights whose `field_labels` disagree with the code. It is the failure that would have been
hardest to spot and was cheapest to prevent.

**The export verifies itself before zipping.** It reloads the saved directory from disk, on
CPU, the way the container will, and confirms it still tags a document. A 250 MB download
that turns out to be missing a tokenizer file is 250 MB of wasted time and a confusing error
on the other machine. The check costs seconds.

**Metrics travel with the model.** They used to live only in a notebook output, which is a
thing that gets closed. Numbers that cannot be cited later are not evidence, and the weights
are what actually moves between machines.

The last cell prints two blocks to copy: the PowerShell commands, and a formatted per-field
table for this file. The reminder in it is the important part - the F1 on its own only says
the model learned the generator. The number worth reporting is the **gap** between the
trained model and the heuristic on the same corpus.

## Real training data: the Kaggle invoice set

The notebook now has a section 1b that pulls
`osamahosamabdellatif/high-quality-invoice-images-for-ocr` from Kaggle (ODbL, 1,489
annotated synthetic invoices with OCR text), converts it to BIO tags, and mixes it with the
generated invoices. `USE_KAGGLE = False` turns the whole thing off.

**Worth being able to explain: why not the HuggingFace mirror.** The same dataset is
mirrored there, and it looked like the easier route - no Kaggle token. Checking the schema
first showed the mirror has exactly one column: `image`. It was published in FiftyOne
format, and the hub's automatic conversion to Parquet kept the pictures and silently dropped
the annotations. A mirror is not the dataset. That check cost one request; finding it after
writing the loader would have cost an evening.

**Worth being able to explain: why the converter reports an alignment rate.** For generated
invoices the labels are attached as the text is written, so they are right by construction.
For someone else's data there is no choice but to match values back into the text - exactly
the labelling method the generator exists to avoid. A value that cannot be found leaves its
tokens tagged `O`, which teaches the model the field is *absent*. So the converter reports
its own hit rate per field. Near-zero on one field means the mapping names a key that does
not exist; near-zero everywhere means the OCR text is not being read. Documents whose
required fields did not align are dropped rather than trained on, because a wrong label is
worse than one fewer example.

**A bug found by running it, not by reading it.** Wrote a harness that executes the
notebook's own cells against a mock annotation with deliberate traps in it. One trap: a line
reading `Freight 1 25.00 25.00`, where the unit price and the amount are the same number.
The unit price claimed the first `25.00`; the amount matched the same position, found it
already taken, and gave up. It went untagged. The model would have learned that a line
amount equal to its unit price is not an amount - on every such line in the dataset.
`find_span` now returns all occurrences and the tagger falls through to the next unclaimed
one.

That is four bugs now found by running rather than by testing - the invoice-number regex,
the currency in the description, the stranded `extracting` document, and this. The rule is
consistent enough to write down: **tests confirm what I thought of; running the thing on
realistic input finds what I did not.**

## Colab: torch upgrade broke torchvision

First real run of the notebook died at the training cell with
`RuntimeError: operator torchvision::nms does not exist`, surfacing as
`Could not import module 'Trainer'`.

My install cell had `torch --upgrade` in it. Colab ships torch, torchvision and torchaudio
built against each other; upgrading torch alone strands torchvision on a version that no
longer exists, and its operators fail to register. transformers imports torchvision lazily,
so nothing complained until something reached for `Trainer` - dozens of cells later, blaming
the wrong thing entirely.

**Worth being able to explain: the error was nowhere near its cause.** That is the second
time on this project - the HuggingFace mirror silently dropping its annotations was the
same shape of problem. The response both times was to add a check at the point of failure
rather than to remember the gotcha: the notebook now verifies torch and torchvision agree,
by actually calling `torchvision.ops.nms`, immediately after installing. Three seconds, and
the next failure of this kind announces itself where it happens.

Also removed a dependency on `TrainingArguments` accepting `eval_strategy`, which
transformers renamed from `evaluation_strategy`. It now reads `inspect.signature` and uses
whichever the installed version accepts, so the notebook survives Colab's image moving on
without a pin that goes stale.

## F1 1.000 twice, and what it actually meant

Trained, got F1 1.000 on every field. Fixed the word-piece labelling bug, retrained, got
F1 1.000 again with validation loss at 0.0005.

**It was never a metric bug. The benchmark was trivial.** Six vendors, four buyers, eight
goods descriptions, a few fixed label phrasings - and the test split drawn from the same
generator. "The token after 'Invoice Number:' is the invoice number" is learnable in one
epoch, and an in-distribution split has no way to notice that memorisation is all that
happened.

Two things had already contradicted the score before I understood why: the "perfect" model
returned `"in"` for `INV-2026-0042`, and it failed completely on an invoice written in a
layout the generator never produces.

**Worth being able to explain: why a random train/test split proved nothing here.** The
split held out rows, not *anything about the documents*. Same vendors, same wording, same
formats on both sides. The only honest test is data the generator did not produce - so the
notebook now builds a shifted set with a disjoint vocabulary and different label phrasing,
runs the real serving path over both, and reports the gap. The gap is the result; either
number alone is close to meaningless.

**A perfect score is a bug report, not an achievement.** Twice now on this project the
suspicious result was the correct one to chase: the health check that had never been seen
fail, and this. Something that cannot fail has usually not been tested.

## The first honest comparison

Retrained with the labelling fix. Manifest still says F1 1.000, still `real_examples: 0`.
The useful results came from running the thing, not from the metric.

**Two serving bugs, both invisible to every score.** The pipeline's reassembled `word` is
lossy - the model is uncased and detokenization puts spaces around punctuation, so
`INV-2026-0042` came back as `inv - 2026 - 0042`. Spans carry character offsets, so the fix
is to slice the original text: that substring is what the document actually says. And model
load was inside the latency measurement, reporting 17.7 seconds for the first document and
milliseconds after. Load is once per process; the real number is 101 ms.

**Document A**, a layout resembling the training data: both extractors get everything right,
except the trained model also finds `buyer_name`, which the heuristic deliberately does not
attempt because no reliable rule finds it. That is the first thing the model does that the
rules cannot, and it is worth noting.

**Document B**, a layout the generator never produced - different labels, European
separators, a discount line: the heuristic returns a record with several fields wrong. The
trained model **fails outright**, never tagging `total` or `currency`.

**Worth being able to explain, and this is the line for the README:** a model reporting F1
1.000 could not find the total on an invoice written in an unfamiliar layout, while eleven
lines of regular expressions degraded gracefully and still produced something. The heuristic
is wrong in ways you can see. The model is simply absent. Neither is good enough, and that
is the honest state of it.

It also says exactly what to do next, which a good measurement should: the model needs data
that did not come from this generator. Nothing about prompts or architecture matters until
that changes.

### Trained extractor - 2026-09-02

Base model      distilbert-base-uncased
Training set    3400 examples (generated only - the Kaggle set had no labels, see below)
Epochs          6

    token-level F1        1.000     <- meaningless, same generator both sides
    serving in-distribution 100.0%
    serving SHIFTED         40.7%   <- the honest number
    generalisation gap      59.3%

Per field on the shifted set:

    INVOICE_NUMBER    18.0%      LINE_QUANTITY     99.0%
    VENDOR_NAME       20.5%      LINE_AMOUNT       98.0%
    ISSUE_DATE        14.5%      LINE_UNIT_PRICE   94.0%
    CURRENCY          33.0%      BUYER_NAME        93.0%
    DUE_DATE          58.5%
    SUBTOTAL           0.0%
    TAX                0.0%
    TOTAL              0.0%
    LINE_DESCRIPTION   0.0%

**This is the first result that told me something I did not already know.** The pattern is
not random. Everything that survived is identified by *position* - the second, third and
fourth number in a table row. Everything that hit zero is keyed to a *label word*: training
printed `Subtotal`, `VAT`, `Total Due`; the shifted set printed `Goods value`, `Duty`,
`Balance now due`. The model learned a keyword lookup, not what an invoice is.

**Worth being able to explain: why 100% and 40.7% are the same model.** Nothing changed
between those two numbers except the wording on the page. That gap is the entire value of
having built a held-out set that shares no vocabulary, and it is the number that goes in the
README - not the 1.000.

**The Kaggle dataset has no annotations.** `0 json files, 8181 jpgs, 0 txt`. The "1,489
annotated samples" claim came from the Voxel51 HuggingFace card describing the FiftyOne copy
they built, not from the Kaggle artifact. So the labels exist only inside the FiftyOne copy -
which is the same copy whose Parquet conversion dropped them.

Third time on this project that a description has been wrong about an artifact: the mirror's
schema, the export's file list, and now this. And my inspector cell was complicit - it
counted `.json`, `.jpg` and `.txt`, reported "0 json files", and said nothing about the 8,181
other files. **An inspector that only looks for what it expects is not an inspector.**

**Fix being tried:** the generator's label vocabulary was tiny - four ways to say "total",
three to say "date". That is a lookup table. It is now 13 and 11, with 20 vendors, 22 goods,
5 table-header layouts and 6 date formats. If label diversity was the problem, the gap
should narrow sharply. If it does not, the problem is deeper than vocabulary and real
documents are the only answer.
