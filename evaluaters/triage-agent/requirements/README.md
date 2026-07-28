# triage-agent - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, the safety policy, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the agent is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, the safety policy as a contract, use cases |
| [03-architecture.md](03-architecture.md) | Components, the single HTTP choke point, class diagram, the tool set, planned control flow |
| [04-data-model.md](04-data-model.md) | Why there is no database, what the tools depend on, what a run record will need |
| [05-tasks.md](05-tasks.md) | The working task list |

`DECISIONS.md` in the project root is the running log of judgment calls as they were made,
with their reasoning. This folder is the settled specification.

The safety policy in [02-interaction.md](02-interaction.md) is the most important document
here. It was written before any agent code, and the loop is built to it rather than having
guardrails added afterwards.

This project has a sibling at `../eval-harness`. Stage 4 of this plan is that harness
measuring this agent.

The current work is stage 2, the agent loop. See [00-plan.md](00-plan.md).
