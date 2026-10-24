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
| [03-architecture.md](03-architecture.md) | The language and stack and what was turned down, how a design becomes a look, motion levels, the owner admin, publishing, hosting, checks, and the tabled review work |
| [04-data-model.md](04-data-model.md) | The venue content every look reads, what an owner may and may not change, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first.

**Nothing is built.** Three rounds of the author's answers are in. The first goal is the
animations and the core idea working; the business side - Google reviews, prices - waits
until then.

Two things worth stating here so they are not discovered as surprises:

- **This is a business as well as a codebase.** The build tool, the looks, the admin's code
  and the made-up demo venues are public in this repository. Real clients' content, owner
  accounts, prospect lists, agreed prices and contracts are not, and never will be.
- **There are two halves.** What a guest loads is proposed to stay as generated files on a
  static host, fast and independent. What an owner edits is an app with logins and a
  database. Publishing turns the second into the first. 03-architecture explains why, and
  00-plan lists it as a proposal the author has not settled.
