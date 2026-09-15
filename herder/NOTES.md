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


## 2026-09-12 - stage 4: ten conversations, and the list of everywhere it went wrong

The corpus: ten generated transcripts, four archetypes, **113,701 tokens**, 8,343 to 14,993
each, every turn unique within its transcript. `corpus/generate.py` plants 323 known-hard
cases and records where in `manifest.json` - not ground truth, which is stage 9's job, but a
list of specific things to go and check.

    rejection 76   constraint 71   code_block 69   restatement 37
    reversal 34    empty_rejection 33   long_turn 3

### The stop-and-fix check: PASSED

Entry count against source tokens, heuristic, all ten:

    correlation r        +0.27        (near +1 would mean linear growth, and a dead claim)
    entries per 1k       1.11 -> 0.61  (falls as conversations get longer, which is the point)
    8,099 tokens         9 entries
    14,760 tokens        9 entries

The memory does not grow with the conversation. **Overall compression 9.0x** across 111,011
source tokens, range 6.7x to 12.2x.

### But it passes by the wrong mechanism, and that is the headline finding

    96 created, 24 merged (duplicate + update), 156 SUPERSEDED

Supersede retires the earlier entry. Unlike duplicate it does **not** union lineage, so the
flat entry count was being achieved by destroying 156 entries rather than merging them.

Measured against `cross-encoder/nli-deberta-v3-base`:

    same rule, different INCIDENTAL number     contradiction 1.00/1.00  -> supersede  WRONG
    same claim, numbers stripped               entailment              -> duplicate   right
    budget 3000 vs 5000 (MATERIAL number)      contradiction 1.00/1.00 -> supersede   right

**The NLI model cannot distinguish an incidental number from a material one.** "item 15"
against "item 23" reads exactly like "3000 tokens" against "5000 tokens". Any restatement
carrying a differing date, step, ticket id or line number supersedes instead of merging.

The corpus exaggerates this - real conversations do not say "a rule for item 15" - but the
mechanism is real and general. **This is the top item for stage 10**, and it needs the
harness: any fix is a guess until recall can be measured either side of it.

What was fixed now, because it is data loss rather than tuning:

- **A supersede carries the old entry's lineage forward.** A reversal changes what is true;
  it does not unsay the messages that established the earlier claim. Without this the new
  entry cited only the turn that reversed the decision and "why did we ever think that"
  became unanswerable - 156 entries' worth of evidence was going on the floor.
- **`seen_in_conversations` carries forward too.** Resetting it to 1 on every supersede meant
  a preference restated across five conversations never reached the promotion threshold: it
  was superseded back to one each time.

### The bug that made the local extractor look merely bad

**Ollama gives the prompt only half of `num_ctx`, and says nothing.** Measured:

    num_ctx requested  4096  ->  prompt_eval_count  2050
    num_ctx requested  8192  ->  prompt_eval_count  4098
    num_ctx requested 16384  ->  prompt_eval_count  8194

At the old default of 8192 the usable prompt was 4,098 tokens, against a 6000-token chunk
plus ~1,570 of instructions and ~1,000 of message ids. **More than half of every chunk was
discarded before the model saw it**, with no error anywhere. The only symptom was an
extractor that looked poor: 3 candidates from a transcript where the heuristic found 31.

Two fixes, and the second matters more than the first:

1. `num_ctx` raised to 24576, sized at 2x the largest prompt.
2. **The extractor now compares what it sent against `prompt_eval_count` and fails the chunk
   loudly if the model saw materially less.** The derive cursor does not advance on a failed
   chunk, so the work is retried once the setting is fixed rather than silently lost. A brief
   built on half a conversation is worse than no brief, because nothing about it says so.

Verified after: the same chunk now shows 11,231 prompt tokens seen, up from 4,098.

### Chunk size: the plan's assumption was wrong

The plan expected bigger chunks to pay the instruction overhead fewer times but give a small
model more context than it handles well. Measured on `03-research-notes`:

    target   chunks  msgs/chunk  candidates  per 1k tokens  sec/chunk
     1,500        3          25           9          2.01        ~20
     3,000        3          49          26          2.94        ~102
     6,000        2          73          33          3.73         ~99
    heuristic     2           -          19          2.15          ~0

**Bigger chunks yield more per token, not less**, and per-chunk time is roughly flat, so
fewer large chunks wins on both axes. 6000 is the right end of the range tested and the open
question should now read "is 6000 large enough" rather than "is it too large".

Two caveats, and they matter: yield is not quality - more candidates could be more noise, and
only stage 9's recall measurement can say - and the between-transcript variance is large
(the same 6000 target gave 4 candidates on one transcript and 33 on another).

**Local beats the heuristic on yield: 3.73 against 2.15 candidates per 1,000 source tokens.**

### The planted cases

What the heuristic got right, across all ten transcripts:

- **0 assistant proposals leaked into memory** out of 76 planted. The rule that outranks
  every other rule - only what the user said - holds completely.
- **0 code fragments** became entries, out of 69 planted code blocks.

What it got wrong:

- **13 content-free rejections became entries.** Three phrasings, all now fixed and tested:
  "I would rather not, thanks" matched the preference rule and became a stated preference
  with nothing preferred in it; "Not for item 69 - that is a service I would have to
  explain in an interview" became a constraint whose subject is "that", pointing at the
  assistant turn this extractor deliberately never reads. After the fix: 0 leaks out of 10
  phrasings, 0 losses out of 7 sentences that must still extract.
- **A real constraint missed entirely**: "No broker - the jobs table is enough for what we
  need." No cue matches. Left alone deliberately - adding `^no \w+` patterns is a recall
  guess, and recall guesses belong at stage 10 with a harness, not here.

### A bug in ingest, found only by running the corpus twice

`unique (vendor, vendor_conv_id)` is global, and a paste was content-addressed on the text
alone. So **one transcript could exist in exactly one project, ever.** Pasting the same text
into a second project silently resolved to the conversation in the first, the `project_id`
argument was ignored without a word, and the second project reported every turn as a
duplicate and came back empty.

Found because the corpus run pastes the same ten transcripts into two sets of projects to
compare extractors, and got ten empty projects and a derive that did nothing. Fixed by
scoping the paste reference to the project; re-pasting into the *same* project is still
idempotent, which is the property that mattered.

### The shortlist for stage 10

1. **False supersede on incidental numbers.** The largest measured defect. Needs the harness.
2. **Chunk size above 6000.** The trend is clear and untested past 6000.
3. Heuristic recall on refusal-shaped constraints ("No broker - ...").
4. Whether `local`'s extra yield is signal or noise - stage 9 answers this, not stage 4.

### Not done

**The full `local` run over all ten transcripts.** The comparison above is one transcript.
The first attempt produced nothing because of the cross-project paste bug; the second was
stopped once the `num_ctx` truncation was found, because it was measuring a model seeing half
its input. Both bugs are fixed and the run is worth repeating - roughly 100 seconds a chunk,
about 20 chunks, so half an hour - but it has not been done and no number here should be read
as if it had.

## 2026-09-12 - stage 5: the pack, and two render bugs the first real pack exposed

268 tests pass. A brief now leaves the system as something a person can paste into a chat, and
every serve writes the `injections` row a checkpoint will hang off at stage 6.

### Looking at one real pack found two defects

Both had been in the renderer since stage 3 and neither was visible until a brief was laid out
for a human to read. That is the argument for stage 5 sitting before the measurement stages
rather than after them.

**An entry containing a newline broke out of its own list item.** A merged entry carries its
old wording on a second paragraph, and the brief is a bullet list, so it rendered as an
orphaned block that a model reading the pack cannot attribute to anything:

    - [constraint] Money values are always Decimal - Money values are always Decimal ...

    Previously: Amounts must never be floats anywhere in this system.
    - [decision] ...

Entries are flattened to one line now. An entry is a claim and a claim fits on a line;
anything that genuinely needs its shape kept is in the lineage, which holds the raw message
untouched.

**The title and the text were both printed when the title was only the opening of the text.**
The heuristic's titles are truncations of the sentence they came from, so nearly every entry
said everything twice and spent roughly double the tokens doing it. Re-rendering after the
fix:

    loop-demo                 300 -> 219 tokens   (-27%)
    s4-h-09-coding-refactor  1269 -> 1075 tokens  (-15%)

The local model writes a normalised title that is not a prefix of its text, and that case
still prints both halves - which is the case worth having two halves for.

**Stage 4's 9.0x compression figure predates this fix** and is therefore understated. It has
not been re-measured and the stage 4 entry above has not been edited to pretend otherwise.

### Decisions in the serve path

- **A budget override renders a fresh version rather than truncating the current one.**
  Truncating the stored text would produce a pack whose content matches no version in the
  database, and a stage 6 checkpoint against it would be scoring a text that was never sent.
  Rendering costs no inference, so the honest option is also the cheap one. The override
  applies to that serve only - asking for a smaller pack once does not quietly shrink every
  future derive.
- **Integrity is left out of the tag until it has been measured.** Printing `integrity=0.00`
  for a project that has never been checkpointed would be a lie with a number on it, and the
  number is the part people believe. Stage 6 fills it in.
- **One preamble file, one section per vendor**, falling back to `default` for anything
  unknown. Two lines carry most of the weight and appear in every variant: that if the block
  conflicts with what the user says now, the user wins - stale context is what makes a memory
  system worse than no memory system; and that the model must not summarise the block back -
  without it the first reply is spent reciting the context, which also puts it on the screen
  in front of whoever is standing there. A test asserts both survive in all four variants.
- **Nothing is sent anywhere.** The pack goes to stdout or to the caller and stops.

### Still to do in this stage, and it is not mine to do

The pack has not been tried in a real chatbot. That is the last stage 5 task and it needs a
person with a browser:

    python -m herder resume --project loop-demo --vendor claude --quiet | clip

Paste it into Claude and into ChatGPT, ask something that only the carried context can answer,
and write down what each one did. The line most likely to be disobeyed, and the easiest to
check, is the instruction not to summarise the block back.

## 2026-09-13 - stage 5 review: the override did not stay in its serve

Facts only; what they mean is the author's to add. 275 tests pass.

- **The budget override leaked.** Its fresh version became the highest version, and a plain
  serve took the highest, so after one `resume --budget 150` every later pack was 150 tokens.
  The claim above that the override "applies to that serve only" was not true when written.
  A serve now reuses the highest version only if it was rendered at the budget asked for,
  and renders otherwise.
- An override on a never-derived project rendered and recorded an empty pack instead of
  saying to derive. The override was also written onto the project row inside the
  transaction and restored before commit, rather than passed to the render.
- **The tail had the newline bug** fixed for entries above: its turns sat at column 0 under
  the `- [tail]` bullet. They are indented now, not flattened, so who said what survives. Its
  heading and bullet were not counted against the tail reserve, so a full brief could run
  over budget by that overhead.
- Two renders racing for one project could take the same version number; the project row is
  now locked before `max + 1`. Not covered by a test - the suite runs on one connection.

Worth noticing when the pack is tried by hand: `loop-demo`'s brief still says production is
Postgres "and always will" while its own tail says the user switched to MySQL - the stage 3
missed reversal, sitting inside the pack. "What database does production use?" tests both it
and the "user wins" line at once.

**Later the same day - the override is stored but never the brief.** The first fix re-rendered
on the plain serve after an override, which wrote a copy of the brief as a new version. Now
only a render at the project's own budget moves `current_brief_version_id`, and `GET /brief`,
`herder brief`, the entries endpoint and plain serves all read that pointer. Checked on
`loop-demo` in a rolled-back transaction: render v4, override v5, repeated override reused v5,
plain serve v4 with nothing re-rendered. Invariant 5 reworded. 278 tests pass. Added `herder
render`, because a brief rendered before the tail fix keeps the old layout until re-rendered.

## 2026-09-13 - the pack tried by hand: Claude

Facts only; the reading of them is the author's to add.

- **Where:** claude.ai in the browser, a new chat. Pack `loop-demo` v4, vendor `claude`, 353
  tokens, sent alone as the first message. (Whether the chat was incognito: not yet recorded.)
- **Reply to the pack alone:** "What would you like to work on?" No summary, no acknowledgement
  of the block. The collapsed thinking label read "Spotting a conflict between stated database
  constraints" - it noticed the contradiction but did not mention it in the reply.
- **"What database does production use?"** -> "MySQL — that was the switch you made from
  Postgres." One line, no preamble, which also matches the `[preference]` entry.
- **Where the right answer came from:** only the verbatim `[tail]`. Every entry in the pack -
  two constraints and two decisions - still says Postgres, because the extractor missed the
  reversal at stage 3. The tail's reserved share is what carried it.
- ChatGPT: not yet tried.

## 2026-09-13 - the pack tried by hand: ChatGPT

Facts only; the reading of them is the author's to add.

- **Where:** chatgpt.com in the browser. Same pack, `loop-demo` v4, vendor `chatgpt`, sent
  alone as the first message. (Temporary Chat or not: not yet recorded.)
- **Reply to the pack alone:** "What do you want to tackle next?" No summary, no
  acknowledgement.
- **"What database does production use?"** -> "Production uses PostgreSQL 16.2." **Wrong.** It
  took the `[decision]` entries and ignored the tail's "switching from Postgres to MySQL".

### The two side by side

| | Summarised the pack? | Which database |
| --- | --- | --- |
| Claude | No | MySQL - right, from the tail |
| ChatGPT | No | PostgreSQL 16.2 - wrong, from the entries |

- **The "do not summarise" line held in both.**
- **"The user wins" did not settle it, and could not have.** That line covers a conflict
  between the block and what the user says *now*. This conflict is *inside* the block - four
  entries against one tail line - and nothing in the preamble says which part of the block is
  newer. Claude inferred it; ChatGPT did not.
- One try each. A single disagreement between two models is an anecdote, not a rate.

## 2026-09-13 - stage 6: checkpoints, and what the first real one got wrong

Facts only; the reading is the author's. 330 tests pass.

A checkpoint takes one served pack, writes probe questions about what it included, what the
budget excluded, and user messages no entry claims; asks the local model each question with
the pack; grades the answers by NLI; and scores integrity as the weighted mean (included 1.0,
the other two 0.5).

### The first real run scored the answer prompt, not the brief

    loop-demo, chatgpt serve v4:  integrity 0.00 over 1 probe
    answer to "What database does production run on?":  "Not stated."

Measured afterwards against the same pack and qwen2.5:3b, four questions each:

| How the question was asked | Answered from the pack |
| --- | --- |
| pack + question in one message, ending "If nothing above tells you, answer 'Not stated.'" | 0 of 3 - "Not stated." every time, Peru included |
| the same, without that line | 3 of 3 |
| pack as its own turn, a reply, then the question (the by-hand shape) | 3 of 3 |

The escape hatch was taken on every question. The by-hand shape is what shipped. That
checkpoint row was deleted, since it measured a broken prompt.

### Probe writing, on the six real loop-demo entries

- **Offered "no fact here", the model said so for 3 of 6 entries** - two decisions and an open
  thread. Entries now decode under a grammar with no way to decline.
- **It invented expected answers twice**: "Preference lengths are stored as integers" and
  "Short answers must be no more than 5 words", both for "I prefer short answers with no
  preamble". Caught by requiring the entry's own text to entail the expected answer (NLI).
- **The first leak rule discarded good questions** ("What version of Postgres is specifically
  used?" - 4 of 5 answer words shared, the fifth being 16.2). Replaced: a leak is a yes/no
  question, or an answer with nothing left once the question's words are removed.
- **"Change of plan... switching from Postgres to MySQL" was judged to hold no fact.** A
  worked example of a change of mind fixed it (prompt v3) - but the grounding check then
  rejected the probe, reading "we are switching to MySQL" as not entailing "the project is
  using MySQL" (neutral 0.94). So the missed reversal is still not probed.

### The runs that counted

| Serve | Integrity | Graded | By category | Wall clock |
| --- | --- | --- | --- | --- |
| v4, 3000 budget | 1.00 | 2 | included 1.00 | 8.6 s |
| v5, 150 budget | 0.67 | 2 | included 1.00, excluded 0.00 | 10.2 s |
| v5, 150 budget, all fixes | 0.50 | 4 | included 0.75, excluded 0.00 | 10.0 s |

First run of the session 17.5 s, most of it loading the NLI model. The excluded zeroes are the
cost of the 150-token budget showing up as intended: asked what was left before shipping, the
model had not been given the open thread and made up an answer.

**Included 1.00 on "what database does production run on" with the expected answer
"Postgres" - which is stale.** Probes are written from entries, so an entry that missed a
change of mind produces a probe that rewards the stale answer. The checkpoint cannot see the
reversal miss; only the uncovered probe could, and it is the one that was discarded.

### Not yet run: the checkpoint job in the Docker worker

It reaches the handler and fails: the image has no `sentence-transformers`, because
`requirements.txt` had it commented out since stage 3. Fixed there and in the Dockerfile, not
rebuilt. (The worker container also predated the compose file's `HERDER_OLLAMA_URL`;
recreated.)

## 2026-09-13 - stage 7: adjust, and derive stops undoing what a person did

Facts only; the reading is the author's. 376 tests pass.

A person can now pin, unpin, remove, restore, archive, promote, edit, relayer and add entries,
and accept or dismiss suggestions - over the API and from the CLI (`herder entries`,
`herder adjust`, `herder suggestions`). Every change writes an `entry_events` row and queues a
render; none runs a model.

### The gap the task list did not name

Before this stage, derive could overrule the adjuster on the next pass:

- a **pinned** entry could be superseded by a contradicting candidate, which the status flow
  in the data model does not allow;
- a **hand-edited** entry could be rewritten by an `update` verdict;
- a **hand-written** entry could receive lineage from a `duplicate`, claiming the conversation
  was where it came from.

Now derive never changes an entry a person holds (invariant 10). A more specific candidate is
a duplicate; a contradiction keeps both and raises a `conflict` suggestion - accept lets the
new claim supersede yours, dismiss removes the new claim.

### Found by the tests

- **The event log recorded the new state as the old one.** `from_status` read `pinned` on a
  pin, because a bulk `update()` also rewrites the object in the session. Same mistake in
  three more places (relayer, edit revision, conflict accept). All four fixed.
- **Promotion suggestions were never created.** Stage 3 set `promotion_suggested` and wrote no
  suggestion row, so there was nothing for a person to accept.
- **A checkpoint could probe an entry removed after the serve** (invariant 3). Filtered.

### Live, on a throwaway `stage7-check` project

| Step | Result |
| --- | --- |
| paste 6 turns, derive (heuristic) | 3 entries, brief v1 |
| `herder adjust remove` on the Decimal constraint | render job done by the Docker worker; brief v2 without it |
| paste the same turns plus the Decimal rule again, derive | 4 candidates: **2 dropped as matching the removed entry**, 2 duplicates, **0 created** |
| `herder adjust edit` | revision 2, `changed_by = user`; embed job done by the worker |
| `adjust pin` on the removed entry | refused: cannot pin an entry that is removed |
| `adjust promote` on a Stable entry | refused: already in Stable |

Events recorded the correct before and after state.

## 2026-09-13 - stage 8: the prototype, in a browser

Facts only; the reading is the author's. 403 tests pass.

`http://localhost:8000`, logged in with the API key. A dashboard with a paste box, the adjuster
(suggestions on top, three columns), an entry page with lineage and edit, the brief with
versions and diffs, a pack page with a copy button and "run a checkpoint", and a checkpoint
page with every probe. Bare on purpose - the gate says no styling before the stage 9 baseline.

### Driven live against the running containers

With a temporary key, revoked afterwards:

| Step | Result |
| --- | --- |
| `/` without logging in | redirected to `/login` |
| log in | cookie set, HttpOnly and SameSite=Strict |
| paste 8 turns into a new project `stage8-live` | derive queued; the page refreshed until the worker finished |
| project page | three columns, 3 entries |
| an entry's lineage | the source message, with the entry's text marked |
| pin from the page | pinned; render done by the worker |
| brief page | copy button, 3 versions |
| serve for Claude, run a checkpoint | done by the worker: **integrity 0.83** |
| a `<b>` tag typed into the conversation | shown escaped on the brief page, not rendered |

### Found on the way

- An empty paste still created the new project before the transcript was refused. Now checked
  first.
- The first route layout sent "serve" to the derive/render handler and would have 404'd.
- A test for escaping on the live project page tested nothing: the message with the tag never
  became an entry. Checked again where the text does appear (the brief's tail).

Left in the database: projects `stage7-check` and `stage8-live`, and two revoked keys named
`stage8-live-check`.

## 2026-09-13 - stage 9: the harness, waiting on the fact lists

Facts only; the reading is the author's. 428 tests pass. **No benchmark result exists yet** -
the answer key is the author's to write, and nothing below is a measurement of herder.

**Built:** eight conversations (`bench/generate.py`, 9,373 to 12,829 tokens, two each of coding,
research, planning and handover, none of their lines shared with stage 4's corpus); a page at
`/bench` for writing each conversation's fact list; and `bench/run.py`, which compares
`herder` (through the API), `naive_summary`, `truncate_tail` and a `no_context` control at 500
and 3,000 tokens, with one local model reading every context.

**Checked end to end on a scratch copy of one conversation with three placeholder facts** - in
a scratch folder, never in `bench/datasets`. About a minute with warm models: herder's derive 19 s,
the map-reduce summary 56 s, twelve verdicts in seconds. The report came out with counts, per
archetype, per kind and per fact. Its numbers are three placeholder facts and mean nothing.

**One thing visible in that scratch run's brief, noted and deliberately not acted on:** the
heuristic made entries of two throwaway sentences from the generated conversation - "Let's park
it for now." as a decision and "Assume I haven't read much about it." as an open thread. Those
are exactly the kind of failure the baseline should count. Changing the extractor or the
conversations before the baseline exists would be tuning against the benchmark.

Expected time for the full baseline with the heuristic: roughly 30-60 minutes.

## 2026-09-14 - stage 9: the baseline. The first number, and it is mixed

Facts only; the reading is the author's. Run `bench/results/2026-09-14_1817-baseline`, 8
conversations, **261 hand-written facts** (222 true, 39 false), heuristic extractor, one local
reader (`qwen2.5:3b`) for every method. 53 minutes.

| Method | Context size | Recall | Hallucination | Compression |
| --- | --- | --- | --- | --- |
| herder @ 3000 | ~900-1,150 tokens | **0.36** (80 of 222) | 0.10 (4 of 39) | 11.4x |
| herder @ 500 | ~300-500 | **0.32** (70 of 222) | 0.13 (5 of 39) | 28.3x |
| truncate_tail @ 3000 | ~2,950 | 0.31 (68 of 222) | 0.00 | 3.7x |
| truncate_tail @ 500 | ~380-490 | 0.07 (16 of 222) | 0.00 | 25.2x |
| naive_summary (both) | 107-319 | 0.03-0.04 (of 167) | 0.00 | - |
| no_context | 0 | 0.00 | 0.00 | - |

**At the same actual size the structured brief wins clearly**: ~400 tokens of brief recalls
0.32 where ~400 tokens of raw tail recalls 0.07. Given four times the room (2,950 tokens) the
raw tail reaches 0.31 - still below the brief's 0.36 at a third of the size.

**Against the 20x/0.85 target: 28x compression, but 0.32 recall, not 0.85.** The compaction
claim holds; the retention claim does not, with this extractor.

### Two things that make naive_summary's number unusable as a comparison

1. **It ignored the budget.** Asked for a summary of at most 2,250 words it wrote 107-319
   tokens - 4 to 10% of the 3,000 it was allowed, and the 500 and 3,000 runs are the same size.
2. **It failed on two conversations** (900-second timeout summarising a 6,000-token part), so
   its rates are over 6 of 8.

So "herder beats a plain summary 0.36 to 0.04" is not yet a fair claim and should not be made.
What is fair: a plain summary from this model **at its natural length** carries almost nothing.

### Where the recall goes, by kind (herder @ 3000)

    constraint  0.59      open_thread 0.58      preference 0.43
    decision    0.40      code_state  0.20      fact       0.18      identity 0.00

The ordering the render was designed around holds: constraints and decisions survive, plain
background facts and identity do not. `truncate_tail @ 3000` beats herder on `open_thread`
(0.79 v 0.58) and `fact` (0.22 v 0.18) - recent verbatim text carries loose ends better.

### Every hallucination was a reversal

All nine false claims carried forward as true are the same failure: the user changed their
mind and the brief kept the old value - "stock rounded to the nearest 100 grams", "reorder
goes to Marisol only", "the on-call rota changes on Fridays", "backups offsite monthly",
"sessions on Monday and Wednesday". This is the missed-reversal problem from stage 3,
now measured rather than suspected. It is the top stage 10 item, and it is what the false
facts were written to catch.

## 2026-09-14 - stage 10, first two attempts: a fair opponent, and the reversal rule

### Attempt 0 (the harness, not herder): give naive_summary its budget

Run `2026-09-14_1928-naive-summary-fixed`, prompt v2, parts cut from 6,000 to 3,000 tokens.
The summaries went from 107-319 tokens to 1,707-2,792 at the 3,000 budget, and its recall from
0.03 to 0.23. On the seven conversations both runs cover:

| Method | Context used | Recall | Wrong claims |
| --- | --- | --- | --- |
| herder @ 3000 | 978 | **0.34** | 0.12 |
| naive_summary @ 3000 | 1,298 | 0.23 | 0.09 |
| truncate_tail @ 3000 | 2,965 | 0.31 | 0.00 |
| herder @ 500 | 392 | **0.30** | 0.15 |
| naive_summary @ 500 | 311 | 0.05 | 0.00 |
| truncate_tail @ 500 | 439 | 0.08 | 0.00 |

**The claim the project was built to test now holds against an opponent given a fair chance:**
a structured brief beats a plain summary at the same budget, and by a wide margin at a tight
one - while using fewer tokens than the summary does at 3,000. The summary still timed out on
one conversation of eight, so this is seven.

### Attempt 1: extract reversals (the first real change to herder)

Run `2026-09-14_2011-reversal-rule`, all eight conversations, heuristic extractor:

| | Recall | Wrong claims |
| --- | --- | --- |
| baseline @ 3000 | 0.36 (80/222) | 0.10 (4/39) |
| **with the rule @ 3000** | **0.41 (92/222)** | **0.00 (0/39)** |
| baseline @ 500 | 0.32 (70/222) | 0.13 (5/39) |
| **with the rule @ 500** | **0.36 (81/222)** | **0.00 (0/39)** |

**Every wrong claim is gone, and recall rose by twelve facts.** One change, measured.

**The cause was not where I expected.** I assumed the merge step was failing to supersede. It
was not reached: the sentences announcing a change matched no rule at all, so nothing was ever
extracted to contradict the stale entry. "Scrap the rounding I mentioned earlier - keep stock
exact to the gram" has no modal verb and no decision cue. The new rule looks for the *signal of
a change* rather than the claim - change of plan, scrap that, correction, forget what I said,
after all, is off, from earlier - and sits above every other rule, because a missed reversal is
the one failure that makes a memory worse than no memory.

Checked in the database afterwards: the reversal is now extracted, NLI reads contradiction in
both directions, and the entry it replaced is `superseded`. That is the merge step working as
designed on input it had never been given.

**Still short of the target:** 0.41 against the 0.85 the project set itself. Compression holds
at 11x and 28x. The next thing to measure is the `local` extractor on the same corpus.

### Attempt 2: the local model as extractor. It loses, clearly

Run `2026-09-14_2018-local-extractor`, same eight conversations, same reader, same facts.

| Extractor | Recall @ 3000 | Recall @ 500 | Wrong claims | Entries kept | Time per conversation |
| --- | --- | --- | --- | --- | --- |
| heuristic + reversal rule | **0.41** | **0.36** | 0.00 | 14.2 | **9 s** |
| local (qwen2.5:3b) | 0.20 | 0.14 | 0.00 | 7.1 | 272 s |

**Thirty times slower, half the entries, half the recall.** Per kind it is behind everywhere:
decisions 0.18 against 0.40, constraints 0.41 against 0.59, plain facts 0.09 against 0.18 -
so it does not even fix the gap it was expected to fix, which was ordinary background facts.

Two caveats, neither of which changes the conclusion: one chunk of one conversation timed out
at 900 s (the cursor does not advance on a failed chunk, so that conversation is short some
material), and 811 output tokens per call is a model writing plenty and having little of it
survive lineage validation and merging.

**This is the sibling project's finding again, in a different domain: a trained-or-large-ish
model losing to rules.** `mailman` had a fine-tuned model lose to eleven lines of regular
expressions on realistic documents; here a 3B instruction model loses to a list of cue phrases
on conversations. Having both implementations is the only reason either sentence can be said
with a number behind it, and it is the argument for the three-extractor design as built.

What it does not say: that a model cannot do this. It says **this** model at this size, on a
CPU, with this prompt, does worse than rules - and costs 30x the wall clock to do it.

### Tiering the facts, and a flaky test that was a real bug

Facts now carry `essential` / `useful` / `incidental`, rated one click at a time in the
authoring page, and the report gains a "Recall by how much the fact matters" section. **No
statement changed**, so the recorded baseline stays comparable: the tier is a new field, facts
written before it are `unrated` rather than defaulted, and unrated facts are left out of that
one table.

Why it is worth the hour of rating: under a budget no method can carry 261 facts and none
should try, so a single recall counts "forgot which database production uses" and "forgot that
flour arrives on Tuesdays" as the same miss. The rating question is fixed and is about the
conversation, not about what a method missed - *if someone picked this up tomorrow with only
these facts, would getting this wrong hurt?*

**A test failed on a run where it had passed before, and it was not flaky-by-nature.** Two
checkpoints written in one transaction share `created_at` to the microsecond, so ordering the
integrity series by time alone returned them in either order. Ordered by `(created_at, id)`
now; uuid7 ids are time-ordered, so they break the tie the way a clock would. Three runs green.

### Recall per tier, for every run so far

All 261 facts rated on 2026-09-15: **136 essential, 100 useful, 25 incidental**. The four runs
were judged before that, so their tiers were filled afterwards by fact id (`python -m
bench.report <run> --tiers-from bench/datasets`, reports in `bench/results/rescored/`). No
verdict was re-run; every statement and truth value was checked identical to what each run
judged first, and the re-score refuses otherwise. True facts only, so the columns count 108 /
89 / 25 (the naive_summary runs cover fewer conversations).

| Run | Method | Essential | Useful | Incidental |
| --- | --- | --- | --- | --- |
| baseline | herder @ 3000 | 0.46 (50 of 108) | 0.29 (26 of 89) | 0.16 (4 of 25) |
| baseline | herder @ 500 | 0.40 (43 of 108) | 0.27 (24 of 89) | 0.12 (3 of 25) |
| baseline | truncate_tail @ 3000 | 0.31 (33 of 108) | 0.33 (29 of 89) | 0.24 (6 of 25) |
| baseline | truncate_tail @ 500 | 0.11 (12 of 108) | 0.03 (3 of 89) | 0.04 (1 of 25) |
| naive-summary-fixed | naive_summary @ 3000 | 0.33 (32 of 96) | 0.14 (11 of 79) | 0.10 (2 of 21) |
| naive-summary-fixed | naive_summary @ 500 | 0.07 (7 of 96) | 0.03 (2 of 79) | 0.00 (0 of 21) |
| reversal-rule | herder @ 3000 | **0.55 (59 of 108)** | 0.33 (29 of 89) | 0.16 (4 of 25) |
| reversal-rule | herder @ 500 | 0.49 (53 of 108) | 0.27 (24 of 89) | 0.16 (4 of 25) |
| local-extractor | herder[local] @ 3000 | 0.24 (26 of 108) | 0.18 (16 of 89) | 0.08 (2 of 25) |
| local-extractor | herder[local] @ 500 | 0.16 (17 of 108) | 0.12 (11 of 88) | 0.08 (2 of 25) |

Facts, not readings: herder's recall falls with the tier (0.55 / 0.33 / 0.16); the raw tail's
does not (0.31 / 0.33 / 0.24). The reversal rule's whole gain at 3,000 was 9 essential facts and
3 useful ones, nothing incidental. The summary also favours essential facts (0.33 against 0.14).
The incidental column is 25 facts, so one fact moves it by 0.04.
