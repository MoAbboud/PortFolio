# pedalsim - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What pedalsim is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the system boundary, what it deliberately ignores, use cases, and the journeys screen by screen |
| [03-architecture.md](03-architecture.md) | The simulation and its maths, the fixed timestep, the cluster, the pedals and the stick, sound, the small backend and replay verification |
| [04-data-model.md](04-data-model.md) | The car file, the input log, what the browser keeps, the one server table, and what is deliberately not stored |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Nothing is built.** This folder is the whole project so far. It is being planned, not
coded.

Three things worth stating here so they are not discovered as surprises:

- **There is no road.** pedalsim is a car with everything removed except the pedals, the
  gauges and the gear stick. You never see where you are going. The joke only works if the
  maths underneath is real, so the maths is the project.
- **The page works without the server.** Driving, the gauges, the sound and personal bests
  all run in the browser with nothing behind them. The small backend exists for one thing:
  a leaderboard whose times the server has re-driven itself before believing them.
- **It uses no key for anything.** No map, no hosted model, no paid service. The engine
  sound is synthesised, not recorded.

Like trail, the front end is plain JavaScript modules with no build step. Like mailman,
herder and roamer, the backend is a compose profile on the one shared server.

Commit as the work happens with real messages, because the history is on display.
