# codevscode - Architecture

Nothing here is built. Everything below is a proposal until 00-plan's settled table says
otherwise, and the stage 1 measurements may change the shape of the helper and the size of a
challenge.

## Components

```mermaid
flowchart LR
    subgraph B[Browser]
        WS[Workspace page]
        ED[Editor<br/>CodeMirror]
        PV[Preview<br/>sandboxed iframe]
        RT[App runtime<br/>worker + sql.js]
        LT[Local tests<br/>same worker]
        HR[Helper runtime<br/>WebGPU]
        CO[Coach rules]
    end
    subgraph S[Server - FastAPI]
        WEB[Pages and JSON API]
        AUTH[Email-link sign-in]
        CL[Client matcher<br/>sentence model]
        MT[Match service]
        SC[Scoring]
        Q[Judge queue<br/>jobs table]
        OB[Outbox worker]
    end
    subgraph D[Data]
        PG[(PostgreSQL)]
        HS[(Hidden store<br/>read-only volume)]
    end
    subgraph J[Judge]
        JW[Judge worker]
        BOX[Job container<br/>Node, no network]
    end
    subgraph O[Offline]
        NB[Training notebooks<br/>Colab, all model work]
        CV[Converter<br/>to browser format]
        HB[Harness]
        HF[(Public weights repo)]
    end
    WS --- ED & PV & HR & CO
    PV --- RT --- LT
    WS -->|HTTPS| WEB
    WEB --- AUTH & CL & MT
    MT --- SC & Q
    CL --- HS
    WEB --- PG
    Q --- PG
    JW -->|claims jobs| PG
    JW -->|starts| BOX
    HS -->|mounted read-only| BOX
    NB --> CV --> HB --> HF
    HF --> HR
    OB --- PG
```

| Component | Runs where | Job |
| --- | --- | --- |
| Workspace page | Browser | The one JavaScript-heavy page. Brief, question panel, helper chat, file editor, preview, local test results, clock. Everything else on the site is server-rendered |
| App runtime | Browser, a worker | Runs the player's app the same way the judge will: the request handler module and an in-memory SQLite (sql.js) in a worker; the preview iframe's requests are routed to it |
| Helper runtime | Browser | Loads the model weights once into the browser's cache and generates on WebGPU. WebLLM is the first choice, transformers.js the second; stage 1 picks |
| Coach | Browser | Rules over what the player has done so far. Practice mode only; the ranked workspace does not load it |
| Client matcher | Server | Embeds a question with a small sentence model and compares it with every hidden requirement's phrasings. Server-side so hidden material never ships |
| Match service | Server | Attempts, pairing, windows, findings, defences, the house |
| Judge queue and worker | Server | A jobs table and a worker process that runs each job in a fresh container |
| Scoring | Server | Pure functions from judged results to a score card. No model involved |
| Training, converter, harness | Offline | Colab notebooks, the browser-format conversion, and the harness that decides whether a model ships |

## The challenge

A challenge is a folder. The public half is safe to send to the browser; the hidden half
never leaves the server. The format is in 04-data-model; the shape:

| Part | Public | Written by |
| --- | --- | --- |
| Brief: a few sentences from the client | Yes | Author |
| Interface: the routes or functions the app must expose, with their shapes | Yes | Author |
| Starter files: an empty handler, a minimal front end, a schema stub | Yes | Author |
| Hidden requirements: each with a category, several phrasings of the question that unlocks it, the client's answer, and the tests that check it | No | Author |
| Reference app: a correct, secure, efficient answer | No | Author |
| Hidden tests: spec, security, efficiency and practicality tests, each tagged with a requirement and a category | No | Author |
| Planted bugs: patches against the reference that make the house app | No | Author |
| House findings: tests that catch common mistakes, filed against players' apps when the house is the opponent | No | Author |
| Defence questions with key points | No | Author, stage 9 |

The validator, run on every change: the reference passes every hidden test; each planted bug
fails at least one hidden test and only the ones it should; every hidden requirement has at
least one test and at least three phrasings; every house finding passes on the reference.

### The app shape

```
app.js       export async function handle(request, db) -> response
schema.sql   the tables the app needs, run into a fresh sql.js database
index.html   a small front end that calls the interface with fetch
```

`request` is a plain object - method, path, query, lower-case headers, the raw body text, and
`time`, the current time in milliseconds - and the response is `{ status, body }`. `db` is a
thin layer over sql.js with `all`, `get` and `run`. The same module runs in the browser worker
for the preview and in Node in the judge. It imports nothing (refused before loading), keeps
every piece of state in the database (it is loaded fresh for every test), and reads the time
from `request.time`, never `Date.now()`, so the tests control the clock - which is how "locked
for 15 minutes" gets tested in a millisecond. This gives real security items to get right -
SQL built from strings, a missing ownership check, passwords stored in plain text, user text
written into the page unescaped - without a real server per player.

### The shared runner (built, stage 0)

`runner/` is plain ES modules with no Node imports (a test enforces it), so one copy runs the
tests in the player's browser, in the validator, and in the judge's container. A test is
`{ id, category, requirement, title, run(t) }`, and `t` gives it:

| `t.` | What for |
| --- | --- |
| `request(method, path, { body, raw, token, headers })` | Calls the app; an uncaught error becomes a 500 with `crashed` saying why |
| `now()`, `advance(ms)` | The clock: it starts at 2026-01-01 and moves a second per request |
| `queries()`, `resetQueries()`, `queryLog()` | Every query the app made |
| `fullScans(minRows)` | Queries SQLite answered by reading a whole table of at least that many rows, from `EXPLAIN QUERY PLAN` |
| `inspect.storedText()` | Every value in every table, blobs decoded - for "no password is stored" |
| `equal`, `oneOf`, `ok` | Assertions whose messages a player can read |

Each test gets a fresh database from the app's schema and a freshly loaded module.

## The client and the ask phase

```mermaid
sequenceDiagram
    participant W as Workspace
    participant A as API
    participant M as Matcher
    participant D as Database
    W->>A: question text, attempt id
    A->>A: rate limit, length limit
    A->>M: embed question
    M-->>A: best requirement, similarity
    alt similarity >= the requirement's threshold
        A->>D: record question, requirement revealed
        A-->>W: the author's answer
    else below
        A->>D: record question, nothing revealed
        A-->>W: a neutral reply ("That's up to you.")
    end
```

- The sentence model is a small one (MiniLM class, 384 dimensions), local on the server, as
  in herder. Phrasings are embedded once when a challenge is loaded.
- One question can reveal one requirement. A question that matches two near-equally gets the
  stronger; this stops "tell me everything about security" from emptying the list.
- A revealed requirement stays revealed for the rest of the attempt, and its answer is added
  to what the helper is told.
- Measured at stage 3: for each challenge, the author labels 30 or more questions (which
  requirement, or none). Reported: recall on good questions, and false reveals on unrelated
  ones. A false reveal is the worse error, so the threshold leans strict.

## The helper

### What our own model means

There are three ways to have "our own" coding model, and they are not equally possible:

| Route | What it takes | What comes out |
| --- | --- | --- |
| Train from nothing | Billions of tokens of code, many GPU-days. A model small enough for free Colab sessions (around 100M parameters) takes tens of GPU-hours across many sessions | A model that completes plausible lines. It does not build a working app |
| Fine-tune an open-weights coding model | A 0.5B to 1.5B model, QLoRA on a free Colab T4, a few hours per run, on data we choose and build | A model that writes code the way this game needs: whole small files, the app shape, the interface, the checklist |
| Run an open-weights model unchanged | A download | The baseline. Stage 1 uses it, and the fine-tune must beat it |

The proposal is the second route for the helper that ships, with the first as an optional,
clearly labelled experiment so the README can show how far a from-scratch model gets. The
author has not decided; see 00-plan's open questions.

### Candidate base models

Checked again at stage 1 and stage 11, because licences and releases move. The first list:

| Model | Sizes worth trying | Licence to verify | Notes |
| --- | --- | --- | --- |
| Qwen2.5-Coder Instruct | 0.5B, 1.5B | Apache 2.0 at these sizes (the 3B is under a different research licence) | Prebuilt for WebLLM at 1.5B; strong for its size |
| Qwen3 | 0.6B, 1.7B | Apache 2.0 | General model with good code; check browser support |
| SmolLM2 Instruct | 360M, 1.7B | Apache 2.0 | Fully open training data, which suits the "ours" story |
| StarCoder2 | 3B | BigCode OpenRAIL-M | Code only, no chat tuning; may be too big for a browser |

Stage 1 records for each, on Colab: hidden tests passed on the sample challenge, download
size, and whether it produced valid JavaScript at all. Then, for the best one or two, in an
ordinary browser: does it load, time to first token, tokens per second, memory.

### Shipping the helper

What it takes to go from an open model to the helper in a player's browser. All of it runs on
Colab; nothing needs the author's own GPU.

```mermaid
flowchart LR
    B[Base model<br/>open weights] --> FT[1. QLoRA fine-tune<br/>Colab T4]
    FT --> AD[(Adapter<br/>tens of MB)]
    B --> MG[2. Merge]
    AD --> MG
    MG --> FULL[(Full model<br/>16-bit)]
    FULL --> CV[3. Quantise to 4-bit,<br/>convert for the browser]
    CV --> Q4[(Browser build<br/>shards + config)]
    Q4 --> HB[4. Harness on Colab<br/>same 4-bit build]
    HB -->|wins| PUB[5. Publish to a public<br/>weights repo, pinned]
    PUB --> GAME[6. Game config<br/>points at the pin]
    GAME --> P[Player's browser:<br/>download once, cache,<br/>run on WebGPU]
```

1. **Fine-tune.** The base model is loaded in 4-bit on a free T4 and a small LoRA adapter is
   trained on top, on the prepared data. Checkpoints go to Google Drive every few hundred
   steps, because a free Colab session can end without warning. At these sizes a run is
   hours, not days.
2. **Merge.** The adapter is folded into the base weights, giving a normal full model.
3. **Quantise and convert.** The full model is quantised to 4 bits and converted to the
   browser runtime's format: weight shards, a config with the chat template, and the
   tokenizer. For WebLLM a fine-tune of an architecture it already supports reuses the
   prebuilt WebGPU model library, so nothing has to be compiled - to be confirmed at stage 1
   by doing it with the base weights first. The fallback is an ONNX export for
   transformers.js. Rough sizes after 4-bit: a 0.5B model a few hundred MB, a 1.5B model
   around a gigabyte.
4. **Measure.** The same 4-bit build runs in the harness on Colab's GPU, against the base
   model converted the same way, on held-out challenges with several seeds. It ships if it
   passes more hidden tests, does not get meaningfully worse on the general JavaScript check,
   and is not bigger.
5. **Publish.** The browser build goes to a public model repo on Hugging Face, named as our
   own (`cvchelper-1.5b-v1`, or whatever size wins), with the base model's licence and a notice
   saying what it was fine-tuned from, and a model card carrying the data manifest and the
   harness numbers. Everywhere it is described - the game, the README, the resume - it is
   "cvchelper, fine-tuned from" the base, never just "our own LLM"; see 00-plan. The game pins an exact revision of that repo, so an upload can never
   change the helper under a running match.
6. **Switch.** A new `models` row; the game's config points at it; new attempts record its
   id. Rolling back is pointing the config at the previous row.

What the player sees: on the first visit the page says how big the helper is and starts
downloading it with a progress bar, while the brief and the ask phase are already playable.
Later visits load it from the browser's cache in seconds. The helper's answers stream in as
they are written.

Licence duties for an Apache 2.0 base: ship the licence, say it was modified, keep any notice
file, and do not use the base model's name in a way that suggests its makers endorse the game.

### How the helper is asked

Built at stage 1 as `helper/prompt.js` and `helper/reply.js`, shared JavaScript that the
workspace and the harness both call, so a model is measured on the prompt it will get. Each
turn the prompt is assembled from: a fixed system message (the helper's rules
and the player's name for it), the brief and the interface, the client answers revealed so
far, the current files in full, and the last few chat turns. A token budget trims the oldest
chat first, never the files.

Earlier helper replies are kept in history with their code replaced by "[wrote app.js]": the
files are sent whole every turn anyway. The helper answers with whole files in fenced blocks
whose first line names the file (`// file: app.js`); the parser also accepts a name in the
fence, on the line before, or a lone block of one language, because small models drift from
any format, and it never writes a file outside the challenge's list. A small model
keeps whole-file rewrites more reliably than diffs, and the files are small. The workspace
shows a diff of what changed before applying it, so the player reads what the helper did -
that is half the game.

The helper never sees the hidden tests, the reference app or the coach.

### The coach

Practice only. Rules, not a model. It watches the attempt and shows short nudges:

- During ask: categories with hidden requirements still unrevealed ("nothing asked about who
  can see what yet"). It names the category, never the requirement.
- During build: checklist reminders tied to the code ("this query is built from a string",
  "this response has no error case").
- Before submit: which checklist categories have no local test.
- During review: kinds of finding to try ("what happens with an empty body").

Ranked mode does not load the coach's code at all.

## The judge

```mermaid
sequenceDiagram
    participant A as API
    participant D as jobs table
    participant W as Judge worker
    participant C as Job container
    A->>D: insert job (queued)
    W->>D: claim one (SELECT ... FOR UPDATE SKIP LOCKED), locked_at = now
    W->>C: start: app files + test files, hidden tests mounted read-only
    C-->>W: JSON results, or killed by a limit
    W->>D: results, status done
    Note over W,D: reaper: running with locked_at older than the limit -> queued again, attempts + 1
    Note over W,D: attempts >= 3 -> failed, shown to the author
```

The container, per job:

- Node, the test runner, sql.js, and nothing else in the image.
- `--network none`, read-only root, a small writable temp directory, a non-root user, no
  added capabilities, the default seccomp profile.
- Limits: CPU time per test and per job, memory, process count, output size. A test that hits
  a limit fails; the job does not.
- Hidden tests come from the hidden store, mounted read-only into that job only. The database
  is on a network the container is not on.
- One job per container, thrown away after.

Kinds of job: judge a submission (all hidden tests), check a finding (the finding's test
against the reference and against the target), judge a fix (the finding's test plus all
hidden tests against the fixed files), and the harness's runs.

Efficiency tests do not use a stopwatch. They measure what the app asks of the database: how
many queries a request takes (one per note is the classic mistake), and whether SQLite had to
read a whole table to answer, from its own query plan. Both come out the same on every machine
and every run, so an efficiency result is never noise - the stopwatch comparison against the
reference first proposed here was dropped at stage 0 for that reason. Security tests are
exploits written as tests (injection, reading another user's data, plain-text or unsalted
passwords in the database, guessable tokens) plus static rules over the source.

## Findings and defence

```mermaid
stateDiagram-v2
    [*] --> filed
    filed --> invalid: reference fails the test, or target passes it, or it is not deterministic
    filed --> valid: reference passes and target fails, twice
    valid --> fixed: defender's fix passes it and every hidden test still passes
    valid --> conceded: defender concedes, or the window closes
    fixed --> [*]
    conceded --> [*]
    invalid --> [*]
```

- A finding is a category, a one-line claim, and a test written against the interface.
- Checked when filed, so the reviewer knows straight away. An invalid finding costs nothing
  but time.
- Per match, only the first three valid findings in each category score, so twenty variations
  of one bug do not pay twenty times.
- A fix that breaks a hidden test is rejected and the finding stays open.

## Scoring

A proposal to be tuned once people play. Out of 1000 per player per match:

| Part | Points | From |
| --- | --- | --- |
| Correctness | 250 | Share of spec tests passed |
| Security | 200 | Share of security tests passed |
| Efficiency | 100 | Share of efficiency tests passed |
| Practicality | 100 | Share of practicality tests passed: error cases, empty states, input limits, basic accessibility |
| Questions | 50 | Share of hidden requirements revealed. The bigger reward is indirect: knowing what will be tested |
| Review | 150 | Valid findings against the opponent, weighted by category |
| Defence | 100 | Share of valid findings against you that you fixed |
| Time | 50 | Share of the time limit left at submission |

The score card lists every line with the test, question or finding behind it. Pasted
characters are shown on the card without changing the score; typing by hand is normal play
and is not. See 00-plan's open questions.

## The training pipeline and the harness

```mermaid
flowchart LR
    DS[(Public datasets<br/>in reserve)] -.->|only if needed| PREP[Prepare<br/>filter, dedupe, format]
    CH[(Our challenges<br/>train split only)] --> PREP
    TE[Teacher: bigger open<br/>model, run on Colab] --> PREP
    PREP --> TRAIN[QLoRA fine-tune<br/>Colab notebook]
    TRAIN --> MERGE[Merge adapter]
    MERGE --> CONV[Convert and quantise<br/>for the browser]
    CONV --> HB[Harness]
    BASE[Base model,<br/>same conversion] --> HB
    HO[(Held-out challenges)] --> HB
    HB -->|wins| PUB[Publish weights<br/>record a models row]
    HB -->|loses| KEEP[Keep the base.<br/>Write it up]
```

- **Own data first.** The first fine-tune is trained only on our challenges and on
  conversations a bigger open-weights teacher generates on them, kept only when the resulting
  app passes the hidden tests. Public datasets wait in reserve (04-data-model).
- **Challenge split.** Challenges are split once into train and held-out. A held-out
  challenge is never in any training data, its scripted conversations included. The harness
  only reports held-out numbers.
- **The harness.** For each held-out challenge, a scripted conversation (fixed player
  messages, written by the author) is replayed through the model; the files it ends with go
  to the judge. Reported per model: spec, security, efficiency and practicality tests passed;
  valid JavaScript rate; tokens per second in the browser; download size. A general check runs
  alongside on the JavaScript translation of HumanEval and MBPP (MultiPL-E) so the fine-tune
  cannot win here by forgetting how to code.
- **Same conversion for both.** The base model goes through our converter too, so the
  comparison is between two models in the same format, not a prebuilt one against ours.
- **Noise.** Generation is sampled; each scripted conversation runs several times with fixed
  seeds and the harness reports the spread. herder's lesson: small deltas need repeated runs.

Training data is listed in 04-data-model with the licence of each source.
