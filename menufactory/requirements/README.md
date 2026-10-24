# resto-dir - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What resto-dir is and what a restaurant gets. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases, and the journeys - diner, prospect, client, author |
| [03-architecture.md](03-architecture.md) | Stack and what was turned down, how one content file becomes a finished site, previews, hosting, checks |
| [04-data-model.md](04-data-model.md) | The restaurant content file every template reads, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Nothing is built.** These documents were written in one sitting from the author's first
brief. Most of the design is still a proposal waiting for the author's answer, and
00-plan.md says which parts are which.

Two things worth stating here so they are not discovered as surprises:

- **resto-dir is a business as well as a codebase.** The templates, the build tool and the
  made-up demo restaurants are public in this repository. Real clients' content, prospect
  lists, prices agreed with a client and contracts are not, and never will be.
- **A client's site has no server.** Every site is plain files on a free static host. There
  is nothing to patch and no database to lose, and the monthly running cost of a site is the
  restaurant's domain name.
