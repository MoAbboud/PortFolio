# herder - Architecture

## Shape

One FastAPI process serving the API and the web UI, one worker process draining a
database-backed job queue, one PostgreSQL with pgvector, and a set of model files on disk
that the worker loads. Everything else - the browser extension, the MCP server, the benchmark
harness - is a client of that API and holds no state of its own.

**There is no model provider in this diagram and there is no key anywhere in this project.**
Every model runs locally.

```mermaid
flowchart LR
    subgraph doors[Doors]
        EXT[Browser extension]
        MCP[MCP server]
        CLI[CLI / curl]
        WEB[Web UI]
    end

    subgraph proc[API process]
        API[FastAPI]
        DOM[domain: chunk, merge, render, grade]
    end

    subgraph work[Worker process]
        W[Job runner]
        H[derive, render, embed, probe_gen, checkpoint]
    end

    DB[(PostgreSQL + pgvector)]

    subgraph mdl[Local models, files on disk]
        MX[Extractor: heuristic, local weights, or trained]
        MN[NLI: merge verdicts and probe grading]
        ME[Embeddings: sentence transformer]
    end

    EXT --> API
    MCP --> API
    CLI --> API
    WEB --> API
    API --> DOM
    API --> DB
    API -->|enqueue| DB
    W -->|poll, SKIP LOCKED| DB
    W --> H
    H --> DOM
    H --> DB
    H --> MX
    H --> MN
    H --> ME
```

The API never loads or runs a model. All inference happens in the worker, which is what makes
`POST /v1/ingest` fast and safe to hammer from a browser extension, and what stops a minutes-
long derive from turning into a minutes-long HTTP request. On a machine with no dedicated GPU
that separation stops being a nicety and becomes the thing that makes the system usable at
all.

## Stack

| Concern | Choice | Note |
| --- | --- | --- |
| Service | FastAPI | The generated OpenAPI page is a demo surface before there is a UI |
| Language | Python 3.12 | Same as the sibling backend project. The extension is the only TypeScript |
| Database | PostgreSQL 16 + pgvector | Similarity search over entries is the merge step. A second store for vectors would be a second place for the same fact to live |
| ORM | SQLAlchemy 2, async, asyncpg | |
| Migrations | Alembic | From the first commit. The first migration is hand-written so the constraints are visible |
| Schemas | Pydantic v2 | One definition used as the extractor's output schema, as the JSON grammar it compiles to, and as the parse target |
| Queue | The `jobs` table, `SKIP LOCKED` | A broker earns its place when retry has to survive a restart. This does not yet |
| Extraction | An interface with three implementations | `heuristic`, `local`, `trained`, chosen by `HERDER_EXTRACTOR`. Copied deliberately from `mailman`, where the same shape produced the project's most interesting result |
| Local inference | **Ollama**, over HTTP on localhost | Decided at stage 2. `llama-cpp-python` publishes no wheel for Python 3.13 on Windows and building it needs an MSVC toolchain that is not installed - requiring a C++ compiler to run this would be a bad trade. Ollama runs llama.cpp underneath, enforces a JSON schema during decoding through the same grammar machinery, and reports prompt-eval and generation time separately, which is exactly the split stage 2 has to measure |
| Merge and grading | An NLI cross-encoder | Entailment, contradiction and neutral are exactly the distinctions the merge step and the judge need. Small enough to run on CPU without thinking about it |
| Embeddings | `sentence-transformers` | 384 dimensions. Fixes the pgvector column, so it is a migration and not a setting |
| Tokens | `tiktoken`, `cl100k_base` | The budget ruler, documented as an estimator. Deliberately **not** the local model's own tokeniser: the budget describes a brief that some other vendor's model will read, so a neutral consistent ruler is the point. The local model's own tokeniser is used only for its own context limit |
| Local environment | Docker Compose | One command brings up API, worker and database |
| Tests | pytest | Concentrated on `domain/`, the invariants and the merge verdicts |
| Web UI | Server-rendered templates | No Node build step, one process, runs from PowerShell. The extension is where the TypeScript budget goes |
| Extension | TypeScript, Manifest V3, Vite | Deferred until the core loop is measured |

## The models

Four pieces of inference, none of them hosted, all of them files on disk under `models/`,
which is gitignored for the same reason `mailman`'s is - weights are large and rebuildable,
and the recipe is the artifact worth committing.

**Extraction is an interface with three implementations**, selected by `HERDER_EXTRACTOR`,
and an unknown value is an error rather than a silent default:

| Implementation | What it is | Why it exists |
| --- | --- | --- |
| `heuristic` | Rules over turn structure and cue phrases. Filters to user turns and agreed statements, keys on modal and commitment language for constraints and decisions, and takes lineage from the turn it matched | It needs no weights, no GPU and no download, it runs in milliseconds, and **it is what a free hosting tier can actually serve.** It is also the honest baseline: if the model cannot beat it, that is the finding |
| `local` | A quantised instruction model in the 3B class, run through `llama.cpp` with a grammar that forces valid JSON | The default for real use. Good enough for structured extraction, small enough to run on CPU |
| `trained` | A model fine-tuned by hand on synthetic conversation-to-entry pairs, on Colab's free T4 | Stage 10. It arrives as a measured improvement over the other two rather than as a prerequisite, so the loop is never blocked on a training run |

This is `mailman`'s shape, deliberately. There, three extractors behind one protocol produced
the project's most interesting result - the trained model ran ahead of the plan for five
stages and then lost to eleven lines of regular expressions on realistic documents. That
outcome was only visible because both existed and the harness could compare them. The same
arrangement here means the question "did the model actually help" has an answer.

**Merging and grading use an NLI cross-encoder rather than a generative model.** This is not a
compromise forced by having no key; it is a better fit. The four merge verdicts are almost
exactly the three NLI labels: a candidate that entails an existing entry is a `duplicate`, one
that contradicts it is a `supersede`, one that is neutral to it is `distinct`, and `update` is
entailment in one direction only. Grading a probe answer is the same operation - does the
actual answer entail the expected one - and it yields the three-valued 0 / 0.5 / 1 score
naturally instead of asking a generative model to pick a number and hoping it is calibrated.

**Embeddings** are a sentence transformer at 384 dimensions, on CPU, over `title + text`.

### What CPU-only means in practice

The target machine has no dedicated GPU. Working assumption, to be replaced by a real
measurement at stage 2: a full derive of a 60k-token conversation is roughly ten extraction
calls, and on CPU that is **minutes to tens of minutes**, dominated by prompt processing
rather than by generation.

Three consequences follow, and they are design inputs rather than complaints:

1. **The architecture already absorbed this.** Derivation is a background job, the API never
   runs a model, and nothing waits on a derive. That was decided for a different reason and it
   is what makes a slow local model acceptable.
2. **Chunk size becomes a much bigger lever than it was.** Every call re-processes the
   instructions, the worked examples and the existing entry titles, so ten chunks pay that
   overhead ten times. Larger chunks cut the repeated cost; small models get worse over long
   contexts. That is a real trade with a measurable optimum, and it belongs in stage 10.
3. **Nothing may call a model where a rule or an index would do.** Adjudication runs only on
   candidates that clear the similarity threshold, never on every pair. The session tail is
   copied, not summarised. Re-rendering after an edit re-runs no inference at all.

## Layers

```
api/          routers. HTTP in, HTTP out. No logic, no inference
extractors/   the three implementations behind one protocol, and lineage validation
schemas/      Pydantic request and response models
services/     orchestration: ingest, derive, serve, checkpoint, adjust. Talks to the database
domain/       pure functions: chunking, merging, rendering, scoring. No IO. Heavily tested
models/       SQLAlchemy tables
core/         config, db session, security, llm client, tokens, embeddings
worker/       job runner and one handler per job kind
prompts/      versioned prompt templates
```

The line that matters is `domain/`. Chunking, the render ordering and budget, the merge
verdict handling and the integrity weighting are pure functions over plain data with no
database and no network, so they can be tested exhaustively and cheaply. Everything
expensive to test lives outside them. This is deliberate: the parts of this system most
likely to be wrong are also the parts most awkward to reach through an API, and putting them
behind a service call would mean they were never properly tested.

## The loop

Six stages. Stages 1 and 2 run continuously, 3 runs on a trigger in the background, 4 to 6
run when a person asks.

```mermaid
flowchart LR
    C[1 Capture<br/>observe or paste] --> I[2 Ingest<br/>normalise, dedupe, append]
    I --> D[3 Derive<br/>extract, merge, render]
    D --> S[4 Serve<br/>resume pack]
    S --> V[5 Verify<br/>probe, grade, score]
    V --> A[6 Adjust<br/>pin, remove, edit]
    A --> D
```

### 1. Capture

A turn is captured when it is finished. For the extension that means the assistant's node
has stopped mutating for 1500 ms, or the user's message has rendered. Events are batched -
twenty of them or two seconds, whichever comes first - and held in local storage until the
server acknowledges them, so closing the tab mid-batch loses nothing.

Pasting a transcript is the same path with a parser in front of it, and it is the door built
first, because it needs no browser and it exercises everything after it.

### 2. Ingest

Resolve `(vendor, vendor_conv_id)` to a conversation, creating it on first sight. Insert
messages, ignoring conflicts on `content_hash`. Count tokens. Add the new token count to
`projects.tokens_since_derive` and enqueue a derive if the project has crossed the threshold
(2000 tokens by default) or the last derive is older than the maximum age (10 minutes) and
there is new material. The partial unique index on `jobs` makes a second enqueue a no-op
rather than a duplicate job.

### 3. Derive

The core, and the only stage that is interesting. It runs against a cursor - the last `seq`
processed per conversation - so it only ever reads material it has not seen.

```
derive(project):
    new = messages after project.derive_cursor, across the project, in time order
    if none: return

  A chunk       split at turn boundaries, target 6000 tokens
  B extract     per chunk, one call to the configured extractor, structured output:
                  [{layer, kind, title, text, lineage[msg ids], confidence, supersedes_title?}]
                given the chunk and the titles of the project's existing active entries
                (the local extractor is grammar-constrained, so the JSON is valid by
                 construction; the heuristic one emits the same shape from rules)
  C merge       per candidate, embed it, search entries by cosine similarity (threshold 0.86)
                  no match          -> create
                  match, and the match is removed -> DROP. Removed means removed
                  otherwise         -> run NLI over candidate against each match:
                      duplicate  -> extend lineage, bump last_seen, seen_in_conversations
                      update     -> new revision, merged text, union of lineage
                      supersede  -> new entry, old one superseded_by the new
                      distinct   -> create
  D tail        the last 1200 tokens of the most recent conversation, verbatim, as one
                session entry of kind=tail. Replaced wholesale each derive, never merged
  E age         session entries untouched for 7 days with confidence < 0.7 -> archived
                project entries of kind preference or identity seen in 3+ conversations
                  -> promotion_suggested, never promoted automatically
  F render      a new brief version under budget
    advance the cursor, reset tokens_since_derive
```

Three things in that are load-bearing and worth stating separately.

**Extraction is given the existing titles.** Without them the model re-states things the
system already knows in slightly different words on every pass, and the merge step spends
its budget adjudicating near-duplicates it should never have been handed. With them the
model can say `supersedes_title` and the merge step gets a hint rather than a guess.

**Merge is a two-stage filter and the cheap stage runs first.** Embedding similarity is
arithmetic over a vector index and it costs nothing; adjudication is a model call. Only
candidates that clear the similarity threshold are adjudicated, and only against their top
three matches. Adjudicating every candidate against every entry would be the obvious
implementation and it would make the cost of derivation quadratic in the size of the memory.

**The session tail is not merged, it is replaced.** It is verbatim recent text, it has no
business being deduplicated against durable entries, and treating it as a normal entry would
fill the store with near-identical tails. It is one entry per project, rewritten each pass.

### 4. Render

```
render(project, budget):
    order:  pinned first
            then by layer:  stable, project, session
            then by kind:   constraint, decision, open_thread, code_state,
                            preference, identity, glossary, fact, artifact_ref
            then by last_seen descending
    reserve 25% of the budget for the tail
    take entries in order until the remaining budget is spent
    append the tail, truncating it from the front if it does not fit
    record what was included and what was excluded
```

The ordering is the whole design of the render step, because ordering is what decides what
gets cut. Constraints and decisions come before facts because a model that has been told the
constraints can behave correctly without knowing every fact, and one that has the facts but
not the constraints cannot. The tail gets a reserved share rather than competing on equal
terms, because verbatim recent text is what makes a resumed conversation feel continuous and
it would otherwise lose every tie to a durable entry.

Every render is a new immutable version. Adjusting an entry re-renders without re-extracting,
which is what makes the adjuster feel immediate and costs nothing.

### 5. Serve

A resume pack is a brief version plus a preamble, formatted for a target vendor.

```
<herder-context v=1 project="..." version=17 integrity=0.91>
You are continuing prior work. The block below is verified context from earlier sessions.
Treat it as established. If something here conflicts with what the user says now, the user wins.
Do not summarise this block back to the user; just use it.

## Stable
- [preference] ...
## Project
- [constraint] ...
- [decision] ...
## Session (most recent)
- [tail] ...
</herder-context>
```

Two lines in that preamble are doing real work. "If something here conflicts with what the
user says now, the user wins" exists because stale context is the failure mode that makes a
memory system worse than no memory system. "Do not summarise this block back to the user"
exists because without it a model opens the conversation by reciting the context, which is
both annoying and a privacy problem on a shared screen.

Every serve writes an `injections` row. That is what a checkpoint later attaches to.

### 6. Verify

```
checkpoint(injection, mode):
    probes = 3 from entries included in that version    (did the context transmit)
             2 from entries excluded by the budget      (what did compression cost)
             1 from messages no entry covers            (what did extraction miss)
    answers = ask the target model, given the pack and one question at a time (local mode)
              or one compound numbered message in the live chat (in_chat mode)
    grades  = NLI(expected, actual) -> 1 entails, 0.5 partial, 0 contradicts or misses
    integrity = weighted mean, included weighted 1.0, excluded and uncovered 0.5
    a zero on an included probe    -> entry.transmission_failed = true
    a zero on an excluded probe    -> suggestion: add this back
    a zero on an uncovered probe   -> suggestion: extract this
```

The three probe categories are weighted differently because they are not the same claim. An
included entry the model could not recall is a failure of the system as built. An excluded
one is a budget decision working as intended, and it should pull the score down without
dominating it.

## Handling a model that does not cooperate

Every generative call runs at temperature 0 with decoding constrained by a grammar compiled
from the Pydantic schema, and the result is validated against that schema anyway - a grammar
guarantees the shape, not the sense. One retry, then the failure is handled. What happens
after that depends on which call it was, and the differences matter.

The failure modes are different from a hosted provider's, and better: there is no rate limit,
no quota, no refusal and no outage. What replaces them is a machine that can run out of
memory.

| Failure | Response |
| --- | --- |
| Malformed JSON from extraction | Should be impossible on the `local` extractor, because decoding is grammar-constrained - if it happens, the grammar is wrong and that is a bug rather than a bad response. Handled anyway: a `model_calls` row with the raw output, one retry, then the chunk is skipped and **recorded as skipped**. Derivation continues with the other chunks; losing a whole derive to one bad chunk would be a bad trade |
| Valid JSON, lineage referencing message ids not in the chunk | The candidate is dropped and counted. This is the model inventing evidence, and it is the one failure that must never be tolerated, because the audit trail is the product. Grammar constraints cannot prevent it - a well-formed id can still be a fabricated one - so it is checked in code against the chunk that was actually sent |
| Valid JSON, lineage empty | Same. A derived entry without lineage is not a low-confidence entry, it is an unsupported claim |
| NLI returns no label above the confidence floor | Fall back to `distinct` - create the entry. The cost is a near-duplicate the user can see and remove; the alternative default, `duplicate`, silently discards new information |
| Probe generation fails | No probe for that entry. The checkpoint runs with fewer probes and **reports the count**. A checkpoint that says how many probes are behind it can be believed |
| Grading is inconclusive | The probe is excluded from the score and flagged, never defaulted to 0 or to 1. Both defaults are lies |
| Inference times out, or the process is killed for memory | Retried once, then the job fails, lands in `jobs.error`, and is visible on the dashboard. On a CPU-only machine an out-of-memory kill during a long derive is a realistic failure rather than a theoretical one, so the derive cursor only advances on success - a killed derive re-runs from where it was, it does not silently skip material |
| Model weights missing or not loadable | Startup fails loudly, naming the file and the env var. It does not fall back to the heuristic extractor: a system quietly producing worse briefs than the operator thinks is worse than one that will not start |

The rule underneath all of them: **a failure is recorded and counted, never defaulted into a
plausible value.** An extraction that silently produced nothing looks exactly like a chunk
that genuinely contained nothing worth keeping, and those two need to be told apart.

## The doors

| Door | Use | Records |
| --- | --- | --- |
| REST | Everything. The other doors are clients of it | Everything |
| CLI | `herder paste`, `herder brief`, `herder resume`. Checked from PowerShell | Through the API |
| Web UI | Adjuster, brief, checkpoints, dashboard | Through the API |
| Browser extension | Live capture and one-click resume into a composer | `door = extension` on the injection |
| MCP | Six tools, so an agent can read context and write back into it | `door = mcp` on the injection |

## API surface

All under `/v1`, JSON, bearer key or session cookie.

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/ingest` | A batch of observed turns. Idempotent. Returns accepted and duplicate counts |
| POST | `/ingest/paste` | A pasted transcript, parsed into messages |
| GET | `/projects` | |
| POST | `/projects` | |
| PATCH | `/projects/{id}` | Name, budgets |
| GET | `/projects/{id}/stats` | Tokens captured, entries by layer and status, current version, compression ratio, latest integrity |
| GET | `/projects/{id}/conversations` | |
| PATCH | `/conversations/{id}` | Move to another project |
| GET | `/conversations/{id}/messages` | The raw log, paged |
| GET | `/projects/{id}/entries` | Filterable by layer, status, kind. Each entry says whether it is in the current brief |
| POST | `/projects/{id}/entries` | Add one by hand |
| PATCH | `/entries/{id}` | Edit title, text or layer. Writes a revision |
| POST | `/entries/{id}/{action}` | `pin`, `unpin`, `remove`, `restore`, `promote`, `archive` |
| GET | `/entries/{id}/lineage` | The raw messages behind it |
| GET | `/projects/{id}/brief` | The current version |
| GET | `/projects/{id}/brief/versions` | |
| GET | `/brief-versions/{id}/diff` | Against another version |
| POST | `/projects/{id}/derive` | Force a derive now |
| POST | `/projects/{id}/render` | Force a re-render |
| GET | `/projects/{id}/resume` | The pack. Writes an injection. Takes vendor, budget, door |
| GET | `/injections/{id}/probes` | The compound probe message, for an in-chat checkpoint |
| POST | `/injections/{id}/checkpoint` | Run one. `local` mode runs it server-side against the local model; `in_chat` posts captured answers |
| GET | `/checkpoints/{id}` | Integrity and every probe with its reason |
| GET | `/projects/{id}/integrity` | The time series |
| GET | `/projects/{id}/suggestions` | |
| POST | `/suggestions/{id}/accept` | And `/dismiss` |
| GET | `/me/export` | Everything, as JSON |
| DELETE | `/me` | Enqueues a hard delete |
| GET | `/health` | Green from the first day, and verified to go red |
| GET | `/metrics` | Jobs by status, derive latency, model calls, tokens spent |

## Key sequence - a conversation becomes a brief

```mermaid
sequenceDiagram
    participant X as Extension or paste
    participant A as API
    participant DB as Database
    participant W as Worker
    participant M as Local models

    X->>A: POST /v1/ingest (batch of turns)
    A->>DB: insert messages, on conflict do nothing
    A->>DB: tokens_since_derive += n
    alt threshold crossed
        A->>DB: insert job(derive, project) if none in flight
    end
    A-->>X: accepted, duplicates
    W->>DB: claim job, SKIP LOCKED
    W->>DB: messages after cursor
    W->>M: extract(chunk, existing titles)
    M-->>W: candidate entries with lineage
    W->>W: validate lineage against the chunk
    W->>DB: embed and search for similar entries
    alt match is removed
        W->>W: drop the candidate
    else match found
        W->>M: NLI(candidate vs matches)
        M-->>W: duplicate | update | supersede | distinct
    end
    W->>DB: write entries, revisions, lineage
    W->>DB: render brief version, advance cursor
```

## Key sequence - resume and verify

```mermaid
sequenceDiagram
    participant U as User
    participant A as API
    participant DB as Database
    participant T as Target model
    participant J as NLI model

    U->>A: GET /v1/projects/{id}/resume?vendor=claude
    A->>DB: current brief version + preamble
    A->>DB: insert injection(door, vendor, pack_text)
    A-->>U: pack text, injection id
    U->>T: pastes the pack, presses send
    U->>A: POST /v1/injections/{id}/checkpoint {mode: local}
    A->>DB: enqueue checkpoint job
    Note over A,DB: 6 probes: 3 included, 2 excluded, 1 uncovered
    A->>T: pack + one question, per probe
    T-->>A: answers
    A->>J: expected vs actual
    J-->>A: entails / neutral / contradicts -> 1 | 0.5 | 0
    A->>DB: checkpoint + probe results
    A->>DB: suggestions for every zero
    A-->>U: integrity, and what was lost
```

## Prompts

In `prompts/`, one file each, every one carrying a `version` header that is written to the
`model_calls` row on every call. A prompt change with no version bump makes every earlier
measurement unattributable, which is the quiet way a harness stops meaning anything.

There are fewer prompts than the original design had, because two of the jobs stopped being
prompted jobs. Adjudication and grading are NLI classifications now, so their behaviour is
governed by a model, a label mapping and a confidence floor - all versioned in configuration
and logged the same way. That is a smaller surface to get wrong, and it removes two places
where a model was being asked to produce a number and trusted to be calibrated.

| Prompt | Job |
| --- | --- |
| `extract.md` | Chunk plus existing titles to candidate entries, with a JSON grammar beside it. Three worked examples covering a decision, a code state and an open thread |
| `probe_gen.md` | An entry or a raw message to a question and a ground-truth answer, answerable only from that content. Templates keyed on `kind` are tried first; the model is the fallback |
| `preamble.md` | The resume-pack header, one variant per target vendor |

The extraction rules that live in `extract.md` are part of the design rather than prompt
wording: extract only what the user said or what was explicitly agreed, never the model's own
unadopted suggestions; one entry per atomic idea; prefer durable phrasing over stale
specifics; lineage is mandatory and must reference real ids in the chunk; titles are at most
80 characters and stable across rephrasings.

The first of those is the one that decides whether this works. A conversation with a chatbot
is mostly the chatbot talking, and an extractor that treats assistant output as fact will
fill the memory with suggestions the user read and rejected.

## Benchmark harness

`bench/`, outside the application, driving the real pipeline through the API rather than
reimplementing any of it. A harness that reimplements extraction measures the
reimplementation.

- `bench/datasets/` - synthetic long conversations, 8k to 60k tokens, across four
  archetypes: a coding session, research and writing, business planning, and a support
  handover. Each ships with a hand-written ground-truth fact list.
- `bench/methods/` - `herder` (the full loop), `naive_summary` (one "summarise this" prompt
  at the same budget), `truncate_tail` (the last N tokens, which is what people actually do).
- Metrics: recall of ground-truth facts, hallucination rate, compression ratio, and wall-clock
  per resume (the cost column, now that nothing is billed). Reported per archetype as well as combined, because a method that wins on code and
  loses on planning is a finding rather than an average.

`naive_summary` is the comparison that matters. It is what a reasonable person would build in
an afternoon, and if herder does not beat it at the same token budget then the entries, the
merging, the layering and the versioning are elaborate machinery around no advantage. The
harness is built to be able to return that answer.

## Security and privacy

- There are no provider secrets, because there is no provider. What secrets exist - a session
  signing key, the hashes of herder's own API keys - come from the environment and never from
  the repository. Conversations are never transmitted to a third party for processing; the
  only text that leaves the machine is a resume pack the user themselves pastes into a chat.
- API keys stored as SHA-256 hashes with a visible prefix, shown once at creation.
- Passwords with Argon2, if there is ever a second user. There is one now.
- Server logs carry ids, counts and timings, never message content.
- No third-party analytics anywhere in the web app.
- Rate limits on `/ingest` per key, and on every endpoint that can trigger inference. The
  scarce resource is CPU rather than money, but an unauthenticated endpoint that can queue an
  hour of work is still a way to take the machine down.
- `GET /me/export` and `DELETE /me` work before anyone other than the author has an account.
- The self-host path is `docker compose up`, and it is the primary path rather than a
  fallback. A memory of everything someone has ever said to a chatbot is exactly the kind of
  thing that should be able to run on their own machine.
