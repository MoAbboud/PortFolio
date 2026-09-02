# mailman

An intelligent document intake pipeline. Messy documents in - PDF invoices, scans,
spreadsheets - validated structured records out, with a human review step for anything the
extraction is not confident about.

**Status: stages 0-2 of 12 complete.** Upload a PDF and structured fields come back - with
no API key, no network call and no cost. Nothing is validated yet; the rules arrive in
stage 4. The full plan is in [requirements/](requirements/), and
[requirements/06-context.md](requirements/06-context.md) is the file to read first.

## The problem

Systems that exchange structured data work when both ends already agreed on a format. That
agreement is the expensive part, and most senders never make it. A supplier emails a PDF. A
partner sends a scan. A customer attaches a spreadsheet with the columns in the wrong order.
All of it lands on a person, who retypes it.

mailman is the layer in front of the format agreement: it takes documents that were never
going to conform and produces records that do.

## Pipeline

```
upload -> store bytes -> pull text -> extract (LLM, structured output) -> validate (business
rules, in Python) -> route -> auto-approved, or a review queue -> approved record in Postgres
```

Anything that fails a rule or comes back doubtful is flagged for a person. Every correction
a person makes is logged - as an audit trail, and as a free labelled example for the
evaluation harness.

## Accuracy

Not measured yet. Stage 8 builds the corpus and records the baseline; stage 9 is the
measured iteration. The numbers, including the changes that did not help, go here.

## Running it

Windows, PowerShell, Docker Desktop. Nothing else to install.

```powershell
Copy-Item .env.example .env      # optional at this stage; nothing secret is needed yet
docker compose up -d --build
docker compose exec api alembic upgrade head
Invoke-RestMethod http://localhost:8000/health
```

Then upload something. `Invoke-RestMethod` in PowerShell 5.1 cannot do a multipart upload,
so this goes through `curl.exe`:

```powershell
curl.exe -F "file=@corpus\some-invoice.pdf" http://localhost:8000/documents
Invoke-RestMethod http://localhost:8000/documents/<the id that came back> | ConvertTo-Json -Depth 10
Invoke-RestMethod http://localhost:8000/documents/<id>/extraction | ConvertTo-Json -Depth 10
```

**No API key is needed.** The default extractor is regular expressions and layout rules -
no keys, no weights, no GPU, no network, about 17ms per document.

## Extractors

Three implementations of one protocol, chosen with `MAILMAN_EXTRACTOR`:

| Value | Needs | Role |
| --- | --- | --- |
| `heuristic` (default) | nothing | Regular expressions and layout rules. What deploys, and the baseline the others must beat |
| `trained` | local weights (~250 MB) | A token classifier trained on Colab's free GPU. Free to run; too large for git and for a free hosting tier |
| `anthropic` | an API key, and money | Kept as a comparison point for the evaluation harness. Not required by anything |

Because extractions are append-only, the same document can be run through all three and the
answers compared directly. That comparison is what stage 8 measures across the whole corpus.

Training data: the notebook trains on invoices from its own generator. It also contains a
loader for external datasets which reports its per-field alignment rate and drops documents
whose required fields cannot be matched, rather than training on a missing label.

The Kaggle set that loader was written against turned out to ship images with **no
annotations** - the labels described on its HuggingFace mirror live only in that mirror's
FiftyOne copy, which is the same copy whose Parquet conversion dropped them. Finding real
labelled invoices with a licence that permits a public demo is an open problem, and the
current accuracy figures carry that caveat.

To train and use the local model: run [notebooks/train_extractor.ipynb](notebooks/train_extractor.ipynb)
on Colab (free T4, a few minutes). It verifies the export by reloading it on CPU before
zipping, downloads it automatically, and prints both the commands to run and a per-field
results table to record. The weights ship with a `mailman_model.json` manifest - label set,
training set size, per-field scores - and the extractor refuses to load weights whose label
set disagrees with the code.

```powershell
Expand-Archive mailman-extractor.zip -DestinationPath .\models\extractor -Force
$env:MAILMAN_EXTRACTOR = "trained"
docker compose up -d --build
```

Expect:

```
status version database
------ ------- --------
ok     0.1.0   ok
```

<http://localhost:8000/> redirects to the interactive API docs at
<http://localhost:8000/docs>, which is what the mapped port in Docker Desktop opens. From
stage 7 the root becomes the review queue instead.

To stop, and to wipe the database and start clean:

```powershell
docker compose down              # stop
docker compose down -v           # stop and delete the database volume
```

## Checking it from PowerShell

Two things about Windows PowerShell 5.1 that will otherwise cost an evening:

- `Invoke-RestMethod` has **no `-Form` parameter**, so it cannot do a multipart file upload.
  Use `curl.exe`, which ships with Windows 10 and 11.
- `ConvertTo-Json` defaults to `-Depth 2` and will silently flatten a nested extraction to
  `System.Object[]`. Always pass `-Depth 10`.

```powershell
# what the containers are doing
docker compose ps
docker compose logs -f api

# the schema, straight from the database
docker compose exec db psql -U mailman -d mailman -c "\dt"

# counts by status, once documents exist
docker compose exec db psql -U mailman -d mailman -c "select status, count(*) from documents group by 1;"

# tests
docker compose exec api pytest -q
```

## Tests

```powershell
docker compose exec api pytest -q
```

The stage 0 tests do not need a running database - `create_engine` does not connect, so the
models and the app can be imported and inspected offline. That is the same property that
keeps most of the pipeline testable without a provider key later.

## Design decisions

The reasoning lives in [requirements/](requirements/), with the rejected alternatives kept
alongside the decisions. The ones that shape everything else:

| Decision | Why |
| --- | --- |
| Extractions are append-only | Re-running a document under a new prompt has to be free of consequence, or nobody re-runs one. It is also what makes the harness possible |
| The model's claim and the accepted record are separate tables | A reviewer's correction must never overwrite the answer being measured, or destroy the labelled example it just created |
| Arithmetic is checked in Python, not by the model | A model asked whether its own answer adds up agrees with itself |
| Confidence is composite, and the model's self-report counts least | Confidently wrong is the failure this system exists to survive |
| Money is `numeric` in Postgres and `Decimal` in Python | Never float, at any layer. Amounts cross JSON as strings, because that is where a float gets in |
| The queue is a status filter, not a table | A queue table would be a second place for the same fact to live, and the two could disagree |
| `failed` and `rejected` are different statuses | One is the system's fault, one is a person's decision. Collapsing them hides operational problems inside business outcomes |

## Known limitations

Honest, and updated as they change.

- Only PDFs with a text layer. Scans without one, and spreadsheets, are **not supported yet**
  and are rejected with a reason rather than half-processed into a thin extraction that
  looks real.
- Invoices only. `doc_type` is the hook for a second document type; the claim that this
  generalises waits until one actually runs.
- No accuracy figures yet. See above.
- One reviewer, one shared secret. No user accounts, roles or permissions.
- Vendor matching is normalisation plus an alias list. Nothing fuzzier.

## Documents

Synthetic and public sample documents only. No document from an employer or a client goes
into this repository, into the corpus, or through the pipeline.

## Layout

```
mailman/          the package: config, db, models, status, api
migrations/       alembic; 0001 creates the seven tables
tests/            pytest
requirements/     the specification - read 06-context.md first
NOTES.md          hand-written working notes
```
