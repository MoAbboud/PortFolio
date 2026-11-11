# Menu Factory - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

**"Menu Factory" is a working name.** The final name is not chosen. In the code the name
lives in one brand file, and nothing else may spell it out - a test enforces that. In these
documents a rename is a find-and-replace on "Menu Factory". The project folder is
`menufactory/`; if the name changes again, the folder is renamed with it.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open and tabled questions, risks |
| [01-overview.md](01-overview.md) | What Menu Factory is and what a restaurant gets. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases, and the journeys - guest, prospect, owner, author |
| [03-architecture.md](03-architecture.md) | The GitHub Pages constraint, the tools and what was turned down, protecting the designs, how a design becomes a look, motion levels, the owner admin, publishing, checks, and the tabled review work |
| [04-data-model.md](04-data-model.md) | The venue content every look reads, what an owner may and may not change, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first.

**Nothing is built.** The first goal is the animations and the core idea working; the
business side - Google reviews, prices - waits until then.

Three things worth stating here so they are not discovered as surprises:

- **It runs on GitHub Pages.** Plain files, no server, no build step, like the rest of the
  portfolio. Even the owner admin is a page that saves by committing to the repository.
- **The designs are not in this repository.** The author's raw Claude Design exports are
  gitignored, and the readable source of each look is proposed to live in a private
  repository, with only an obfuscated copy published. Anything a browser shows can still be
  saved by a visitor; 03-architecture says plainly what can and cannot be protected.
- **This is a business as well as a codebase.** Prospect lists, agreed prices and contracts
  never go in any repository.
