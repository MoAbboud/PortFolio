# roamer - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What roamer is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | Stack and what was turned down, layers, pages and API, email links, the verified badge, check-ins, images, abuse, key sequences |
| [04-data-model.md](04-data-model.md) | The seven tables, the two planned ones, the status flow, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Nothing is built.** This is the planning stage. Stage 0, the scaffold, is next.

Two things about this project worth stating here so they are not discovered as surprises:

- **It needs a server and a database.** The static apps in this repository keep their data
  in the browser. roamer's listings are shared between strangers and have to be current, so
  it runs like mailman and herder: Python, PostgreSQL, Docker Compose.
- **It uses no key for anything it does not have to.** The map is OpenStreetMap through
  Leaflet. Development email goes to a local mail catcher. The only credential a hosted copy
  needs is for the mail relay that sends real email. The later post-import feature uses no
  hosted language model.

There are sibling projects at `../mailman` and `../herder`. They share no code with this
one. What was taken from them is the shape: the same requirements layout, the same stack and
deploy pattern, and - for the later import feature - mailman's habit of keeping what a
model extracted apart from the record a person accepted.

Commit as the work happens with real messages, because the history is on display.
