# herder - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled with the reason each one was taken, open questions, risks |
| [01-overview.md](01-overview.md) | What herder is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Stack, layers, the six-stage loop, how a model that does not cooperate is handled, the API surface, key sequences |
| [04-data-model.md](04-data-model.md) | The eighteen tables, the entry status flow, the invariants, and why the benchmark corpus lives outside the database |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

These are the backbone. The plan is followed rather than re-derived, and where it turns out
to be wrong it is changed here first and then in the code - by the author, deliberately, with
the old decision kept beside the new one and the reason recorded. A decision that is only in
somebody's head is a decision the next working session will make differently.

**Stages 0 to 8 are done**, and the prototype runs in a browser: paste, derive, adjust, serve
and checkpoint without a terminal. Stage 9 - the corpus and the baseline - is the current work:
the harness exists, and the hand-written fact lists come next.

[05-tasks.md](05-tasks.md) is the authority on status and the only place test counts
live, because the same status restated in three documents drifted in all three.

There are sibling projects at `../mailman` and `../evaluaters/`. They deliberately share no
code with this one. What was taken from `mailman` is its shape: the same requirements layout,
the same habit of running material through end to end before writing any rules, the same
insistence on an immutable record of what a model actually returned, and the same gate
keeping the interface bare until a baseline exists.

Two things about this project are worth stating here so they are not discovered as surprises:

- **It uses no hosted model API and needs no key.** Every model it runs is a file on disk - a
  small instruction model for extraction, an NLI model for merging and grading, a sentence
  embedding model for similarity. This matches the rest of the repository, and for a system
  holding everything its user has ever said to a chatbot it is a design property rather than
  a cost decision.
- **It needs PostgreSQL with pgvector.** Similarity search over entries is the merge step, so
  it belongs in the same database as the rows it merges.

Two habits that are part of the project rather than incidental to it: commit as the work
happens with real messages, because the history is on display; and keep `NOTES.md` in the
project root by hand, because what was tried and what the numbers did is the record no tool
can produce.
