# eval-harness - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the harness is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Components, layers, class diagram, retry policy, key sequence |
| [04-data-model.md](04-data-model.md) | The case file and the three-table results store |
| [05-tasks.md](05-tasks.md) | The working task list |

`DECISIONS.md` in the project root is the running log of judgment calls as they were made,
with their reasoning. This folder is the settled specification. `FAILURE_MODES.md` is the
list of model failures the case set is meant to catch, and it is what stage 4's new cases
should be written against.

This project has a sibling at `../triage-agent`. Stage 5 of this plan points this harness
at that agent.

The current work is stage 2, scoring. See [00-plan.md](00-plan.md).
