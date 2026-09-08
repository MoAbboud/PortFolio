# herder - Overview

Public document. Behaviour only.

## What this is

Portable memory for AI chat. herder watches a conversation with any chatbot, keeps a
compact, layered, versioned record of what was established in it, hands that record back
into any other AI tool on request, and then measures whether the model actually retained it.

The input is a conversation that will be thrown away. The output is a few thousand tokens
that carry the part worth keeping, plus a number saying how much of it survived the trip.

## The problem it exists for

Context does not travel. A long session with one chatbot establishes decisions, constraints,
preferences and half-finished threads, and none of it is available in the next session, in
another tool, or to an agent running against an API. Every vendor now offers some form of
memory, and every one of them has the same three limits: it belongs to the vendor, it stops
at the vendor's boundary, and it cannot be inspected or corrected. What was remembered, why,
and whether it was still true are not questions those systems answer.

The usual workaround is to paste the last few thousand tokens of the old conversation into
the new one. That is a truncation, not a summary: it keeps whatever happened to be recent
and drops whatever happened to be early, which is usually the part where the constraints
were agreed.

herder is the layer in between. It belongs to the user, it crosses vendors, every line in it
can be read and edited, and it reports how well it worked.

## What it does

| Capability | Description |
| --- | --- |
| Capture a conversation | Paste a transcript, or let a browser extension observe a live chat. Raw turns are stored append-only and are the source of truth |
| Group by project | Conversations that share context belong to one project. A project is the unit everything else is scoped to |
| Derive entries | Turn new raw turns into atomic entries - a fact, a decision, a constraint, a preference, an open thread, the state of some code - each one carrying lineage back to the exact messages it came from |
| Merge rather than accumulate | A new candidate that repeats an existing entry extends it, one that revises it produces a revision, one that contradicts it supersedes it. The set does not grow linearly with the conversation |
| Layer by lifespan | `stable` is about the user and outlives everything, `project` is about the work, `session` is the current thread. They expire at different rates and are budgeted separately |
| Render a brief | Compile the active entries into a token-budgeted block, ordered so that what gets cut is what matters least. Every render is an immutable version |
| Serve it anywhere | The brief plus an instruction preamble, formatted for the target tool. Through a browser extension, an MCP server, or the API |
| Verify | Ask the target model questions that can only be answered from the context it was given, grade the answers, and produce an integrity score with a list of what was lost |
| Adjust | Pin, remove, edit, re-layer or add any entry by hand. A removed entry stays removed |
| Show its work | Every entry links to the raw messages behind it. Every brief records what it left out and why |
| Measure itself | A benchmark harness runs herder against a plain summary and against tail truncation, at the same token budget, on the same conversations, and reports which recalls more |

## What "integrity" means here

Not the model's opinion of itself, and not a similarity score against a summary.

Integrity is measured by asking questions. Probes are generated from the source material and
each one has a ground-truth answer. The model under test is given the brief and nothing
else, the answers are graded against the ground truth, and the score is the weighted mean.

The probes come from three places on purpose, because they measure three different failures:

1. **Entries that are in the brief.** Did the context transmit at all? A zero here means the
   brief said something and the model did not pick it up. That is a formatting or preamble
   problem, and it is the most alarming of the three.
2. **Entries that exist but did not fit the budget.** What did the budget cost? A zero here
   is the price of compression, and it is the number that says whether the budget is set
   right.
3. **Raw messages no entry covers.** What did extraction miss entirely? A zero here is a
   hole in the derive step, and it is invisible to any measurement that only looks at the
   entries.

A system that only probed the first would report a high score for a brief that had dropped
almost everything. All three are reported separately as well as combined.

## The number this project exists to produce

A brief that is at least twenty times smaller than the conversation it came from, that still
scores 0.85 or better on those probes, and that beats a single "summarise this conversation"
prompt at the same token budget on the same material.

If that is not true, the project has no reason to exist, and the honest thing is to report
it. The benchmark is built to be able to say so.

## How it is used

1. A conversation is captured, by paste or by the extension.
2. Derivation runs in the background as new turns arrive. Nobody waits for it.
3. When starting somewhere new, the user asks for a resume pack and it goes into the new
   chat. The user presses send; nothing is ever sent on their behalf.
4. Optionally a checkpoint runs. It reports an integrity score and names what was lost.
5. What was lost becomes a suggestion in the adjuster: add this back, or extract this.
6. The user pins, removes and edits. The next brief reflects it.

## What it does not do

- It does not act on the context. It produces a block of text; something else uses it.
- It does not send anything for the user. Injected text lands in the composer and stops
  there. Auto-sending into someone's chat is not a feature this project will grow.
- It does not capture anything from a site that has not been switched on for that site
  specifically, and it shows a visible indicator whenever it is capturing.
- It does not hide what it remembered. There is no processing the user cannot read. The
  brief is always visible, always attributable to the raw messages behind it, and always
  editable.
- It does not resurrect what was removed. A removed entry never comes back, however many
  times the conversation repeats it.
- It does not learn automatically. Corrections change the brief; nothing retrains.
- It does not guess. An entry the model was not confident about is recorded with its
  confidence, not laundered into a fact.
- It is not a chatbot, a RAG index over documents, or a vector search product. It compacts
  conversations.

## What it runs on

Python and PostgreSQL with pgvector, brought up with one Docker Compose command and driven
from a PowerShell terminal on Windows.

**No hosted model API. No key, no per-request cost, no vendor.** Every model herder uses runs
on the machine it is installed on: a small instruction model for extraction, a natural
language inference model for merging and grading, and a sentence embedding model for
similarity. All of them are files on disk. A system that remembers everything its user has
ever said to a chatbot is the last thing that should be shipping that material to a third
party to be summarised, so this is a design property rather than a cost saving - although it
is also a cost saving, and it is why the thing can be left running.

The consequence is stated plainly rather than hidden: **extraction quality is bounded by what
runs on ordinary hardware.** The claim this project makes is about a method - that a
structured, layered, lineage-carrying brief beats a plain summary at the same token budget -
and it is measured with the same local model doing the reading on both sides. Holding the
reader constant is what makes the comparison mean anything; making the reader enormous is not
required, and would not make the finding more true.
