# Trail - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Nothing is built. Everything past stage 1 is `[ ]` and that is honest rather than an oversight.

## Stage 1 - Concept

- [x] Decide how the narration gets in: written and split into stages by the user
- [x] Decide the structure: one canvas holding the whole story, toured by a camera
- [x] Cancel the morph and all object-to-object transitions
- [x] Decide the camera language: a rectangle and a pitch drawn on the plan
- [x] Decide the flowchart: the plan is the flowchart, linear steps
- [x] Decide moves between steps: fly by default, cut when chosen
- [x] Decide the reveal: unvisited canvas ghosted, solidifying on arrival
- [x] Decide weather: global, cross-fading, leaving permanent marks on the ground
- [x] Decide the shape source: preprocessed dataset, offline, resolved by lookup
- [x] Rule out generative AI entirely, at runtime and at authoring
- [x] Decide motion: shimmer, weather, looped object motion, camera drift
- [x] Decide the window split: one page, two modes
- [x] Decide edit mode: top-down plan with a live 3D preview
- [x] Decide the frame: fixed 16:9, composed at 1920x1080
- [x] Check prior art and confirm this is not an existing product
- [x] Write these requirements
- [x] Settle the same person in two places: a step range per object
- [x] Record the engineering standards: SOLID translated, module boundaries, longevity
- [x] Settle the code layout: real ES modules, served locally, no build step
- [x] Settle shape sourcing: `.vox` import first, the Colab pipeline afterwards
- [x] Settle the input: paste a script, the app finds the objects, the user places them
- [x] Settle that the lookup dictionary is the noun detector, so no language processing exists
- [x] Settle that stages are cut from the script rather than drawn independently
- [ ] Take one real narration and split it into stages, to see what the shape of a script is

## Stage 2 - Voxel format and import

**This comes first now**, and it is ordered from lowest effort upward so the app runs as early
as possible. Primitives get the renderer working; downloaded CC0 models make the sixty-second
test worth trusting.

### 2a - Primitives, so something runs today

- [x] Recipe schema: solids, transforms, palette, anchor, tint, pivots, motion
- [x] Voxeliser: box, sphere, cylinder, cone, capsule, wedge
- [x] Later parts overwrite earlier ones, so detail can be painted over bulk
- [x] Grids cropped to their occupied cells, with an anchor offset for placement
- [x] Hollowing: drop cells with six occupied neighbours. Measured at 76 to 86 per cent
- [x] Run-length encoding over the grid and the motion array, base64
- [x] **Pack the solid grid, not the hollowed one.** Measured: hollowing makes the encoded
      form up to three times larger. A test asserts it so it cannot be reversed by accident
- [x] Tint slots recorded in the palette, so one figure can serve every named person
- [x] **Three primitive recipes: a house, a car, a tree**
- [x] `tools/inspect.js`: cube counts, budget share, and coloured silhouettes from three
      angles, so a model can be judged before a renderer exists
- [x] 21 tests, running in Node against the pure module
- [ ] Apply a tint at build time, replacing slot colours per instance
- [ ] Confirm they read at the framing they will be seen at, not up close

### 2b - Import, so the test is worth trusting

- [ ] `.vox` reader: `SIZE`, `XYZI` and `RGBA` chunks, everything else skipped
- [ ] Confirm the palette mapping: `.vox` indices 0-254 to Trail's palette 1-255
- [ ] Find a CC0 `.vox` pack. itch.io's voxel tag and OpenGameArt both carry them
- [ ] **Do not use MagicaVoxel's bundled samples.** No explicit CC0 grant, so under the rule
      they are out
- [ ] **Do not use `enkisoftware/voxel-models`.** It ranks first in searches and it is CC-BY
- [ ] Composition wrapper: several `.vox` parts with pivots and motion, mirrored where needed
- [ ] Allow a composition to mix `.vox` parts and recipe solids on the same lattice
- [ ] Accept that packs from different artists disagree on scale, palette and style. Fine for a
      test, and a problem for a real library

### 2c - Draw, when something specific is missing

- [ ] MagicaVoxel is installed. Use it for the figure, and for anything a shot pushes in on
- [ ] Draw the figure's arms as separate parts, so it has something that moves

## Stage 3 - Field and camera

**The sixty-second test lives here.**

- [x] WebGL2 context, no dependency, no build step
- [x] Fixed 16:9 frame letterboxed inside any window size, letterbox left black
- [x] Sky as a fragment shader: gradient and a soft sun glow
- [x] Ground plane with a specular highlight and distance fog
- [x] Planar reflection: the field drawn again mirrored, blended under the ground
- [x] One instanced draw for the field, a second for its reflection
- [x] Camera from a rectangle and a pitch, fitted to the 16:9 frame
- [x] Flight that interpolates the framing rather than the eye, arcing upward in the middle
- [x] The constant drift that runs under every shot, including a hold
- [x] Ambient cube shimmer, so a held shot is never a photograph
- [x] The sync flash at the start of a run
- [x] A route: hold, fly, hold, resting on the final framing
- [x] 30 more tests over the camera and the scene builder, in Node
- [ ] Cloud in the sky shader. Currently a plain gradient
- [ ] Confirm 60 frames a second at **full** budget. The test scene is 20,528 cubes, which is
      5 per cent of it, so this is untested where it matters
- [ ] **Judge it: three objects, three framings, sixty seconds. Is it watchable?**

## Stage 4 - Script, canvas and route

### The script

- [ ] Paste a script. It becomes one step holding all of it
- [ ] Split a step at the cursor, and merge two steps back together
- [ ] Tokenise: whitespace, punctuation, lowercase. No stemming, no stopwords, no grammar
- [ ] Resolve every token against `lookup.js`. **The dictionary is the noun detector**
- [ ] Object tray: one entry per model, with a thumbnail, the word, and a mention count
- [ ] Order the tray by first appearance in the script
- [ ] Gap list: every word with no model, visible rather than silently dropped
- [ ] Name detection: capitalised, not sentence-initial, not in the dictionary, not a common
      capitalised word. **Offered, never assumed**
- [ ] Confirm a name as a cast member, with a colour and a tag
- [ ] Tray search, so a thing the script never named can still be placed

### The canvas

- [ ] Canvas file schema and a validator that refuses a bad file with the reason
- [ ] Version migration, forward only, one version at a time
- [ ] Top-down orthographic plan of the canvas
- [ ] Drag an object from the tray onto the plan
- [ ] Move, rotate and scale a placed object
- [ ] Cast: name, colour and tag per person, reusable across the canvas
- [ ] Step range per object, defaulting to **the first step whose text mentions it**, falling
      back to the first frame that contains it, and running to the end
- [ ] Several placements of one cast member, with a warning if their ranges overlap
- [ ] Draw a numbered frame rectangle, with a pitch
- [ ] Reorder frames. The plan with arrows in order is the flowchart
- [ ] Set hold, approach and weather per step
- [ ] Live 3D preview of the selected step, using the same renderer
- [ ] Running total of the cube budget, with a warning before the cap
- [ ] Running total of the route's duration, to check against the narration length
- [ ] Warnings: unresolved words, empty frames, objects in no step, zero-length holds
- [ ] Save and load a canvas file. Drag and drop, and a file input, since fetch is refused
- [ ] Last canvas kept in browser storage, purely so a reload is not a loss

## Stage 5 - Play mode

- [ ] Mode toggle as a two-key gesture, refused while the route is running
- [ ] Play mode draws the world and absolutely nothing else
- [ ] Ghosting in the shader: compare `aFrom` and `aUntil` against the current step
- [ ] Solidify over about half a second on arrival, and fade back out on the same curve
- [ ] Walk the route: hold, approach, hold, ending on the final framing
- [ ] Weather cross-fade across the approach
- [ ] Weather particles as a separate instanced draw
- [ ] Scar map: stamp a marking step's rectangle, sample it in the ground shader
- [ ] Ambient cube shimmer in the vertex shader
- [ ] Looped object motion from `aPivot` and `aMotion`
- [ ] Liquid motion phased by world position, so a pool surface travels
- [ ] Name tags on a 2D overlay, fading with distance, suppressed at the reveal
- [ ] The single white sync frame at the start of the route
- [ ] Jump directly to any step, settling into it exactly as playback would leave it

## Stage 6 - Preparation pipeline

**No longer on the critical path.** The `.vox` importer covers the need for models, so this
runs in parallel or afterwards, whenever hand-drawing everything starts to feel slow. Full
detail in `07-pipeline.md`.

- [x] Survey the datasets and check their licences
- [x] Rule out ShapeNet, ModelNet, ABO and OmniObject3D as non-commercial
- [x] Settle the licence rule: **CC0 only, permanently**
- [x] Drop Cap3D. Curated CC0 models carry better text than a generated caption
- [ ] Fetch: Poly Pizza API filtered to CC0, plus Kenney, Quaternius and KayKit archives
- [ ] Handle two fetch shapes: an API, and downloaded archives walked as directories
- [ ] CC0 filter as the first stage, before download, discarding with a logged reason
- [ ] Treat any model whose licence cannot be established as not CC0
- [ ] Normalisation of scale, up-axis and facing. **This is the hard part, not the ML**
- [ ] Thumbnail contact sheet for correcting facing by eye in a batch
- [ ] Per-category cube edge, so a house is not built at a figure's resolution
- [ ] Voxelise, sample colour per cell, quantise to a 255 palette, hollow
- [ ] Run-length encode and emit `library.js` as a script assigning a global
- [ ] Record source, author and licence per entry as an audit trail, not for credits
- [ ] Embed names and tags as the authors wrote them; match against a noun and inflection list
- [ ] No confident match means **no entry**, never a nearest guess
- [ ] Emit `lookup.js` as a plain word-to-model dictionary
- [ ] Spot-check the lookup by eye. A confidently wrong match is worse than a missing one
- [ ] **First run: fifty models across ten categories, not ten thousand**
- [ ] Confirm nothing in the browser loads a model, runs inference, or imports a library
- [ ] Measure what fraction of a real narration's nouns a CC0-only library resolves

## Library coverage, ongoing

- [ ] Take a real narration, list its nouns, and measure what fraction resolves
- [ ] Fill the gaps: draw it, write a recipe, or reword the line
- [ ] Decide how abstract nouns are handled
- [ ] Decide how a crowd is handled without spending the whole budget
- [ ] Keep a running note of how long a model actually takes to draw, to know what the CC0
      rule is really costing

## Stage 7 - First real video

- [ ] Build the canvas for one of your own narrations
- [ ] Record play mode with the recorder you will actually use
- [ ] Cut it against the voice track using the sync flash
- [ ] Watch it as a viewer would and write down every moment that was unreadable or dull
- [ ] Fix those, and only those, before adding anything new

## Explicitly not doing

- Generative AI of any kind, at runtime or at authoring. This is a hard rule.
- Machine learning in the browser. The one ML step is offline and its output is a dictionary.
- Objects transforming into other objects. Cancelled deliberately.
- Speech recognition, live or otherwise.
- Audio playback of any kind inside the app.
- Video export, encoding, or an in-app recorder.
- Captions or a narration text track on screen.
- A key, a backend, an account or a network call at runtime.
- Realism, likeness, or per-person modelling of real people.
- Physics, collision, pathfinding or simulation.
- Skeletal animation or walk cycles.
- Branching routes.
- A general 3D editor. Edit mode is a plan, a step strip, a preview and a few panels.
- Mobile, touch, or small screens.
- Anything visible in play mode that is not the world.
