# herder - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

**Stages 0 and 1 are done. Stage 2 is built and tested; the two tasks that need a model
on the machine are marked `[~]` and wait on Ollama being installed.** 140 tests pass.

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

- [ ] A `sentence-transformers` embedder at 384 dimensions, on CPU. The model is decided
      before any embedding is written, because the pgvector dimension is fixed in the DDL
- [ ] `embed` job, run on entry creation and on revision
- [ ] Similarity search over `entries` with the HNSW index, top 3 above threshold
- [ ] **The removed-entry rule, in the merge step**: a candidate matching a removed entry is
      dropped. Test it directly, and test it after a re-derive of the same messages
- [ ] The NLI cross-encoder, and the mapping from entailment, contradiction and neutral onto
      the four verdicts in [03-architecture.md](03-architecture.md)
- [ ] A confidence floor below which no label is trusted
- [ ] No label above the floor falls back to `distinct`, and is counted
- [ ] Revisions on update, `superseded_by` on supersede, lineage union on both
- [ ] Session tail: the last 1200 tokens of the most recent conversation, one entry of kind
      `tail`, replaced wholesale each derive
- [ ] Ageing: session entries untouched for 7 days below 0.7 confidence to `archived`
- [ ] `promotion_suggested` on preference and identity entries seen in 3+ conversations. **No
      automatic promotion** - test that the layer does not change
- [ ] `render()` in `domain/`, pure, with the ordering and the tail reserve from
      [03-architecture.md](03-architecture.md). Unit tests for the ordering, for the budget
      boundary, and for a tail that does not fit
- [ ] `brief_versions` written with included and excluded ids, source counts, and the trigger
- [ ] `projects.current_brief_version_id` updated, and invariant 5 tested
- [ ] `GET /v1/projects/{id}/brief` and `GET /v1/projects/{id}/entries`
- [ ] `POST /v1/projects/{id}/derive` and `/render` to force each by hand
- [ ] Every invariant in [04-data-model.md](04-data-model.md) has a test
- [ ] CLI: `herder paste`, `herder brief`

## Stage 4 - Ten conversations end to end

- [ ] Ten varied long transcripts, written by hand or generated, 8k to 60k tokens, across the
      four archetypes. Not the benchmark corpus - that comes at stage 9 with ground truth.
      These exist to break the pipeline
- [ ] All ten through the running API
- [ ] **A written list of everywhere it got something wrong**, in `NOTES.md`. Specifically
      looked for: entries that should have merged and did not; the model's rejected
      suggestions recorded as decisions; constraints losing to facts in the render ordering;
      a session tail eating its whole reserve and more; near-duplicate entries the similarity
      threshold missed; lineage pointing at a plausible but wrong message
- [ ] **Entry count plotted against source tokens for all ten.** A linear relationship means
      the merge step is not working and the compaction claim fails. This is a stop-and-fix,
      not a note
- [ ] The first real compression ratio recorded, with the count behind it
- [ ] The wall-clock of deriving each conversation recorded from `model_calls`, per
      implementation
- [ ] **`heuristic` against `local` on all ten**, side by side. `mailman`'s equivalent
      comparison is the most interesting thing in that project
- [ ] The failure list turned into the shortlist for stage 10

## Stage 5 - Serve

- [ ] `preamble.md` with a variant per target vendor
- [ ] Pack assembly: preamble, the three layer sections, the tail
- [ ] `GET /v1/projects/{id}/resume` with vendor, budget and door, writing an `injections` row
- [ ] Budget override at serve time renders a fresh version rather than truncating the
      current one
- [ ] CLI `herder resume`, so a pack can be pasted into a real chat by hand and looked at
- [ ] Tried by hand in at least two different chatbots, and what each one did with it written
      down

## Stage 6 - Verify

- [ ] `probe_gen.md`, and probes cached per `(entry_id, entry_revision)`
- [ ] Probe selection: 3 included, 2 excluded, 1 uncovered, and fewer reported honestly when
      there are not enough of a category
- [ ] Grading by NLI: does the actual answer entail the expected one. 1, 0.5 or 0, with the
      label and its score kept as the reason
- [ ] An inconclusive grade excludes the probe and flags it. Never defaulted to 0 or to 1
- [ ] Integrity as the weighted mean, with the three category scores also reported separately
- [ ] `transmission_failed` set on an included entry that scored 0
- [ ] Suggestions created for excluded and uncovered zeroes
- [ ] `POST /v1/injections/{id}/checkpoint` in `local` mode, `GET /v1/checkpoints/{id}`,
      `GET /v1/projects/{id}/integrity`
- [ ] The wall-clock of one checkpoint recorded

## Stage 7 - Adjust

- [ ] `pin`, `unpin`, `remove`, `restore`, `edit`, `relayer`, `add`, `promote`, `archive`
- [ ] Every action writes an `entry_events` row and a revision where the text changed
- [ ] Every action enqueues a `render`, never a `derive`
- [ ] Pinned entries always included and always probed
- [ ] Manual entries carry `source = user` and no lineage, and the API says so
- [ ] `GET /v1/entries/{id}/lineage`
- [ ] Suggestions accept and dismiss
- [ ] **The removed-never-resurrects test, end to end**: ingest, derive, remove, ingest the
      same material again, derive, assert it is still gone

## Stage 8 - Minimal web UI

Bare. No styling pass before the stage 9 baseline exists.

- [ ] Adjuster: three columns by layer, each entry with kind, title, text, confidence, an
      in-brief indicator, and pin / remove / edit
- [ ] Lineage panel: the raw messages behind an entry, highlighted
- [ ] Brief page: the rendered text, a copy button, the version list, a diff between versions
- [ ] Checkpoint page: every probe with expected, actual, score and reason, and an add-back
      button
- [ ] Suggestions inbox at the top of the adjuster
- [ ] Dashboard: tokens captured, entries by layer, current brief tokens, compression ratio,
      integrity over time, job failures
- [ ] A paste box, so the whole loop can be demonstrated without a terminal

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
