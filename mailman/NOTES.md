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

## Session close - 2026-09-02

Colab GPU quota ran out. Not blocking: the notebook now detects the runtime and sizes itself,
and dropping to 2 epochs is removing waste rather than accepting less - the previous run hit
F1 1.000 at epoch 1 and the other five epochs changed nothing.

Checked whether shortening `max_length` would help a CPU run. It would not: median document
is 132 word-pieces, longest 197, nothing near the 512 cap, and the collator pads per batch
rather than to the cap. Left at 512 with the reasoning written down, because it looks like an
obvious optimisation and isn't one.

One more bug of the same family as the rest: cell 1 called `nvidia-smi` and used
`or "No GPU..."` as the fallback. On a CPU runtime the binary does not exist, so
`subprocess.run` raises instead of returning empty output and the fallback never runs. The
first cell of the notebook crashed. Guarded with `shutil.which`.

**Standing back:** the model work has run well ahead of the plan. Stage 3 - ten documents
through the pipeline and a written list of what broke - still has not happened, and it is
what produces the validation rules. Worth doing next. It needs no GPU and no dataset.

### Trained extractor - 2026-09-02, run 2 (CPU, enlarged vocabulary)

    in-distribution 100.0%   shifted 46.4%   gap 53.6%
    run 1:                   shifted 40.7%   gap 59.3%

**+5.7 points, and I cannot claim the vocabulary caused it.** Run 1 was 6 epochs on the
small vocabulary; run 2 was 2 epochs on the large one. Two variables, one measurement. My own
plan says "one change at a time" under stage 9 and I did not follow it - the CPU fallback made
the epoch reduction feel like an environmental detail rather than an experimental variable.
That is exactly how a confound gets in.

Biggest single number: **LINE_AMOUNT fell from 98% to 32%**, which is more likely 2 epochs
than vocabulary. CURRENCY went 33% to 100% and TOTAL 0% to 44%, which look genuinely like
label variety paying off.

**Worth being able to explain, and this is the finding worth having:** the model has learned
label words as *delimiters*, not fields as *things*. Looking at what it actually returns on
an unfamiliar layout:

    ISSUE_DATE   wanted '01/02/2026'   got '117/2026/1701/02/202602/05/2026'
    TAX          wanted 'gbp3,410.29'  got 'gbpgbp3,410.29gbp20,461.75'
    SUBTOTAL, TOTAL                    got nothing

The invoice number, issue date and due date merge into one span. Subtotal, tax and total
merge into one span. Nothing is missing - it is all swallowed by a neighbour. On familiar
text the known label words tell the model where each field stops; on unfamiliar text it
cannot find a boundary, fails to emit `B-` at the next field's start, and the aggregation
step - which correctly splits only on `B-` - runs them together.

That also explains why LINE_QUANTITY and LINE_UNIT_PRICE survive at 95%+: a number among
other numbers in a table row has a positional identity that does not depend on any label.

**So more vocabulary will not fix this.** The next thing to try is structural variety -
varying field order, the filler between fields, and whether a field appears at all - so that
neither position nor neighbouring words are a reliable cue. But first: rerun at 6 epochs
changing nothing else, because I owe that comparison a controlled version.

### Run 3 - 6 epochs, enlarged vocabulary (GPU)

    shifted 47.4%   gap 52.6%

Three runs now, and the variables finally separate:

    run 1   6 epochs, small vocab    40.7%
    run 2   2 epochs, large vocab    46.4%
    run 3   6 epochs, large vocab    47.4%

    vocabulary  (1 vs 3, epochs held)   +6.7 points
    epochs      (2 vs 3, vocab held)    +1.0 point

**Two things tried, both measured, both marginal.** Tripling the label vocabulary bought
under seven points. Tripling the training time bought one. The gap is still 52.6.

**Checked the noise before reading the per-field table**, which I should have done earlier:
same model over two disjoint 100-document samples gives a largest per-field spread of 6
points and an overall spread of 0.5. So the per-field movements between runs are real.

Which makes this worth stating - run 2 against run 3, identical except for epoch count:

    VENDOR_NAME     27% -> 100%    (+73)
    LINE_AMOUNT     32% ->  72%    (+40)
    TOTAL           44% ->   6%    (-38)
    BUYER_NAME      86% ->  67%    (-19)
    OVERALL       46.4% -> 47.4%   (+1)

**Training longer redistributed which fields it gets right without making it better.**
Individual fields swung seventy points in both directions; the total moved one. That is a
model shuffling capacity around a task it has not learned.

**Worth being able to explain: what stayed constant.** In-distribution 100% in all three
runs. The gap never below 52. SUBTOTAL 0% every time. And the merging failure always there -
invoice number, issue date and due date collapsing into one span; subtotal, tax and total
into another. The levers I pulled were all around the edges of that.

Next lever is structural: vary field order, the filler between fields, and whether a field
appears at all, so position and neighbouring words stop being reliable cues. If that does not
move it either, the answer is real documents and the answer was always real documents.

## Stage 3 - ten documents, and the list

Finally did stage 3. Built a PDF writer and ten hand-written invoices, each testing one thing
known to be hard, each with its labels written beside it. **5 of 10 clean.**

**The find that justifies the whole stage:** the money pattern cannot read a bare number over
999.

    'GBP 270.00'    -> ['270.00']
    'GBP 1404.00'   -> []
    'GBP 29520.00'  -> []

`\d{1,3}(?:[,.]\d{3})*` needs a separator before any further digits, so an amount of a
thousand or more written without a comma is **invisible to the extractor**. That is most of
the invoices this thing exists for.

**87 tests did not catch it.** Every fixture I had written used an amount under a thousand or
one with a comma in it. The corpus caught it on the second document. That is the argument for
stage 3 in one line, and I had been putting it off for three sessions.

Second bug: a slash date reads as two amounts (`03/09/2026` -> `['03','09']`), and two amounts
on a line is the rule for "priced row", so a date becomes a phantom line item.

**Worth being able to explain: why both bugs are the dangerous kind.** Neither crashes.
A missing total and an invented line item both produce a record that *looks* fine. That is
exactly what the validation rules are for, and now I have four written from evidence rather
than imagination - line items summing to subtotal, subtotal plus tax equalling total, required
fields present, and a line whose description contains a date being suspect.

**On process.** I spent three sessions on the model because that is where the interesting
numbers were, while the thing blocking the demo went unstarted. The model work produced two
measured dead ends, which is genuinely useful. Stage 3 took an afternoon and found a bug that
would have made every accuracy figure meaningless. Ordering matters and I got it wrong.

## The fix that made it worse

Fixed the money pattern so bare amounts over 999 are visible. Re-ran the corpus. Still 5/10,
but different failures - **every document now had exactly one extra line item.**

Allowing plain digit runs made the parts of an identifier visible. `INV-2026-0042` offers up
`2026` and `0042`; two amounts on a line is my rule for "priced row"; so the invoice-number
line became a line item. The old broken pattern had been hiding it, because `2026` did not
match either.

Third fix: a hyphen in the lookbehind, because a digit group preceded by a hyphen belongs to
something bigger. 5/10 -> 8/10.

**Worth being able to explain: why this is the argument for the corpus.** A fix that trades
one silent wrong answer for another is the most expensive kind of change, and it is exactly
what unit tests written by the person making the fix will not catch - I would have written a
test for `1404.00` and moved on. The corpus caught it in one run because its labels were
written before any of this existed, and it checks every field of every document rather than
the thing I was thinking about.

Both remaining failures are deliberate. `buyer_name` is null because no rule finds a buyer
reliably - and the trained model does find it, which is the clearest case so far for the model
earning its 250MB. The credit note is a scope question I should answer rather than patch
around: either credit notes are invoices for our purposes or they are not.

## The bug the corpus should have caught and did not

Reviewed the stage 3 work by re-running it. 8/10 reproduces. But `08-two-page` was counted
clean while seven of its forty line items carried the wrong amount, and the reason is worth
more than the bug.

The date mask - fix 2 above - matched `\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}`: a number, **any
word**, a four-digit number. And `\b` let a match start inside a number, because there is a
word boundary between the `.` and the `00` of `30.00`. So this line

    Reel stock lot 34   34   GBP 30.00   GBP 1020.00

contains `00   GBP 1020`, which that pattern calls a date. The mask deleted it and the line
amount vanished:

    wanted   ['34', '34', '30.00', '1020.00']
    got      ['34', '34', '30']

**The corpus said the document was clean because the check counted line items instead of
adding them up.** Forty items found, forty expected, right total, tick. I wrote a page above
about the corpus catching what my own unit tests would not - and then checked it in the one
way that could not see this. A corpus compared field by field catches it in a run. A corpus
compared by counting agrees with me.

Summing every document's line items against its own subtotal found this in seconds, and found
the next one in the same pass.

**`02-many-lines` had ground truth that contradicted itself.** Twelve generated lines summing
to 1352.00, under a hand-typed `Subtotal 1170.00`. The labels matched the printed text so
extraction passed, but the document was wrong about itself - and *line items sum to the
subtotal*, the first rule on my stage 4 list, would have failed against my own corpus. The
totals are now computed from the lines. "Ground truth by construction" only holds if it is
actually constructed.

Fixed both. Month names are required in a date now, and the pattern cannot start mid-number.
**9/10 clean**, and every extracted document is arithmetically self-consistent for the first
time: lines to subtotal, subtotal plus tax to total, quantity times unit price to amount.

**Credit notes are in scope.** Decided rather than deferred. A credit note is an invoice with
the signs reversed, it arrives in the same post, and refusing one is refusing a real document.
The label list grew by two words and nothing downstream needed touching, because -100.00 plus
-20.00 is still -120.00. `04-credit-note` now extracts.

**And a count I had wrong:** 91 was tests collected, not tests passing - 73 passed, 18 skipped
for want of a database. Now 77 and 18. A skipped test is not a passing test, and this project
does not get to be sloppy about that particular thing.

**Still not reproducible.** Both 8/10 and 9/10 came from a throwaway script. Nothing in the
repository reads the corpus back. That is stage 8's job, and after this it is clearly also
where the arithmetic self-check belongs.

## The corpus reader, and a fifth silent bug

Two sessions ago I wrote that the corpus run was still not reproducible from the repository.
It is now. `tests/test_corpus.py` runs all eleven documents: every key in `expected` compared,
per line and per field; each document checked against its own arithmetic; and the PDFs and
label files on disk compared against what `corpus.py` produces, because a stale corpus
directory is invisible to everything else.

**The part I would not have thought of before this week: it fails on a label it cannot
evaluate.** `has_negative_line`, `issue_date_is_ambiguous` and `spans_pages` had been sitting
in the labels naming nothing on `InvoiceFields`. Every comparison written against extracted
fields skipped them without comment - including the only assertion that `06-ambiguous-date`
flags `03/04/2026` rather than quietly picking a reading, which is the entire reason that
document is in the corpus. All three now name something real and all three pass. They were
never wrong. They were unchecked, and nothing anywhere said so.

Worth being able to explain: why an unknown key is a failure rather than a warning. A checker
written by the same person who wrote the labels will skip what it does not recognise, because
that is the forgiving thing to do and the labels look fine. That is exactly how three of them
survived three sessions. `_CHECKS` is a closed set - a new label has to say how it is measured
or the suite goes red by name.

**Fifth silent bug: every label test was a substring search.** `word in line.lower`, over the
whole line. So:

    Total station hire     3   GBP 90.00   GBP 270.00     dropped
    Overdue account fee    1   GBP 40.00    GBP 40.00     dropped   ("due" inside "Overdue")
    Tax advisory services  2  GBP 100.00   GBP 200.00     dropped, and became the tax
    Site survey            1  GBP 320.00   GBP 320.00     kept

One line item of four, and a tax of 200.00 instead of 166.00 - which is a perfectly plausible
tax on a subtotal of 830.00. Same family as the four before it: nothing raised, record looks
complete. A total station is a surveying instrument that gets hired by the day; "Overdue
account fee" and "Tax advisory services" are ordinary invoice lines. None of this is contrived.

I wrote the document as case 11 and ran it **before** touching the code, so the failure is on
the record. A reader that passes on everything the day it is written has proved nothing.

Word boundaries fix "Overdue". They do nothing for "Total station hire", which contains the
whole word. The second half of the fix keys on shape instead: a totals row carries a label and
one amount, or two when the rate is printed beside it ("VAT 20%  GBP 166.00"); a priced row
carries three - quantity, unit price, amount. So the totals words only disqualify a line with
fewer than three amounts, and `_labelled_amount` and `_total` skip three-amount lines outright.

Worth being able to explain: why not just drop "due" from the totals words. Because "Balance
Due" and "Amount Due" are ordinary totals labels, and I would have traded a dropped line item
for a missed total. Every bad fix in this project has had that shape - fix 1 bought fix 3, and
the date mask hid for a session.

What is still wrong, and I am writing it down rather than leaving it: **a two-amount line item
whose description contains a totals word is still dropped.** A priced row with no quantity
column, "Tax advisory services  GBP 200.00  GBP 200.00", still reads as a totals row. Narrower
than what I fixed. The arithmetic rule catches it.

    pytest                 77 passed / 18 skipped  ->  114 passed / 18 skipped
    corpus                 10 of 11 clean; 01-clean's buyer_name is the known gap
    arithmetic             0 inconsistencies on 11 of 11
    disk vs generator      identical, all eleven

The 18 skipped are the DB-backed tests and still need Docker up. Still not passing tests.

Five bugs out of stage 3 now, every one of them silent, and the rule that catches today's is
*line items sum to the subtotal* - first on the stage 4 list, and the one that would have
caught it a session earlier if it had existed. Stage 4 next.

## The vocabulary change I thought I made two runs ago

I did not make it. Four of the eight label lists I wrote in response to the first shifted
result were never read by the generator. `SUBTOTAL_LABELS`, `TAX_LABELS`, `TABLE_HEADERS` and
`CURRENCY_LABELS` sat in the cell above `generate_invoice` while every one of the 4000
training documents said `Subtotal`, `Currency` and `Description Qty Unit Price Amount`, and
the tax label came from a hardcoded `["VAT", "Tax", "Sales Tax"]`.

The per-field numbers had been telling me this for two runs and I read them as a result
instead of a symptom:

    SUBTOTAL   0%   in all three runs      list never wired in
    TAX        0%   in two of three        hardcoded to three phrasings
    TOTAL      0% -> 44%                   the one totals-block list that WAS wired in

And the sharpest version of it: `CURRENCY` hit 100% on the shifted set even though its label
word is hardcoded, because the shifted generator draws its currency *values* from the same
`CURRENCIES` list training uses. The one field that shares a value vocabulary scores 100%.
The ones that share nothing score 0%. That is a lexical lookup, described as plainly as my own
data can describe it.

So "vocabulary is a measured dead end, +6.7 points" is true only of the fields that got the
treatment. It is not a finding about SUBTOTAL or TAX, and I should not let it into the README
as one until the run below happens. A dead end I never actually walked down is worse in a
README than no dead end at all.

Also: training drew `date_style` from `randrange(4)` and the shifted set from `randrange(6)`.
Two of the six date formats appeared in a third of my test documents and in none of my
training documents. `ISSUE_DATE` at ~14% was partly guaranteed rather than learned.

**Fixed.** Five call sites and a `DATE_STYLES = 6` constant shared by both generators.

**The guard took three attempts and that is the part worth remembering.**

    1. "does any phrase from this list appear in the text?"    PASSED on the bug
       The constants were "Subtotal" and "Currency" - members of their own lists.

    2. "do at least two distinct phrases appear?"              PASSED on the bug
       The hardcoded tax list was three members of TAX_LABELS. And "Net" appears
       inside the table header "Details Qty Rate Net".

    3. record the draw at the call site                        CAUGHT all four

Worth being able to explain: why the third works and the first two do not. A check that reads
the output can be satisfied by a coincidence in the output. `pick(rng, name)` records that the
generator asked for the list, which is the thing I actually care about and the thing the bug
cannot fake.

That is now the third time this project has taught me the same thing in a different costume -
a corpus checked by counting agrees with me, a label nothing evaluates reads as a pass, and a
vocabulary guard that greps the output passes on a constant. A check written from the same
understanding as the code inherits the code's blind spot. The fix each time has been to move
the check onto something the bug cannot fake.

Verified locally, no GPU needed - the generator cells only want `random` and `datetime`. Every
list now 100% drawn (was 1/10, 3/9, 1/5, 1/5), all six date formats reachable, the shifted-set
disjointness assertion still passes, all 44 code cells compile.

**The next run is a real test, not a hope.** Same seed, same 6 epochs, only the emitted
vocabulary differing. Compare against run 3: shifted 47.4%, gap 52.6%. If SUBTOTAL and TAX
move, the dead-end conclusion needs narrowing. If they stay at zero now that the labels
genuinely vary, that conclusion gets much stronger - it becomes evidence the problem is
structural, which is what the merging diagnosis predicts. Either way I learn something, which
is more than the last two runs can say.

Still untouched, and still the bigger lever: field order in the generator is identical in
every document. That is what the merging failure is made of, and no amount of vocabulary
fixes it.

## Run 4: I have to withdraw the dead end

    in-distribution 100.0%   shifted 70.7%   gap 29.3%
    run 3                    shifted 47.4%   gap 52.6%

    Run  Epochs  Vocabulary              Shifted  Gap
    1    6       small                    40.7%   59.3%
    2    2       enlarged, half-applied   46.4%   53.6%
    3    6       enlarged, half-applied   47.4%   52.6%
    4    6       enlarged, FULLY applied  70.7%   29.3%

Run 3 to run 4 is controlled - same seed, same 4000 documents, same 6 epochs, GPU both times.
**+23.3 points, and the gap halved.** End to end at constant epochs, run 1 to run 4 is 40.7%
to 70.7%: thirty points from generator variety alone.

**So "vocabulary is a measured dead end, +6.7 points" comes out of my notes.** I wrote that
after run 3 and filed it as one of the two dead ends stage 9 is supposed to produce. It was
wrong. Four of my eight label lists were never wired into the generator, and they governed
precisely the fields that had not moved - so the 6.7 points was the effect of tripling half a
vocabulary, measured on the half that was live.

    SUBTOTAL   0.0% -> 73.0%    +73.0    never wired in before this run
    TAX        0.0% -> 71.5%    +71.5    never wired in before this run
    TOTAL      6.0% -> 80.5%    +74.5    already wired in - see below
    LINE_AMOUNT 72% -> 100.0%   +28.0
    CURRENCY    85% -> 100.0%   +15.0

**The mechanism is the bit I want to be able to explain.** TOTAL moved +74.5 and its own
vocabulary did not change at all. Its neighbours' did.

That confirms the merging diagnosis from run 2 and tells me *why* it was happening. I had
concluded the model learned label words as delimiters rather than fields as things. True - and
the reason it could only learn them as delimiters is that two of the three were constants.
Every document I generated said `Subtotal`, so the only available rule is the literal string.
On a document saying `Chargeable value` there is no boundary, no `B-` gets emitted at the start
of the next field, and aggregation merges subtotal, tax and total into one span. Give subtotal
and tax ten and nine phrasings and the model has to learn "label-ish phrase, then an amount",
which survives an unseen label - the boundary appears and the total stops being swallowed.

Vocabulary and structure were not competing explanations. My constant labels were manufacturing
the structural failure.

Same reading covers LINE_AMOUNT at 100%: the table header was a constant too, and now has five
variants, so the row has to be parsed rather than matched.

**Two things I am not entitled to claim.** The edit bundled the four label lists *and* the date
formats going from four reachable to six, so DUE_DATE at 92.5% is not cleanly attributable -
the totals-block moves are, since date formats cannot touch them. And run 3's TAX figure of 0%
that I compared against was inferred rather than recorded: my run 3 entry names SUBTOTAL as 0%
in every run and does not list TAX. SUBTOTAL's +73.0 is solid; TAX's +71.5 rests on that
inference.

**What is still broken is my own bug one layer down.**

    INVOICE_NUMBER   13.0%
    ISSUE_DATE       12.5%
    LINE_DESCRIPTION 34.0%

The first two being within half a point of each other is the merging signature again, and I
recorded that exact pair merging back in run 2. The cause: my generator emits **one**
invoice-number format, every single time - `INV-{year}-{4 digits}`. So INVOICE_NUMBER is
learnable as "the token starting with INV-". The shifted set uses `123/2026/45`, which shares
nothing and is date-shaped, so it merges into the issue date behind it.

The values are now the constant where the labels used to be. Same bug, one layer down. And my
own corpus already tells me the constant is wrong - INV-2026-0042, NS-88213, BW-2026-771,
MPW-3310, AP-2026-5120: at least three shapes in eleven documents, prefix varying by vendor.

**The README line this gives me is better than the one it replaces.** "Vocabulary did not help"
would have been a dead end honestly reported. "I recorded vocabulary as a dead end and it was
not - the experiment had only half run, and catching that took an assertion that the generator
draws from every list it defines" is a story about measurement discipline, which is the thing
this project is actually for.

Next: vary the invoice-number format the way the labels now vary. Print wanted-vs-got for
INVOICE_NUMBER and ISSUE_DATE on ten shifted documents first, to confirm merging rather than
assume it - that is how I found it last time and it costs one cell.

## Run 5 prepared: every remaining constant, behind a flag

Run 4 taught me that a constant in my generator becomes a lookup rule in the model, and that
the constant does not have to be the field's own text - TOTAL gained 74.5 points because its
*neighbours* stopped being constant. So I went looking for the rest. Three left:

    one invoice-number shape, INV-{year}-{4 digits}, in every document ever generated
    one field order, in every document ever generated
    twenty-two fixed strings for line descriptions, an open-vocabulary field

    distinct field orderings         1 -> 127
    distinct invoice-number shapes   1 ->  17
    distinct line descriptions      22 -> 778

All four changes sit behind independent flags in a `GENERATOR` dict rather than one switch,
because changing four things at once is how run 2 produced a number I could not attribute.
All on is the model; turning one off and rerunning is the attribution, seeded identically. All
four off reproduces run 1's generator. The dict goes into the manifest, so a set of weights can
finally say which experiment produced it.

Filler lines are in there on purpose and are labelled O - `PO Number PO-4471`, `Sort code
20-00-00`, `Order ref ORD-99120`. Identifier-shaped and money-shaped text that is NOT the
invoice number and NOT a total, so "a token that looks like a reference" stops being a usable
rule. Subtotal now absent 10% of the time, tax 15%: a field that is always present is a field
whose absence has never been seen.

**The shifted set is frozen and marked as such.** Runs 1-4 were scored against it. Two new
assertions guard the two new ways to leak, because the phrase-level check cannot see either:
all 1056 reachable description combinations against SHIFT_GOODS, and 20000 generated invoice
numbers against the shifted set's `\d{3}/\d{4}/\d{2}` shape. Last time I enlarged the
training vocabulary I took words *from* the shifted set and quietly stopped holding it out.

**The guard caught me within the hour.** I added BUYER_LABELS and STREETS to the vocabulary
and then drew them with `rng.choice` instead of `pick`, so they were never recorded as drawn -
exactly the bug the guard exists for, committed by me, after I wrote the guard. It failed the
run by name. That is the second time this week a check has been worth more than the code it
checks.

Also found a metric of mine that was lying: the description-variety print joined every
description in a document and counted those, reporting document uniqueness as vocabulary size.
It said 428 with composition off, which sounds like variety and is not. Counts spans now.

**New diagnostic cell (Colab 20): wanted vs got on the four weakest fields**, and for each
miss it checks whether the wanted string turns up *inside* another field's span and names the
field that swallowed it. That is the check I did by hand in run 2 that produced the merging
diagnosis, and run 4 proved the diagnosis right. Worth keeping rather than rebuilding.

Verified by running it - all 45 cells compile, and the generator plus shifted-set cells were
executed at 4000 documents in every flag configuration, all on, each one off, and all off. No
GPU needed for any of that.

Still not done: model selection. `save_strategy` is "no", so I ship whatever the last epoch
left, and runs 2 vs 3 swung seventy points per field between epochs. Doing it honestly needs a
dev set I can select on without spending the test set. Next methodological change, separate
from this one.
