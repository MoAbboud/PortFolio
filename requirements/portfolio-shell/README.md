# Portfolio landing page - requirements

The specification for the repository root `index.html`, the game-style front door to the
portfolio. It lives here rather than in an app folder because it has no folder of its own.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the page is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | The game loop, reachability, structure, and where a project is currently defined |
| [04-data-model.md](04-data-model.md) | Why there is no store, and why the project list is split across three places |
| [05-tasks.md](05-tasks.md) | The working task list |

The mechanic works. The content behind it does not: **two projects are wired up out of
eight**, so most of the portfolio is unreachable from its own front door.

The cause is in [04-data-model.md](04-data-model.md). A project is defined in three
separate places - the scene markup, a link map, and the style file - and forgetting the
second produces a box that animates and then goes nowhere. Making that one list is stage 3,
and wiring up the rest of the portfolio is stage 4.

See [00-plan.md](00-plan.md).
