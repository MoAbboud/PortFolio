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
