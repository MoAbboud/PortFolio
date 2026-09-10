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
