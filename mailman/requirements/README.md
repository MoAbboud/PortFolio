# mailman - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What mailman is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Stack, layers, extraction failure handling, the validation rules, routing, the API surface, key sequences |
| [04-data-model.md](04-data-model.md) | The seven tables, the status flow, and where the evaluation corpus lives instead |
| [05-tasks.md](05-tasks.md) | The working task list |
| [06-context.md](06-context.md) | Handoff between working sessions. Decisions with their rejected alternatives |

[06-context.md](06-context.md) is the one to read first when picking the work back up. It is
appended to, never rewritten, so the bottom of it is where the current session starts.

There is a sibling project at `../evaluaters/eval-harness`. It measures a language model on
a support-ticket extraction task and is deliberately not reused here - see
[06-context.md](06-context.md) for why, and for what is worth copying from it anyway.

The current work is stage 4, the validation layer. See [00-plan.md](00-plan.md) for the stage
order and [05-tasks.md](05-tasks.md) for the task list.

Two habits that are part of the project rather than incidental to it: commit as the work
happens with real messages, because the history is on display; and keep `NOTES.md` in the
project root by hand, because what was tried and what the numbers did is the record no tool
can produce.
