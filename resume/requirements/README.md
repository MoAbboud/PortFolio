# Interactive Resume - requirements

The specification for this page. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What the page is and how it is read. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | The three readers, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | One file, content lists, renderers, effects, theme, key sequence |
| [04-data-model.md](04-data-model.md) | The content lists, what the skill levels do and do not mean, the one stored preference |
| [05-tasks.md](05-tasks.md) | The working task list |

Two things worth knowing before editing:

**Content lives in lists in the page**, not in the markup. Updating the resume means
editing a list. Keep it that way; a resume that is annoying to update stops being updated.

**Accessibility is the open gap**, and it is stage 4. A resume claiming front-end
competence that cannot be used from a keyboard is arguing against itself.

See [00-plan.md](00-plan.md).
