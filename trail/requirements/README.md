# Trail - requirements

The specification for this app. When the code and these documents disagree, one of them is
wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions already settled, open questions, risks |
| [01-overview.md](01-overview.md) | What Trail is and how it is used. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | The actors, the system boundary, what it deliberately ignores, use cases |
| [03-architecture.md](03-architecture.md) | One page, two modes, the static cube field, ghosting, the route, weather scars |
| [04-data-model.md](04-data-model.md) | The recipe format, the voxel grid, the canvas file, the word lookup, the dataset pipeline |
| [05-tasks.md](05-tasks.md) | The working task list |
| [06-context.md](06-context.md) | Working memory and handoff. Read this first |
| [07-pipeline.md](07-pipeline.md) | Where shapes come from: the CC0 sources, licensing, the Colab notebook, the word lookup |

**Start with [06-context.md](06-context.md), then run the app.** It records what exists, what
was cancelled and why, and where the difficulty actually is. Several decisions here replaced
earlier ones, and the context file is the only place that says what they replaced.

    Set-Location "C:\Users\Absol\OneDrive\Documents\GitHub\PortFol\trail"
    npx --yes serve .      # then open the address it prints
    npm test               # 331 tests, about four seconds

Four things worth knowing before editing:

**Trail is not a video generator, and it contains no AI.** It is a diorama that a camera walks
through in a browser while a screen recorder points at it. Machine learning appears exactly
once, offline, in a Colab notebook that prepares the shape library. Nothing is learned,
inferred or generated while the app is running.

**Coarse cubes are the construction, not the look.** Objects are blocked out as chunky voxel
solids and drawn as one smooth surface, with occlusion baked into the creases and a soft
shadow underneath. The target is an illustration, not a voxel game. This replaced the original
"field of cubes" identity once it was seen on a screen.

**Nothing morphs.** An earlier design had cubes flowing from one shape into another. It was
cancelled. The world is built once and the story is told by moving the camera. If a proposal
starts to involve objects transforming into other objects, it is reviving a dead design.

**Nothing runs per frame on the CPU.** Ghosting, shimmer, looped motion and the whole cube
field are shader comparisons against a handful of uniforms. If per-frame JavaScript over the
cubes appears, something has gone wrong.

**The canvas is the flowchart.** The top-down plan where you place objects is the same picture
as the step order. Frames are drawn on it and numbered, and the arrows between them are the
camera route.
