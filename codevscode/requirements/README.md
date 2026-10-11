# codevscode - requirements

The specification for Code vs Code (working name). When the code and these documents
disagree, one of them is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What Code vs Code is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the boundary, what it deliberately ignores, use cases, the journeys |
| [03-architecture.md](03-architecture.md) | The pieces: the workspace, the helper model in the browser, the client who answers questions, the judge and its sandbox, findings and defence, scoring, the training pipeline and its harness |
| [04-data-model.md](04-data-model.md) | The challenge format, the database tables, what the browser keeps, the training data |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Status: planning only. There is no code.**

Three things worth stating here so they are not discovered as surprises:

- **It is a game about questions, not typing.** Each player has a helper, a coding model they
  name themselves, and the helper writes the code. The player's job is the one a lead or a
  quality analyst does: ask the client the right questions, direct the helper, catch what it
  got wrong, review the other player's app for bugs, and defend their own. The checklist -
  security, efficiency, practicality, correctness - decides who wins, not who typed fastest.
- **The helper is our own model and it runs in the player's browser.** No hosted model, no
  provider key, no per-request cost. A small open-weights coding model is fine-tuned on data
  we assemble, measured against the model it started from, and only shipped if it wins.
- **Matches are asynchronous first.** Two players take the same challenge at different
  times, then review and defend each other's apps over a window of days, like a code review.
  Live head-to-head comes later. Until there are players, the opponent is the house: the
  author's own reference app with bugs planted in it.

The stack follows roamer and mailman - Python, FastAPI, PostgreSQL, Docker Compose - with the
apps the players build written in plain JavaScript, judged in a sandbox with no network.

Commit as the work happens with real messages, because the history is on display.
