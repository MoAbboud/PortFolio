# herder - notes

Kept by hand. What was tried, what the numbers did, what was surprising.

Tooling may append the facts - a run happened, a number moved, something broke - because a
fact recorded late is usually a fact lost. The judgement stays mine: what it meant, whether
it was expected, what to do about it. That half is the record no tool can produce and it is
where the credibility lives. It becomes the README's most useful section.

This file is not the handoff log. That is `requirements/06-context.md`, it is gitignored,
and it holds the reasoning. This one holds the measurements.

The first numbers that belong here, in order:

- **Stage 2: how long one real chunk takes**, split into prompt processing and generation,
  on this machine, with no GPU. The project's first gate, and the thing that decides the
  chunk size and the model size.
- **Stage 2: the same chunk through `heuristic` and through `local`**, side by side.
- **Stage 4: entry count against source tokens, for all ten conversations.** A linear
  relationship means the merge step is not working and the compaction claim has failed -
  and it fails silently, because the brief still renders, it just drops more every time.
- **Stage 9: the baseline**, recorded before anything is tuned.


---

## 2026-09-08 - stage 2, the heuristic extractor measured

A 300-turn synthetic transcript, generated for timing rather than for quality. Not the stage
4 corpus.

    source              21,926 tokens across 600 turns
    chunking            4 chunks at a 6000-token target
                        12 chunks at 2000
                        23 chunks at 1000
    heuristic time      21 ms for all four chunks
    throughput          ~1M source tokens/second
    entries produced    36  (1.6 per 1,000 source tokens)

Two things worth keeping from this.

**The heuristic is free.** 21 ms over 22k tokens means the deployable extractor costs nothing
at all, which matters because it is probably what a free hosting tier will serve. Whatever the
local model turns out to cost, this is the floor it is being compared against.

**36 entries from 22k tokens is roughly the right order.** At perhaps 30 tokens each that is
about 1,100 tokens of brief from 22k of source - a compression ratio near 20x, which is the
number the whole project is aimed at. It says nothing yet about whether those 36 entries are
the *right* 36; that is what stage 4's failure list and stage 9's recall measurement are for.

**A generator that repeats itself measures nothing.** The first attempt drew turns randomly
from a pool of fifteen lines, and 217 of 240 turns were rejected at ingest as duplicates by
the content hash. Ingest was working exactly as designed and the benchmark was quietly
measuring a conversation a tenth of the size it thought. Every turn in a generated transcript
has to be unique or the numbers are fiction.

### Still outstanding

**The number stage 2 exists for has not been taken.** How long one chunk takes through the
local model on this machine, split into prompt processing and generation. It needs Ollama
installed and a model pulled:

    ollama pull qwen2.5:3b
    python -m herder extract --project default --extractor local --max-chunks 1
    python -m herder compare --project default --max-chunks 1

Prompt processing is expected to dominate on a CPU. If it does, chunk size is the biggest
lever available on how long a derive takes, and the 4/12/23 chunk counts above are what that
lever looks like on this transcript.


## 2026-09-10 - stage 2 closed: the local model measured, and the number is fine

Ollama installed, `qwen2.5:3b` (Q4_K_M, 3.1B params, 32k context) pulled. Two runs over the
same 4-message, 36-token chunk from the default project.

    FIRST CALL (cold)                 SECOND CALL (warm)
    wall clock     125.6 s            wall clock       6.2 s
    prompt eval      0.8 s            prompt eval      1.0 s
    generation       4.0 s            generation       2.8 s
    tokens        1606 in, 316 out

### The finding that matters: model load dwarfs inference

4.8 seconds of actual compute inside 125.6 seconds of wall clock. The other 121 seconds is
Ollama reading 1.9 GB off disk into RAM. Warm, the same work takes 6.2 seconds - **twenty
times faster for an identical result.**

Ollama unloads an idle model after 5 minutes by default. A derive running less often than
that would pay 121 seconds to do 5 seconds of work, every time. Fixed by sending
`keep_alive: 30m` on every call, and `load_duration` is now captured as its own column
rather than inferred from a gap - a cost that big should be measured, not deduced.

### Throughput, and what it means for chunk size

    prefill      ~1,600-2,000 tokens/second
    generation   ~80-113 tokens/second

**The instruction overhead is 1,570 tokens per call.** 1,606 input tokens went in for a
36-token chunk: the system prompt with its three worked examples is ~1,400 tokens and the
rendered message ids add the rest. That overhead is paid once per chunk regardless of chunk
size, which settles the chunk-size question in one direction:

    chunk size    overhead as a share of prefill
    36               98%
    2,000            44%
    6,000            21%

Extrapolating to a real 6,000-token chunk: ~7,400 prefill tokens at 1,600/s is about 4.6 s,
plus perhaps 1,500-2,500 output tokens at 80/s for 19-31 s, so **25-35 seconds per chunk
warm**. A 60k-token conversation is ten chunks, so **four to six minutes**. Derivation is a
background job nothing waits on, so that is comfortably acceptable - the fear that a derive
would take an hour is dead.

Marked as an extrapolation, not a measurement. The real 6,000-token figure comes at stage 4.

### First quality comparison, and the local model wins on the axis that matters

Same chunk, both extractors:

    heuristic  0.0s   [decision   0.60] we are using Postgres, not SQLite, in production
                      [constraint 0.62] and amounts are always Decimal, never float

    local      6.2s   [decision   0.95] Postgres in production, SQLite only for local dev
                      [constraint 0.90] Decimal for amounts, never float

Both found the same two things. The difference is in the titles, and it is not cosmetic.

The heuristic emits the source sentence verbatim - including the leading "and" on a fragment.
The model **rewrote** both into durable normalised form. Titles are what the merge step
matches on, so a title that changes with phrasing is a title that records the same idea twice.
The prompt asks for exactly this ("write the title so that the same idea, phrased differently
later, would produce the same title") and the model did it while the rules cannot.

Confidence differs too, and honestly: 0.95 and 0.90 are the model's own judgement, while 0.60
and 0.62 are constants from the rule table. The heuristic's confidence carries no information.

Against that, the heuristic is free and the model costs 6 seconds warm - and the heuristic is
what a free hosting tier will serve.

**This is an anecdote, not a measurement.** 36 source tokens and two entries. It points the
way stage 4 and stage 9 will have to confirm.

### Heuristic weaknesses already visible on a longer transcript

Run over a 9-turn, 338-token transcript of this project's own design decisions, the
heuristic produced 8 candidates including two clear mistakes, both worth fixing at stage 4
rather than now:

- **"I don't want that either"** recorded as a constraint. It matched "don't". It is a
  rejection with no content in it - a useless entry, and exactly the kind of noise that
  fills a brief with nothing.
- **"I work on a Windows machine and test everything from PowerShell"** recorded as a
  constraint rather than `identity`, because "has to" later in the sentence matched the
  obligation rule before the identity rule was reached.

Both are priority-ordering problems, which is the same class as the "still need to" fix
earlier. The local model got neither wrong.


## 2026-09-10 - the fix pass, and a variance finding that undercuts yesterday's extrapolation

Three fixes before starting stage 3, all about the instrument rather than the product.

### The timing split is now stored, not just printed

`model_calls` had `latency_ms` and nothing else, so the load/prompt/generation breakdown -
the thing that caught a 20x measurement error hours earlier - was printed to a terminal and
thrown away. Migration `0002` adds `load_ms`, `prompt_ms`, `generation_ms`, all nullable,
because the heuristic does no inference and null there means "not applicable" rather than
"zero". Verified against the database:

    impl         total    load  prompt     gen     in   out
    local        12163    4093    4736    3319   1623   267
    local       125568       -       -       -   1606   316      <- written before the fix
    heuristic        6       -       -       -   5971     0

The second row is the cold 125-second call from earlier, and it will never be able to say
where its time went. That is exactly the loss this fix prevents from happening again.

### The variance is large, and it makes the earlier extrapolation soft

Same 36-token chunk, three runs, prefill of about 1,600 tokens each time:

    run 1 (cold)    prompt eval 0.8 s
    run 2 (warm)    prompt eval 1.0 s
    run 3           prompt eval 4.7 s   and 4.1 s of model load

**Prefill throughput therefore ranges from about 350 to 2,000 tokens/second on the same
input** - a spread of nearly 6x. Yesterday's extrapolation of 25-35 seconds for a
6,000-token chunk used the fast end of that range. At the slow end the same chunk is closer
to two minutes, and a 60k-token conversation is twenty minutes rather than five.

Both are acceptable for a background job, so the conclusion does not change. What changes is
how much weight the number can carry: **it is one machine, one chunk, three runs, and it
varies by 6x.** Anything quoted from it in a README would be dishonest. The real figure needs
stage 4's ten conversations and repeated runs, and the variance needs reporting beside the
mean - which is the same lesson `mailman` learned when a variance table turned out to outrank
the headline result it was supposed to support.

Also worth noting: run 3 paid 4.1 s of load despite `keep_alive: 30m` being in the request,
because the gap since the previous call exceeded it. `keep_alive` prevents the eviction it
can prevent; it does not make the first call of a session free.

### Two heuristic bugs fixed, both the same mistake

Both came from reading real output rather than from reasoning, and both were a generic
marker sitting above a specific one in the priority order:

- **"I don't want that either"** became a `constraint` on the strength of "don't". It is now
  suppressed by a narrow guard on rejections whose object is a bare pronoun. The reasoning
  is not that it is short - it is that "that" refers to something in the *assistant* turn,
  which this extractor deliberately never reads, so the entry is unresolvable by
  construction rather than merely thin. "I don't want the Redis queue anywhere near
  production" still extracts, because it names what it rejects.
- **"I work on a Windows machine ... so every stage has to be checkable there"** became a
  `constraint` because of "has to". `identity` and `preference` now sit above `constraint`,
  on the principle that a first-person self-description is a much more specific signal than
  a modal verb. It matters beyond neatness: identity belongs in the `stable` layer, and
  filing it as a project constraint puts a durable fact about the user somewhere it expires.

Verified on the real extractor:

    nothing (correct)      <- I don't want that either. The entries are the summary.
    identity/stable        <- I work on a Windows machine and test everything from PowerShell...
    constraint/project     <- I don't want the Redis queue anywhere near production.
    constraint/project     <- Amounts must never be floats anywhere in this system.
    open_thread/session    <- We still need to pick the confidence threshold before shipping.

### LocalExtractor now has tests

There were none. 18 of them now, against a mocked HTTP transport with no Ollama and no
model: `keep_alive` is in the request body, the JSON schema is sent as the decoding format,
temperature is zero, the nanosecond durations are parsed into the three millisecond fields, a
timeout and an HTTP error each come back as a failed outcome rather than an exception, and
output that does not validate keeps its raw text.

The `keep_alive` one is the point. That fix came out of a measurement and had nothing
guarding it, so deleting it would have restored a 20x regression with the suite still green.

165 tests pass.


## 2026-09-10 - stage 3: the loop closes, and two measurements that changed the design

221 tests pass. A transcript goes in and a rendered, budgeted, lineage-backed brief comes
out. Two of the numbers the specification carried turned out to be wrong when measured, and
both were wrong in the direction that fails silently.

### Finding 1: the similarity threshold of 0.86 would have broken the merge step entirely

Eleven labelled pairs against `all-minilm`, cosine similarity:

    want   case                             cosine
    merge  refinement                        0.858
    merge  same claim, reworded              0.808
    merge  same claim, synonyms              0.657
    merge  reversal                          0.656
    keep   same topic, different claim       0.548
    merge  correction in situ                0.536
    keep   same tech, different claim        0.420
    keep   both about testing                0.207
    merge  terse vs explicit                 0.179
    keep   unrelated                         0.077
    keep   unrelated 2                      -0.078

At 0.86 only one pair in eleven reaches adjudication. "We are using Postgres in production"
against "Production runs on Postgres" scores **0.808 and would never have been merged** - so
the memory would have grown linearly while the brief kept rendering perfectly. That is
exactly the failure the plan flagged as having no error message, and it happened on the very
first real run: five candidates, zero merged.

The cause is that **0.86 was calibrated for a 1536-dimension model.** The embedding model
changed and the scale changed with it, and a number carried across without re-measuring was
simply wrong.

**The second finding is more interesting: there is no clean threshold at all.** The classes
overlap. "No Redis" against "we will not introduce a message broker" is the same claim and
scores 0.179, *below* an unrelated-topic pair at 0.548. Separation is negative.

That reframes what the threshold is for. The costs are asymmetric:

- a false positive is one wasted NLI call that returns neutral and keeps both entries;
- a false negative is a duplicate entry that lives forever.

So similarity is a **recall** filter whose job is keeping cost sub-quadratic, and NLI is
what actually decides. Set to **0.50**, which catches five of six merge cases and admits one
harmless keep case. Provisional until stage 4 calibrates it on ten real conversations, and
the short-entry miss is a real limitation: two-word entries do not embed well enough to
place.

### Finding 2: superseding on a one-sided contradiction would retire good entries on noise

Measured against `cross-encoder/nli-deberta-v3-base`:

    genuine reversal   "We no longer use Postgres" / "We use Postgres"
                       contradiction 1.00  <->  contradiction 1.00
    value changed      "budget is 5000" / "budget is 3000"
                       contradiction 1.00  <->  contradiction 1.00
    flat negation      "We will not use Redis" / "We will use Redis"
                       contradiction 1.00  <->  contradiction 1.00
    UNRELATED          "Amounts are always Decimal" / "parser lives in transcript.py"
                       neutral 0.99        <->  contradiction 1.00

**Genuine contradictions are symmetric; spurious ones are one-sided.** The original rule
superseded on a contradiction in either direction, which would have retired a perfectly good
entry on an artefact - silently, with nothing to show it had happened. Supersede now requires
contradiction in both directions, which separated all eight pairs tested.

### What the loop actually does

A 10-turn transcript, then a second 6-turn one into the same project:

    run 1   10 messages, 114 tokens  ->  5 candidates, 5 created,  brief v1, 312 tokens
    run 2    6 messages,  60 tokens  ->  2 candidates, 1 created, 1 UPDATED, brief v2, 300 tokens

The update is the interesting half. "Money values are always Decimal, never float" merged
into the earlier "Amounts must never be floats anywhere in this system" as revision 2, with
the earlier wording preserved behind it - which is what makes an old probe still gradeable.

Compression reads 0.4x and 0.2x, which looks alarming and is not: on a 114-token conversation
the session tail alone is the whole conversation verbatim, and the tail reserve is 750 tokens
of a 3000 budget. Compression only means anything once the source exceeds the budget. Stage 4
is the first place it will.

### The finding that matters most: BOTH extractors missed a reversal

The second transcript contained "Change of plan on one thing - we are switching from Postgres
to MySQL after all." Neither extractor caught it.

- The **heuristic** missed it because its pattern is `switching to` and the text says
  "switching *from* Postgres *to* MySQL".
- The **local model** missed it too, and did something worse: it extracted "Production runs
  on Postgres" from the turn immediately before, and set `supersedes_title` on it. So the
  brief now asserts Postgres more confidently, one turn after the user reversed it.

**A memory system that misses "we changed our mind" is worse than one that remembers
nothing**, because it serves the stale decision with confidence. This is the single most
important thing for stage 4's failure list, and it is a prompt problem before it is a model
problem - `extract.md` says a great deal about not extracting the assistant's suggestions and
nothing at all about reversals.

Worth noting what the local model did get right, since it is the same comparison: it produced
`Production runs on Postgres` and `Money values are always Decimal, never float` as
normalised titles where the heuristic emitted raw sentence fragments, and it used
`supersedes_title`, which the heuristic cannot do at all.

### Smaller things

- **`NULLS LAST DESC` is invalid SQL.** `.nulls_last().desc()` renders it that way;
  `.desc().nulls_last()` is correct. Caught on the first real derive.
- **Ageing and promotion were skipped when nothing new had arrived**, because the early
  return only wrote the tail and re-rendered. Staleness is a function of elapsed time, so a
  project that has gone quiet is precisely the one whose session entries are due to be
  archived. Caught by a test, and it would have been very hard to notice in production.
- The NLI model reads its own `id2label` rather than assuming `[contradiction, entailment,
  neutral]`. A different checkpoint with another order would have inverted every merge
  verdict with no error anywhere.
- Embeddings come from Ollama (`all-minilm`, 384 dimensions) rather than
  `sentence-transformers` in-process. Same model, same width, one less inference stack in the
  worker. `sentence-transformers` is still installed, for the NLI cross-encoder.


## 2026-09-11 - the bug-fix run, verified against the database

**233 tests pass, nothing skipped.** The three fixes that could not be checked while Docker
was down are now checked, and one of them turned out to be worth more than the test that
proved it.

### The missing embed job, measured on real data

Entries carrying no vector, before the fix ran anywhere:

    bench-heuristic-3      36 of 36 have no vector
    bench-heuristic        20 of 20
    default                 6 of  6
    loop-demo               0 of  6

**62 of 68 entries, and the pattern is exact**: every one was written by the stage 2
`extract` service, which has no embedder. `loop-demo` was built by a stage 3 derive and has
none. All 62 were invisible to `_find_matches`, so they could never be merged, updated,
superseded - or matched as removed.

Deriving `bench-heuristic-3` after the fix:

    source        600 messages, 21,926 tokens
    candidates    36
    created        0
    duplicate     36        <- 36 of 36 merged away
    brief         v1, 2,069 tokens

**Before the fix that run would have created 36 new entries and left 72.** The existing
thirty-six were invisible, so every candidate would have looked new. That is exactly the
failure the plan describes as having no error message - the brief still renders, it just
carries everything twice - and this is what it looks like when it is caught.

### The first compression number that means anything

    21,926 source tokens  ->  2,069 token brief  =  10.6x

Every earlier figure was measured on a conversation smaller than the budget, where the
verbatim session tail alone is the whole source and the ratio is meaningless. This one is in
the regime the project actually cares about, and it is the regime invariant 7 now describes.

**10.6x against a target of 20x**, and the honest reading is that this says very little yet:
it is the heuristic extractor, whose entries are verbatim source sentences and therefore
about as long as prose can be. The local model produced normalised titles a third of the
length on the same material at stage 2. Stage 4 measures both properly. What this number does
establish is that the machinery compresses at all, which before today it provably did not.
