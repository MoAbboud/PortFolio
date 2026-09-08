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
