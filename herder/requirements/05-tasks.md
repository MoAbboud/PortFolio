# herder - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

**Stages 0 to 8 are done, and the prototype exists**: everything the terminal could do, in a
browser at `http://localhost:8000`. 403 tests pass. **Stage 9 - the corpus and the baseline -
is next**, and the UI stays bare until that baseline is recorded.

**Two things are outstanding behind it, both measurement rather than code.** The full `local`
run over all ten stage 4 transcripts still has not been done; the comparison recorded so far
is one transcript, and no figure should be read as if it had been. And stage 4's 9.0x
compression figure predates the stage 5 render fix, which cut briefs by 15 to 27 per cent, so
it is understated and has not been re-measured.

Stages are ordered by dependency, not by calendar. **Each one ends in something that runs and
can be checked from PowerShell.** If a stage cannot be verified that way, it is not finished.

Three habits that run through all of them:

- **Commit as the work happens, with real messages.** The history is part of what is on
  display. It is not squashed at the end.
- **Append to `requirements/06-context.md` after every exchange, not at the end of a
  sitting.** It is the handoff log and it is what makes this project survive across separate
  working sessions. It is gitignored and stays that way.
- **The render ordering, the merge verdicts and the integrity weighting get read line by
  line.** Those three are what an interviewer will probe, and the answers have to be the
  author's own.

## Checking it from PowerShell

Windows PowerShell 5.1 is the shell. Two things about it that matter here:

- `Invoke-RestMethod` in 5.1 has **no `-Form` parameter**. Anything multipart goes through
  `curl.exe`, which ships with Windows 10 and 11.
- `ConvertTo-Json` defaults to a depth of 2 and silently flattens nested objects to
  `System.Object[]`. Always pass `-Depth 10` when looking at a brief or an entry.

```powershell
# bring it up
docker compose up -d
docker compose ps
docker compose logs -f api
docker compose logs -f worker

# migrations
docker compose exec api alembic upgrade head

# stage 0: is it alive, and does it go red
Invoke-RestMethod http://localhost:8000/health
docker compose stop db
Invoke-RestMethod http://localhost:8000/health      # expect 503, database: unreachable
docker compose start db

# stage 1: put a conversation in
$body = @{ vendor = "claude"; text = (Get-Content .\bench\datasets\01-coding.txt -Raw) } |
        ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri http://localhost:8000/v1/ingest/paste `
  -ContentType application/json -Body $body

# stage 3: what came out
$p = "<project id>"
Invoke-RestMethod "http://localhost:8000/v1/projects/$p/brief" | ConvertTo-Json -Depth 10
Invoke-RestMethod "http://localhost:8000/v1/projects/$p/entries?status=active" |
  Select-Object layer, kind, title
Invoke-RestMethod "http://localhost:8000/v1/projects/$p/stats" | ConvertTo-Json -Depth 10

# stage 5: the pack
Invoke-RestMethod "http://localhost:8000/v1/projects/$p/resume?vendor=claude&budget=3000" |
  Select-Object -ExpandProperty pack_text

# stage 6: measure it
Invoke-RestMethod -Method Post "http://localhost:8000/v1/injections/$i/checkpoint" `
  -ContentType application/json -Body '{"mode":"local"}'

# the pipeline without the API
python -m herder paste .\bench\datasets\01-coding.txt --project demo
python -m herder brief demo
python -m herder resume demo --vendor claude

# where the time went
docker compose exec db psql -U herder -d herder -c `
  "select purpose, implementation, count(*), avg(latency_ms)::int from model_calls group by 1,2;"

# the harness
python -m bench.run --method herder --budget 3000
python -m bench.run --method naive_summary --budget 3000

# tests
pytest -q
```

**There is no API key anywhere in this project.** What comes from the environment is which
models to load and where they live:

```powershell
# which extractor runs. Unknown value is an error, never a silent default.
$env:HERDER_EXTRACTOR = "heuristic"   # heuristic | local | trained

# where the weights live. Gitignored, rebuildable from the recipe in the repo.
$env:HERDER_MODEL_DIR = "./models"

# nothing here is downloaded at runtime by surprise - fetch it once, on purpose
python -m herder models pull        # embeddings + NLI, a few hundred MB
python -m herder models pull --llm  # the quantised extractor, a few GB
python -m herder models check       # what is present, what is missing, what size
```

Docker Compose mounts `./models` rather than baking weights into the image, so the image
stays small and the same container runs with or without the local model present.

There is also `http://localhost:8000/docs` - FastAPI generates it, it costs nothing, and it
is a usable demo surface on its own before the web UI exists.

## Stage 0 - Scaffold

**Done. Verified 2026-09-08 against running containers:** migration applied at
`0001_initial`, 19 tables, the `vector` extension present, and the partial unique index on
`jobs` created exactly as designed. `/health` returned 200, then 503 with the database
stopped, then 200 again - and the worker rode the outage out, warning and retrying rather
than dying.

- [x] Commits go into the existing `PortFol` repository. No `git init` - herder is a folder
      in a repository that already exists
- [x] `.gitignore` covers `HERDER_SPEC.md` and `requirements/06-context.md` **before the
      first commit**, not after. A tracked file stays tracked and the content survives in
      history, so this has to be right the first time
- [x] FastAPI project skeleton, `herder/` package layout as in [03-architecture.md](03-architecture.md)
- [x] Docker Compose bringing up API, worker and PostgreSQL together, with the API waiting on
      a database healthcheck rather than on the container merely having started
- [x] The database image carries pgvector. `create extension if not exists vector` is in the
      first migration, not in a setup script somebody has to remember
- [x] Alembic wired in, one hand-written migration creating every table in
      [04-data-model.md](04-data-model.md). Hand-written rather than autogenerated, so the
      constraints that carry the design are visible in the migration - especially the two
      unique constraints on `messages` and the partial unique index on `jobs`
- [x] UUIDv7 generated in the application, so an id exists before the insert
- [x] `GET /health` returning green, and **verified to go red**: stopping the database
      returns 503. A health check that only proves the web server started is worth very little
- [x] Settings from the environment: which extractor, where the models are. Nothing in source
- [x] `models/` gitignored from the first commit, like `mailman`'s. Weights are large and
      rebuildable; the recipe is what belongs in git
- [x] A worker process that starts, claims nothing, and logs that it is polling. The job
      runner shape exists before there is a job to run
- [x] `NOTES.md` started - created empty on purpose, with only a reminder of what belongs in
      it. Written by hand, never generated
- [x] Project `README.md` with the PowerShell run instructions
- [x] Smoke tests that run without a database, including one asserting the migration creates
      exactly the tables the data model lists

## Stage 1 - Ingest

**Done. Verified 2026-09-08 through the running API:** a transcript pasted, the same
transcript pasted again adding nothing and returning the same conversation, the log read
back in thread order, a missing key refused with 401 and an unparseable transcript with 422
and a reason. 85 tests pass, of which 22 need the database.

- [x] `users`, `workspaces` and a default `projects` row created by a bootstrap command, so
      there is something to ingest into. No registration flow yet
- [x] Transcript parser: `User:` / `Assistant:` prefixes, and at least one vendor export
      JSON shape. An unrecognised transcript is refused with a reason rather than parsed into
      one enormous turn
- [x] `POST /v1/ingest/paste` - creates a conversation, inserts messages, returns the ids
- [x] `POST /v1/ingest` - the extension's batch shape, so the door exists before the client
      does
- [x] `content_hash` computed server-side as well, and the client's value checked against it.
      A client that computes the hash differently must not be able to insert duplicates
- [x] Idempotency: re-posting the same batch inserts nothing and reports the duplicate count
- [x] `seq` assigned server-side, with the client `position` as tie-breaker, and out-of-order
      arrival handled rather than assumed away
- [x] Token counting with `tiktoken`, stored per message
- [x] `tokens_since_derive` incremented, and a `derive` job enqueued on threshold or age.
      Enqueueing twice is a no-op because of the partial unique index - **test that directly**
- [x] `GET /v1/conversations/{id}/messages` so an ingest can be checked from PowerShell
- [x] A size cap on a pasted transcript, and an empty paste is a 400 rather than a
      conversation
- [x] API key auth on every route, with the key hashed. One key created by the bootstrap
      command

## Stage 2 - Extract

**Built and tested 2026-09-08.** The `heuristic` extractor runs end to end against the
real database and produces entries with lineage back to the exact user turns. The `local`
extractor is measured: Ollama with `qwen2.5:3b`.

First measurement, heuristic, on a 300-turn synthetic transcript:

    heuristic         21,926 tokens, 4 chunks, 21 ms, 36 entries
    local, cold       125.6 s wall - of which 121 s is loading the model
    local, warm         6.2 s wall, 1.0 s prefill + 2.8 s generation
    prefill           ~1,600-2,000 tokens/s     generation  ~80-113 tokens/s
    fixed overhead    1,570 prompt tokens per call, whatever the chunk size

Full figures and the quality comparison are in `NOTES.md`. The load cost is why every
call now sends `keep_alive`, and why migration `0002` splits `model_calls.latency_ms`
into load, prompt and generation - a single total hid it completely.

**Read the variance note in `NOTES.md` before quoting any of these figures.** Prefill
throughput on the same chunk varied by nearly 6x across three runs, so the per-chunk
extrapolation is soft until stage 4 repeats it over ten conversations.

- [x] The `Extractor` protocol, and **two** implementations behind it: `heuristic` and
      `local`. `trained` is stage 10 and only has to be a name in the enum now
- [x] `HERDER_EXTRACTOR` selects between them; an unknown value is an error rather than a
      silent default
- [x] The local model loaded through `llama.cpp` bindings, imported lazily, with the model
      file absent being a clear startup error rather than a crash on first use
- [x] A JSON grammar compiled from the Pydantic schema, so valid output is a property of
      decoding rather than something to hope for and repair
- [x] `model_calls` written for **every** call, including the failures, with purpose, model,
      **which implementation**, prompt version, both token counts, latency, whether it
      validated first time, and the raw output
- [x] Prompt files with a `version` header, and the version written to the row on every call
- [x] `chunk()` in `domain/`, splitting at turn boundaries towards 6000 tokens, with unit
      tests for a single turn larger than the target
- [x] `extract.md` with three worked examples, and the rule about the model's own unadopted
      suggestions stated first
- [x] Pydantic schema for the candidate list, used to generate the decoding grammar and as the
      parse target
- [x] **Lineage validated against the chunk.** A candidate citing a message id that was not in
      the chunk is dropped and counted, never stored
- [x] A candidate with empty lineage is dropped and counted
- [x] Malformed JSON: one retry, then the chunk is skipped and **recorded as skipped**.
      Derivation continues with the other chunks. With a grammar in place this should be
      unreachable - if it fires, the grammar is wrong, and the log should make that obvious
- [x] Inference timeout and an out-of-memory kill handled as distinct cases. The derive
      cursor advances only on success, so a killed derive re-runs rather than skipping material
- [x] Missing or unloadable weights fail at startup, naming the file and the variable. **No
      silent fallback to the heuristic extractor** - quietly producing worse briefs than the
      operator believes is worse than refusing to start
- [x] Entries, revisions and lineage written for the surviving candidates. No merging yet -
      this stage creates one entry per candidate on purpose, so the merge step can be seen to
      do something in stage 3
- [x] **Record what one real chunk costs in wall-clock**, split into prompt processing and
      generation, in `NOTES.md`. This is the number the open question in
      [00-plan.md](00-plan.md) is waiting on, and it decides the chunk size and the model size
- [x] Run the same chunk through `heuristic` and through `local` and put both outputs side by
      side. The first comparison of the project, and it costs nothing to do now
- [x] Tests against a fake extractor covering every failure row in
      [03-architecture.md](03-architecture.md). The real model is never loaded in the test
      suite - a suite that needs several gigabytes of weights is a suite that stops being run

## Stage 3 - Merge and render

**Done 2026-09-10. The loop closes.** Two numbers the specification carried turned out
to be wrong when measured, and both failed silently:

- **the similarity threshold, 0.86 -> 0.50.** At 0.86 only one of eleven labelled pairs
  reached adjudication, so the merge step would never have fired and the memory would
  have grown linearly while the brief kept rendering. 0.86 was calibrated for a
  1536-dimension model; the model changed and the scale changed with it.
- **supersede now needs contradiction in BOTH directions.** Genuine reversals are
  symmetric; NLI invents one-sided contradictions between unrelated sentences, and the
  old rule would have retired good entries on that artefact.

Full figures in `NOTES.md`, including the finding that **both extractors missed a
reversal** - which is the first thing stage 4 has to look at.

- [x] A `sentence-transformers` embedder at 384 dimensions, on CPU. The model is decided
      before any embedding is written, because the pgvector dimension is fixed in the DDL
- [x] `embed` job. **This was ticked before it existed** - there was no handler and it was
      never enqueued, so entries written by the stage 2 extract service kept a NULL
      vector and were invisible to the merge step forever. Worse, a *removed* entry with
      no vector cannot be matched, so removed-never-resurrects silently did not apply to
      it. Now real: a `embed` worker handler, an enqueue from `extract_project`, and
      `derive` backfills before it merges so the loop self-heals
- [x] Similarity search over `entries` with the HNSW index, top 3 above threshold
- [x] **The removed-entry rule, in the merge step**: a candidate matching a removed entry is
      dropped. Test it directly, and test it after a re-derive of the same messages
- [x] The NLI cross-encoder, and the mapping from entailment, contradiction and neutral onto
      the four verdicts in [03-architecture.md](03-architecture.md)
- [x] A confidence floor below which no label is trusted
- [x] No label above the floor falls back to `distinct`, and is counted
- [x] Revisions on update, `superseded_by` on supersede, lineage union on both
- [x] Session tail: the last 1200 tokens of the most recent conversation, one entry of kind
      `tail`, replaced wholesale each derive
- [x] Ageing: session entries untouched for 7 days below 0.7 confidence to `archived`
- [x] `promotion_suggested` on preference and identity entries seen in 3+ conversations. **No
      automatic promotion** - test that the layer does not change
- [x] `render()` in `domain/`, pure, with the ordering and the tail reserve from
      [03-architecture.md](03-architecture.md). Unit tests for the ordering, for the budget
      boundary, and for a tail that does not fit
- [x] `brief_versions` written with included and excluded ids, source counts, and the trigger
- [x] `projects.current_brief_version_id` updated, and invariant 5 tested
- [x] `GET /v1/projects/{id}/brief` and `GET /v1/projects/{id}/entries`
- [x] `POST /v1/projects/{id}/derive` and `/render` to force each by hand
- [x] Every invariant in [04-data-model.md](04-data-model.md) has a test
- [x] CLI: `herder paste`, `herder brief`

## Stage 4 - Ten conversations end to end

**Largely done 2026-09-12.** Ten generated transcripts, 113,701 tokens, 323 planted hard
cases, all ten through the heuristic. The failure list is in `NOTES.md`.

    stop-and-fix    entry count vs source tokens, r = +0.27 - the memory does NOT grow
    compression     9.0x overall across 111,011 source tokens (range 6.7-12.2)
    verdict mix     96 created, 24 merged, 156 superseded  <- the headline problem
    planted         0 of 76 assistant proposals leaked; 0 of 69 code blocks shredded
                    13 content-free rejections became entries (fixed, 0 after)

Five bugs found by running it, all fixed: the paste/project collision, supersede losing
lineage, supersede resetting the conversation count, three content-free rejection
phrasings, and **Ollama giving a prompt only half of `num_ctx`** - which silently threw
away more than half of every chunk before the local model saw it.

- [x] Ten varied long transcripts, written by hand or generated, 8k to 60k tokens, across the
      four archetypes. Not the benchmark corpus - that comes at stage 9 with ground truth.
      These exist to break the pipeline
- [x] All ten through the running API
- [x] **A written list of everywhere it got something wrong**, in `NOTES.md`. Specifically
      looked for: entries that should have merged and did not; the model's rejected
      suggestions recorded as decisions; constraints losing to facts in the render ordering;
      a session tail eating its whole reserve and more; near-duplicate entries the similarity
      threshold missed; lineage pointing at a plausible but wrong message
- [x] **Entry count plotted against source tokens for all ten.** A linear relationship means
      the merge step is not working and the compaction claim fails. This is a stop-and-fix,
      not a note
- [x] The first real compression ratio recorded, with the count behind it
- [x] The wall-clock of deriving each conversation recorded from `model_calls`, per
      implementation
- [~] **`heuristic` against `local` on all ten**, side by side. `mailman`'s equivalent
      comparison is the most interesting thing in that project
- [x] The failure list turned into the shortlist for stage 10

## Stage 5 - Serve

**Done 2026-09-12 apart from the last task, which is the author's to do.** A pack is built, a
vendor preamble is chosen, and every serve writes an `injections` row for stage 6 to hang a
checkpoint off.

Reading the first real pack found two rendering bugs that had been there since stage 3 and
were invisible until a brief was laid out for a human: a newline in an entry broke it out of
its own list item, and the title was printed beside a body that merely repeated it. Fixing the
second cut `loop-demo` from 300 tokens to 219. Written up in `NOTES.md`.

**Reviewed 2026-09-13, and the budget override task below was ticked while wrong.** It did
render a fresh version, but that version became the highest one, and a plain serve took the
highest - so one `--budget 150` made every later pack 150 tokens. It also rendered an empty
pack for a project never derived, and wrote the override onto the project row mid-transaction.
The tail kept the newline bug the entries were fixed for, and its heading and bullet were not
counted against its reserve. All fixed with a regression test each; the override tests that
existed passed throughout, because none served twice. Detail in `06-context.md`.

- [x] `preamble.md` with a variant per target vendor
- [x] Pack assembly: preamble, the three layer sections, the tail
- [x] `GET /v1/projects/{id}/resume` with vendor, budget and door, writing an `injections` row
- [x] Budget override at serve time renders a fresh version rather than truncating the
      current one - stored, but never the current brief: only a render at the project's own
      budget moves `current_brief_version_id`, and every reader of "the brief" reads that
      pointer (invariant 5 reworded). As first ticked, the override leaked into every later
      serve
- [x] CLI `herder render`, re-rendering from stored entries with no inference - a stored
      version is immutable, so a brief rendered before a render fix needs this to change
- [x] CLI `herder resume`, so a pack can be pasted into a real chat by hand and looked at
- [x] Tried by hand in at least two different chatbots, and what each one did with it written
      down

      Done 2026-09-13 in claude.ai and chatgpt.com, `loop-demo` v4, one try each. Both obeyed
      "do not summarise". Asked which database production uses, **Claude said MySQL** (right,
      from the tail) and **ChatGPT said PostgreSQL 16.2** (wrong, from the stale entries).
      Written up in `NOTES.md`; what it means is a stage 10 question.

## Stage 6 - Verify

**Done 2026-09-13.** A checkpoint probes a served
pack with the local model, grades by NLI, and scores integrity by category. Run for real on
`loop-demo` four times, and the first real run is what made it work: the answer prompt made
qwen2.5:3b say "Not stated." to everything, the probe writer declined half the entries, and
it invented expected answers. All three fixed and measured, detail in `06-context.md`.

- [x] `probe_gen.md`, and probes cached per `(entry_id, entry_revision)` - one row per
      category, copied rather than regenerated. **The model writes every probe; the templates
      the plan named were dropped** (a template cannot question free prose without leaking
      the answer - reasoning in `03-architecture.md`). Every probe is checked in code for
      leaking its answer and for being entailed by its own source
- [x] Probe selection: 3 included, 2 excluded, 1 uncovered, and fewer reported honestly when
      there are not enough of a category. Seeded on the injection id; pins first
- [x] Grading by NLI: does the actual answer entail the expected one. 1, 0.5 or 0, with the
      label and its score kept as the reason
- [x] An inconclusive grade excludes the probe and flags it. Never defaulted to 0 or to 1 -
      stored as a NULL score (migration 0003); nothing graded writes no checkpoint at all
- [x] Integrity as the weighted mean, with the three category scores also reported separately
- [x] `transmission_failed` set on an included entry that scored 0 (and cleared by a later 1)
- [x] Suggestions created for excluded and uncovered zeroes, one open suggestion per miss
- [x] `POST /v1/injections/{id}/checkpoint` in `local` mode, `GET /v1/checkpoints/{id}`,
      `GET /v1/projects/{id}/integrity`, plus `herder checkpoint` on the CLI
- [x] The checkpoint job completing in the Docker worker. It first failed with
      "sentence-transformers is not installed": `requirements.txt` had it commented out since
      stage 3, so the image never had NLI. Fixed there and in the `Dockerfile` (CPU torch,
      1.51 GB image). After the rebuild: **done, integrity 0.50 over 4 probes in 6.8 s**,
      identical to the CLI run on the same serve
- [x] The wall-clock of one checkpoint recorded: **8.6 to 10.2 s** warm for 2 to 4 graded
      probes on `loop-demo`, 17.5 s on the first run of the session (NLI model load)

## Stage 7 - Adjust

**Done 2026-09-13.** A person can change the memory, and - the part the task list did not
say - **the next derive no longer undoes it.** Before this stage, derive could supersede a
pinned entry, rewrite text a person had edited, and attach lineage to an entry they wrote.
Now an entry a person holds (pinned, written, or edited) is never changed by derive: a more
specific candidate counts as a duplicate, and a contradiction becomes a `conflict` suggestion
with both entries kept. Checked live on a throwaway `stage7-check` project through the CLI and
the Docker worker, not only in tests.

- [x] `pin`, `unpin`, `remove`, `restore`, `edit`, `relayer`, `add`, `promote`, `archive` -
      `POST /v1/entries/{id}/{action}`, `PATCH /v1/entries/{id}` (edit and relayer),
      `POST /v1/projects/{id}/entries`; `herder entries` and `herder adjust` on the CLI. A
      move the status flow does not allow is a 409 with the reason, never a silent no-op
- [x] Every action writes an `entry_events` row and a revision where the text changed. The
      first test found the event recording the new status as the old one (a bulk update
      rewrites the object in the session); fixed in all four places it could happen
- [x] Every action enqueues a `render`, never a `derive` - and an edit also enqueues `embed`,
      because the stored vector described the old text
- [x] Pinned entries always included and always probed - every pin, even past the count of 3
- [x] Manual entries carry `source = user` and no lineage, and the API says so - a
      `lineage_note` on the entries list and a `note` on the lineage endpoint, and derive
      never adds lineage to one
- [x] `GET /v1/entries/{id}/lineage`
- [x] Suggestions accept and dismiss - `GET /v1/projects/{id}/suggestions`,
      `POST /v1/suggestions/{id}/accept|dismiss`, `herder suggestions`. Accepting acts (UC-6):
      `add_back` pins, `extract` writes the message as a cited entry, `promote` moves to Stable,
      `conflict` lets the new claim supersede the held one; dismissing a `conflict` removes the
      new claim. Promotion suggestions are now actually created - stage 3 set only the flag
- [x] **The removed-never-resurrects test, end to end**: ingest, derive, remove, ingest the
      same material again, derive, assert it is still gone. Through the API in the suite, and
      live: the re-paste gave 4 candidates, **2 dropped as matching the removed entry, 0
      created**

## Stage 8 - Minimal web UI

Bare. No styling pass before the stage 9 baseline exists.

**Done 2026-09-13. The prototype exists.** Server-rendered Jinja pages in `herder/web/`, served
by the same FastAPI process at `/`, logged in by pasting the API key (held in an HttpOnly,
SameSite=Strict cookie). The only script is a copy button. Driven live against the running
containers end to end: paste, derive by the worker, pin, brief, serve, checkpoint by the
worker (integrity 0.83), dashboard. **The gate stands: no styling until stage 9's baseline.**

- [x] Adjuster: three columns by layer, each entry with kind, title, text, confidence, an
      in-brief indicator, and pin / remove / edit (plus restore, add by hand, derive now,
      re-render, serve)
- [x] Lineage panel: the raw messages behind an entry, highlighted - phrase by phrase, so a
      merged entry marks each claim; a message matching nothing is shown unmarked rather
      than marked wrongly; a manual entry says it has none
- [x] Brief page: the rendered text, a copy button, the version list, a diff between versions
      (override versions labelled as such)
- [x] Checkpoint page: every probe with expected, actual, score and reason, and an add-back
      button - which accepts the open suggestion if there is one and pins otherwise. The page
      says the score is one system checking itself, not the benchmark number
- [x] Suggestions inbox at the top of the adjuster
- [x] Dashboard: tokens captured, entries by layer, current brief tokens, compression ratio,
      integrity over time, job failures
- [x] A paste box, so the whole loop can be demonstrated without a terminal - into an existing
      project or a new one, and it always queues a derive

## Stage 9 - Corpus and baseline

- [ ] Twenty synthetic conversations, 8k to 60k tokens, five per archetype
- [ ] A hand-written ground-truth fact list per conversation, 30 to 60 facts, tagged by kind.
      **Written from the conversation, never from an extraction**
- [ ] `bench/methods/`: `herder`, `naive_summary`, `truncate_tail`
- [ ] `bench/run.py`, driving the real pipeline through the API
- [ ] Metrics: recall of ground-truth facts, hallucination rate, compression ratio, and
      wall-clock per resume. Per archetype as well as combined, and per extractor
- [ ] The answering model is the same local model for every method. Holding the reader
      constant is what makes the comparison mean anything
- [ ] Results as files in `bench/results/`, committed
- [ ] **The baseline recorded before anything is tuned**
- [ ] The per-fact detail behind every number, so the next change is informed

## Stage 10 - Iteration

- [ ] At least three genuine attempts, each measured, each written into `NOTES.md` including
      the ones that failed
- [ ] Candidates in cost order: render ordering, tail reserve size, similarity threshold,
      chunk size, the extraction prompt, a larger quantisation, and whether the layer split
      earns its keep
- [ ] The `trained` extractor, if the earlier candidates run out. Synthetic
      conversation-to-entry pairs, fine-tuned on Colab's free T4, measured against the other
      two on the same corpus
- [ ] One change at a time. The count reported beside every percentage
- [ ] The dead ends kept and written up

## Stage 11 - Host it, write the README

- [ ] A host with PostgreSQL **and pgvector** - a smaller set of free tiers than plain
      PostgreSQL, and the thing to check first
- [ ] The demo seeded. A link that opens on an empty project demonstrates nothing
- [ ] What a visitor may do, decided and enforced. Not because a paste box spends money any
      more, but because a free tier cannot hold the model or spare the CPU
- [ ] README: the problem, the architecture diagram, the numbers beside `naive_summary` and
      `truncate_tail`, the dead ends, the limitations, and the circular-measurement caveat
      stated plainly

## Stage 12 - Browser extension (optional)

- [ ] Manifest V3, TypeScript, Vite. Host permissions per vendor domain, each opt-in
- [ ] `VendorAdapter` interface, adapters for ChatGPT and Claude, kept tiny
- [ ] DOM fixture tests from saved HTML snapshots per vendor
- [ ] A broken adapter fails loudly in the popup. Silent capture failure is the one outcome
      that must not be possible
- [ ] `MutationObserver`, turn-complete detection, diffing against the last emitted set
- [ ] Background worker: batching, retry with backoff, persistence in `chrome.storage.local`
- [ ] Popup: capture on/off per site, project picker, Resume button, integrity badge
- [ ] Resume inserts into the composer and stops. **Never auto-send**
- [ ] A visible indicator while capturing, a first-run screen saying exactly what is sent, and
      a pause hotkey
- [ ] `in_chat` checkpoint flow

## Stage 13 - MCP door (optional)

- [ ] FastMCP over the existing API, authenticating with a herder API key
- [ ] `herder_list_projects`, `herder_get_context`, `herder_search_context`,
      `herder_add_entry`, `herder_log_message`, `herder_checkpoint`
- [ ] `herder://projects/{id}/brief` as a resource
- [ ] Tested against a real MCP client

## Stage 14 - Hardening and self-host (optional)

- [ ] `GET /v1/me/export` - every message, entry and brief as JSON
- [ ] `DELETE /v1/me` - a `delete_user` job that hard-deletes, including job payloads
      referencing the user
- [ ] Rate limits on `/ingest` per key and on everything that can trigger inference
- [ ] `GET /metrics` in Prometheus text format
- [ ] `docs/self-host.md`, with `docker compose up` as the primary path
- [ ] Registration, Argon2 passwords, and `workspace_members` - only when there is a second
      user
