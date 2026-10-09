# pedalsim - requirements

The specification for this project. When the code and these documents disagree, one of them
is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What pedalsim is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the boundary, what it deliberately ignores, use cases, the page and the journeys |
| [03-architecture.md](03-architecture.md) | The maths: engines built from their dimensions, the drivetrain, the two friction couplings, the interface the engine builds, the shift coach, the perfect-run solver, the score |
| [04-data-model.md](04-data-model.md) | Engine parameters, the generated engine tables, the chassis, gauge layout and development, the run log, the share link, what the browser keeps |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Stages 0 and 1 are done**: the scaffold, and five engines built from their measurements,
each tested against the published figures of a real engine of the same bore and stroke,
running in neutral. Stage 2, the drivetrain, is next.

    cd pedalsim
    npm test
    node tools/figures.js                       every engine's numbers against its targets
    node tools/drive.js test/scripts/workout.json --engine v12 --out traces/v12.csv
    npx --yes serve .

Three things worth stating here so they are not discovered as surprises:

- **It is one page of gauges, and the engine builds them.** Cycle from a V4 to a V12, rev it,
  drive it through the gears, brake. The gauges start as empty circles and pixelate in only
  where the engine has been, laid out from that engine's own figures. There is no road and
  nothing to steer. The page is kept plain on purpose; what is not plain is the calculation
  behind every needle and every pixel.
- **There is no server.** It is a static page on GitHub Pages and runs offline. The
  "backend" is the simulation in the browser that drives the dials. It is a sandbox:
  every refresh starts from nothing, and nothing is saved. A good run can be kept only by
  sharing it as a link, which the receiver's page re-drives before believing it.
- **It uses no key and no paid service.** Nothing is fetched at runtime: the fonts are
  served from the repo.

Like trail, it is plain JavaScript modules with no build step and `node --test`.

A sister app - something else built from the same kind of calculation - may later live in a
folder beside this one. It is not planned yet.

Commit as the work happens with real messages, because the history is on display.
