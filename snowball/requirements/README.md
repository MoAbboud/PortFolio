# Snowball Creator - requirements

The specification for this app. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the app is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Files, state, class diagram, the main loop, selection mechanics, rendering |
| [04-data-model.md](04-data-model.md) | Why there is no store, what the chain is, what is derived from it |
| [05-tasks.md](05-tasks.md) | The working task list |

Two things a reader should know before touching the code:

The prompts offered at each step are a **fixed set of general moves**, cycled by position
in the chain. They do not read what the writer wrote. The app's README currently describes
them as generated, which is inaccurate, and correcting that is stage 5.

**Nothing is persisted.** A refresh destroys the work. That is stage 6, and it is the most
likely way this app will disappoint someone.

See [00-plan.md](00-plan.md).
