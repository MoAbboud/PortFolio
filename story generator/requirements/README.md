# Breakdown Takes - requirements

The specification for this app. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the app is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | The two implementations, the layout algorithm, playback state, class diagram |
| [04-data-model.md](04-data-model.md) | The story format, structural rules the layout depends on, the tracking row |
| [05-tasks.md](05-tasks.md) | The working task list |

Before editing anything: there are **two implementations of this app** in the folder.
`breakdown-takes.html` is the live one - self-contained, plain JavaScript, runs from a file.
`breakdown-takes-generator.jsx` is the same app as a React component, with no host in this
repository to run it. They have drifted. Resolving that is stage 5.

See [00-plan.md](00-plan.md).
