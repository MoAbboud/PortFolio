# herder - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

**Stages 0 to 9 are done and stage 10 has run five measured attempts.** The prototype runs at
`http://localhost:8000`; 484 tests pass. The author wrote 261 facts across eight conversations; three
were corrected in a blind audit on 2026-09-15, so the key is 221 true and 40 false.

**The current numbers, all from one run** (`2026-09-16_1338-full-comparison`, every method judged by the
same reader on the same key): **herder recalls 0.70 of the facts at a 3,000-token budget in 1,214 tokens
(9.1x compression), against a plain summary at 0.21 in 2,115 tokens and raw recent text at 0.31 in 2,967;
at 500 tokens, 0.45 against 0.05 and 0.07. On the facts marked essential, 0.81 against 0.30 and 0.31.
Wrong claims: 0.00, against the summary's 0.09.** The baseline before stage 10 was 0.36 at 3,000.

**The instrument's limit, measured:** two runs of the same code differ on about 3.4% of verdicts
(18 of 522) even on byte-identical briefs, so the noise floor is roughly +/- 4 facts.

**Stage 11 - hosting and the README - is the remaining deliverable.** Stage 10's open candidates are the
500-token budget (the render ordering) and the bad merges recorded in `NOTES.md`.

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

**Built 2026-09-13; waiting on the author's fact lists.** Everything but the answer key exists
and has been run end to end on a scratch copy with three placeholder facts (never in
`bench/datasets`). **The author chose, when asked:** 8 conversations rather than 20 for the
first baseline, a new generator rather than stage 4's, and to write every fact himself.

- [x] ~~Twenty synthetic conversations, 8k to 60k tokens, five per archetype~~ **Eight, 9k to
      13k tokens, two per archetype** (coding, research, planning, handover) - the author's
      scope for the first baseline; twenty stays the target for later. From
      `bench/generate.py`, a new generator with different subjects and phrasing, because the
      heuristic was tuned on stage 4's conversations. Every turn unique; the app's own parser
      reads back every turn of all eight
- [x] A hand-written ground-truth fact list per conversation, 30 to 60 facts, tagged by kind.
      **Written from the conversation, never from an extraction.** Done 2026-09-14 by the
      author: **261 facts, 222 true and 39 false**, 30 to 37 per conversation, every one citing
      the turns it came from. The author's, at
      `http://localhost:8000/bench` - a page showing the numbered conversation and nothing
      herder derived. Each fact is marked true or false; false facts (turned-down ideas,
      reversed decisions) are what hallucination is measured on
- [x] `bench/methods.py`: `herder`, `naive_summary`, `truncate_tail`, plus a `no_context`
      control showing what guessing alone scores
- [x] `bench/run.py`, driving the real pipeline through the API (a `POST /v1/projects`
      endpoint was added for it). Resumable; `--label baseline` refuses to start until every
      fact list has at least 30 facts
- [x] Metrics: recall, hallucination (false facts judged true), contradiction, compression,
      and time to build. Per archetype as well as combined, per kind, and per extractor (the
      run records the worker's; a second extractor is a second run)
- [x] The answering model is the same local model for every method, with one versioned
      prompt (`bench/prompts/read.md`)
- [x] Results as files in `bench/results/`, committed - `2026-09-14_1817-baseline`
- [x] **The baseline recorded before anything is tuned.** 53 minutes, heuristic extractor.
      **herder 0.36 recall at 11.4x compression (3,000 budget) and 0.32 at 28.3x (500)**,
      against `truncate_tail` 0.31 at 3.7x and 0.07 at 25.2x, and `no_context` 0.00. At the
      same actual context size - about 400 tokens - the brief recalls 0.32 where the raw tail
      recalls 0.07. Against the project's target: the 20x holds, the 0.85 does not.
- [x] **`naive_summary` made a fair comparison** in `2026-09-14_1928-naive-summary-fixed`
      (prompt v2, budget-sized length targets, 3,000-token parts): its summaries went from
      107-319 tokens to 1,707-2,792 and its recall from 0.03 to 0.23, and **herder still wins
      at both budgets** - 0.34 to 0.23 at 3,000 with fewer tokens used, 0.30 to 0.05 at 500.
      One conversation still times out, so that comparison is over seven. As first run it was
      not a fair comparison at all: and is recorded as unusable
      rather than quoted: the summariser ignored the budget (107-319 tokens of the 3,000 it
      was allowed, and identical at both budgets) and timed out on two of the eight
      conversations. Fixing the comparator is a harness fix, not tuning herder, and the
      re-run is recorded as its own labelled run beside this baseline
- [x] The per-fact detail behind every number - the report's last section, every fact against
      every method, with the exact context each reader saw saved beside it

## Stage 10 - Iteration

- [x] At least three genuine attempts, each measured, each written into `NOTES.md` including
      the ones that failed. **Three. (c) General rules for sentences with no cue word, rules-v2**
      (`2026-09-15_1608-general-rules`): recall 0.41 -> 0.68 at 3,000 (essential 0.55 -> 0.78)
      and 0.36 -> 0.43 at 500, but open threads at 500 fell 0.46 -> 0.08 and one wrong claim
      came back (a stale plain statement not superseded). Built from ordinary English, never
      the benchmark generator's lead-ins - a test enforces it. The earlier two: (a) The `local` extractor loses to the rules**
      (`2026-09-14_2018-local-extractor`): recall 0.20 against 0.41, half the entries, 272 s a
      conversation against 9 s - `mailman`'s model-loses-to-regex finding in another domain,
      and the reason the three-extractor design exists. **(b) Extracting reversals worked**
      (`2026-09-14_2011-reversal-rule`) - recall 0.36 -> 0.41 at 3,000 and 0.32 -> 0.36 at 500,
      **wrong claims 0.10 -> 0.00**. The cause was not the merge step failing to supersede, as
      assumed, but the reversal sentences matching no extraction rule at all, so nothing ever
      contradicted the stale entry
- [x] Facts tiered `essential` / `useful` / `incidental` (the author rated all 261: 136 / 100 /
      25), and every earlier run re-scored per tier by re-reading its verdicts -
      `python -m bench.report <run> --tiers-from bench/datasets`, written to
      `bench/results/rescored/`, refused if any fact differs from what the run judged. Not an
      attempt at improvement - an instrument. With the reversal rule herder recalls **0.55 of
      essential facts** at 3,000 (59 of 108), 0.33 useful, 0.16 incidental; `truncate_tail @
      3000` is flat at 0.31 / 0.33 / 0.24. 453 tests pass
- [x] The answer key audited blind (eight reviewers shown no results, every proposal verified
      against the turns): 3 of 261 facts corrected, each with its evidence in the fact's `note`
      - shipping f011 truth true -> false, law-firm f035 reworded, photo-sync f020 turns. Key now
      221 true / 40 false. Reference run on it: `2026-09-15_1650-general-rules-corrected-key`,
      recall 0.68 / 0.43, wrong claims 2 of 40 / 0 of 40. **Two identical runs give identical
      verdicts (518 pairs, 0 different)** - the reader is deterministic
- [x] Attempt 4 - a correction retires what it corrects (`2026-09-15_1708-reversal-merge`): a
      candidate carrying a change cue supersedes on one strong direction of contradiction (>= 0.9),
      full sentence or claim after its lead-in. Wrong claims 2 of 40 -> 0 at 3,000; recall 150 -> 152
      and 96 -> 98. Cost seen once: a partial change retiring the agreeing half (photo-sync f004)
- [x] Attempt 5 - attempt 3's reply-talk exclusion blocked every sentence containing "answer"
      (`2026-09-15_1718-answer-exclusion-fix`): recall 152 -> 156 at 3,000 (essential 0.81), 98 -> 98
      at 500, wrong claims still 0. Open threads at 500 still 0.08 - next
- [x] The full four-method comparison on the corrected key with the current code
      (`2026-09-16_1338-full-comparison`): **herder 0.70 (154/221) at 3,000 in 1,214 tokens against
      naive_summary 0.21 in 2,115 and truncate_tail 0.31 in 2,967; 0.45 against 0.05 and 0.07 at 500;
      essential 0.81 against 0.30 and 0.31; wrong claims 0.00 against naive_summary's 0.09.** This is
      the run the README's numbers come from
- [!] **The reader is not deterministic across conditions**: 18 of 522 verdicts (3.4%) differ on
      byte-identical contexts between two runs of the same code. Noise floor about +/- 4 facts, so
      attempts 4 and 5 are inside it on recall and rest on their mechanisms instead. Any future
      attempt claiming less than ~5 facts needs repeated runs
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
