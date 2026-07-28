# fallacysuspect - requirements

The specification for this app. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, the current measured model quality, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the app is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Components, the two-stage pipeline and its gates, class diagram, key sequence, how models are produced offline |
| [04-data-model.md](04-data-model.md) | The application store, the training corpus, and the model artefacts |
| [05-tasks.md](05-tasks.md) | The working task list |

Reading order for someone new: 01, then 02, then 03. Read 00 for the measured model state,
which is the thing most likely to be misremembered.

`STATUS.md` in the app root is the operational handoff - how to run it, what the commands
are, where the files sit. These documents are the specification. Where they overlap, the
plan and the measured numbers here are the ones kept current.

The current work is stage 5, model quality: the transformer stage has been retrained and now
catches the fallacy it used to miss, but the detector over-fires on debate prose and that is
the live problem. See [00-plan.md](00-plan.md).
