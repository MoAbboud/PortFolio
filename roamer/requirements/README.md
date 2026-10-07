# roamer - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What roamer is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases, and the user journeys screen by screen - owner, finder, demo visitor, admin |
| [03-architecture.md](03-architecture.md) | Stack and what was turned down, layers, pages and API, email links, the verified badge, check-ins, images, the admin section, demo mode, abuse, key sequences |
| [04-data-model.md](04-data-model.md) | The ten tables, the two planned ones, the status flow, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Stages 0 and 1 are done**: the map, the form and the listing page work. Stage 2, email
verification, is next. It starts as a
demo: made-up listings, every flow working, nothing reaching a real person.

Two things about this project worth stating here so they are not discovered as surprises:

- **It needs a server and a database.** The static apps in this repository keep their data
  in the browser. roamer's listings are shared between strangers and have to be current, so
  it runs like mailman and herder: Python, PostgreSQL, Docker Compose.
- **It uses no key for anything it does not have to.** The map is OpenStreetMap through
  Leaflet. Development email goes to a local mail catcher, and the hosted demo shows its
  emails on the site instead of sending them, so it needs no outside credential at all. A
  real service would need one, for a mail relay. The later post-import feature uses no
  hosted language model.

There are sibling projects at `../mailman` and `../herder`. They share no code with this
one. What was taken from them is the shape: the same requirements layout, the same stack and
deploy pattern, and - for the later import feature - mailman's habit of keeping what a
model extracted apart from the record a person accepted.

Commit as the work happens with real messages, because the history is on display.
