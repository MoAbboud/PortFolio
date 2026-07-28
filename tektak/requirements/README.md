# tektak - requirements

The specification for this app. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, the fork the app is currently sitting at, decisions already settled, risks |
| [01-overview.md](01-overview.md) | What the app is and how both sides of it are used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Two pages, three storage keys, the fallback behaviour, and the duplication between the pages |
| [04-data-model.md](04-data-model.md) | The three lists, their fields, and what is not stored |
| [05-tasks.md](05-tasks.md) | The working task list |

`CURATION-TIPS.md` in the app root is the working guide for the curation habit itself -
where to look, what makes a good summary. These documents are the specification.

The app works. The open item is the fork in [00-plan.md](00-plan.md): whether this stays a
personal tool or becomes something other people read. Almost every unresolved question
resolves differently depending on the answer, so that decision comes before any more work.
