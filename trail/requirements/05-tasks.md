# Trail - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

The app runs. Items past stage 1 are marked honestly: `[x]` means built and tested.

**The next work is the script panel, in stage 4.** Every other stage is either done or off the
critical path. The library holds 220 placeable models and nothing is held back, so there is no longer a
content reason to build anything else first.

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
- [x] Tints applied per placement, so one figure recipe serves every character. A slot
      carries the recipe's own colour as a fallback, so an untinted model is not grey
- [x] Tints saved in the canvas file: a character's colours travel with them
- [ ] Confirm they read at the framing they will be seen at, not up close

### 2b - Import, so the test is worth trusting

- [x] `.vox` reader: `SIZE`, `XYZI` and `RGBA` chunks, everything else skipped
- [x] Confirm the palette mapping: a voxel's colour index is one-based, which is what
      leaves 0 free to mean empty
- [x] Z-up to Y-up, with the depth axis reversed so a model is not mirrored
- [x] The palette compacted to the colours a model actually uses
- [x] A file with no palette comes in grey and says so, rather than inventing colours
- [x] **The library loads from a manifest when the page opens.** `models/index.json` lists
      the recipes and the packs; adding a model is a file and a line of data, never code
- [x] Packs load after the first frame, so the scene is on screen before megabytes are fetched
- [x] Drop a `.vox` on the page as well, for anything not in the manifest
- [x] Imported models re-anchor with the block size slider, like recipes do
- [x] A CC0 `.vox` pack found and verified: FuzzyManStudios' Medieval Theme Voxels on
      OpenGameArt. 363 models in one 800 KB archive, all 363 parse.
      **Retired 2026-08-03: wrong subject.** The `.vox` path stays; the pack does not
- [x] Multi-model files: every model joins the library, and each is only converted the
      first time it is placed. Converting 363 up front would cost seconds for nothing
- [x] A library of previews in the panel, with a filter, showing what can be placed and what
      already is. It says when it is showing only part of a long list
- [x] `lib/thumb.js` draws a model as isometric pixels. Pure, so the same code makes contact
      sheets in Node and previews in the panel, and both are tested without a browser
- [x] **Previews are fitted and centred on the voxels drawn, not on the grid's bounding box.**
      Three faults at once: the vertical offset was out by half the footprint so every model
      was clipped at the top of its card, the fit used a box the model does not fill, and
      cells narrower than their spacing drew a solid model as a sieve
- [x] Previews are drawn at 128 and scaled down, not at 72 and scaled up. Fractional
      nearest-neighbour upscaling made some voxels one pixel wide and others two, which is
      what read as stretched. Measured: the size costs nothing, the voxel walk is the work
- [x] **The preview looked at the underside of every model.** One sign in one line: depth and
      height both moved a voxel up the screen, where looking down means they pull opposite
      ways. Wrong since the module was written, and invisible until the tiles were fixed
- [x] Tests for clipping, centring, tile usage, gaps and the viewpoint itself, each confirmed
      by reintroducing the bug. Two old tests were the reason this survived: "nothing is ever
      drawn outside the tile" only checked that something had been drawn, and "the top of a
      shape is brighter than its side" was checking the lighting of a face that was not on
      screen, because shading is taken from a neighbour rather than from the viewpoint
- [x] Previews are cached and drawn a few per frame, so opening the panel never stutters
- [x] `[` and `]` cycle the selected object through the models on show, keeping its position,
      turn and step range while only the model underneath changes
- [x] The library is a dialog, big, with a search and as many columns as fit
- [x] Previews are drawn only while the dialog is open, so opening the page does not convert
      the whole library
- [x] `tools/scan.js` walks `models/` and writes the manifest, so adding a pack is dropping a
      file in and running `npm run scan`. Licences and names already written are kept
- [x] Shadows follow a moved object. They were uploaded only inside the mesh rebuild, so in
      cube mode an object left its shadow behind
- [x] Meshes are cached and only built for what is on the canvas. Rebuilding every materialised
      model on every frame of a drag got slower the more of the library had been browsed
- [x] Remove an object, by button or by the delete key
- [x] `tools/sheet.js`: renders a pack to isometric contact sheets as PNG, written by hand
      rather than by adding an image library. A pack of nameless models cannot be judged
      from block counts; this is how you look at them
- [x] All 363 models of the medieval pack named, from those sheets. Category first, so
      filtering for `table` or `bush` finds the whole family
- [x] `models/names/<pack>.json` is read on import, so a pack arrives named. A file with
      the wrong number of names is ignored with a warning rather than applied crookedly
- [x] Duplicate names are numbered, so every model stays reachable
- [x] A canvas is restored only once the packs it may refer to have loaded
- [x] An object whose model is not in the library is dropped rather than carried, so layout,
      ranges and boxes can never fall out of step
- [x] A buffer slice that no longer fits triggers a rebuild rather than a partial write
- [ ] Imported models are not saved in the canvas file, so a canvas only works while the pack
      it used is listed in `models/index.json`
- [x] Some names are guesses at a small picture. Moot: the pack they name was retired,
      though the names file is kept so it can come back named if it is ever wanted
- [ ] **Kenney's "Voxel Pack" is 197 PNG sprites, not 3D models.** Several guides describe
      it as voxel models. It is isometric 2D art and is no use here
- [ ] **Do not use MagicaVoxel's bundled samples.** No explicit CC0 grant, so under the rule
      they are out
- [ ] **Do not use `enkisoftware/voxel-models`.** It ranks first in searches and it is CC-BY
- [ ] Composition wrapper: several `.vox` parts with pivots and motion, mirrored where needed
- [ ] Allow a composition to mix `.vox` parts and recipe solids on the same lattice
- [ ] Accept that packs from different artists disagree on scale, palette and style. Fine for a
      test, and a problem for a real library

### 2d - Meshes, which is where modern subjects live

- [x] `lib/obj.js`: OBJ and MTL to a voxel grid. Only the surface is filled, because Trail
      hollows everything anyway, which removes the hardest part of mesh voxelisation
- [x] The cube size follows the model's own extent, so any units arrive at one chunkiness
- [x] `Kd` is converted from linear to sRGB. Taken literally, every material comes out
      almost black
- [x] When every material shares one colour - what a texture atlas leaves behind - the
      material names are used instead. A bed's DarkBrown, Sheets and Wood are far better
      read as those than as three identical greys
- [x] Meshes are listed by path in the manifest and read only when first wanted. Reading
      158 OBJ files at startup would be tens of megabytes for models never used
- [x] `tools/scan.js` finds OBJ files, names them from their filenames, and reads the
      licence from the nearest licence file in their own pack
- [x] **A colour is believed only when there is reason to.** Not when the material is
      textured (`map_Kd` means `Kd` is a tint, not a colour), not when every material states
      the same colour, and not when it is one of the greys an exporter writes by default -
      white, 0.8, 0.64, matched tightly so a deliberate pale grey survives
- [x] When a material name says nothing - `Atlas`, `Material.001` - the model's own filename
      is read instead. A meaningful material name still wins over it
- [x] 90 of 216 models came out plain white; now 18, and those are genuinely pale concrete
- [ ] **Sample the texture atlas.** The Zombie kit - the most useful pack for this subject -
      still gets one invented colour per model, so a character is a flat hash colour rather
      than a person. `Zombie_Atlas.png` is 512x512 RGB in 6.1 KB, so it is flat patches, and
      the OBJs carry `vt` coordinates. Needs a PNG decoder (the inverse of the writer already
      in `tools/sheet.js`), `vt` parsing in `readObj`, and sampling per voxel. About 60 models
- [x] Up axis is assumed to be Y. Held for all 317 meshes across eleven packs

### 2e - glTF, which is what the packs ship now

Quaternius stopped exporting OBJ around 2019. Two packs on disk were invisible for that reason
alone, and `npm run scan` reported nothing new, which looks exactly like working.

- [x] `lib/gltf.js`: accessors, buffer views, byte strides, node transforms, `.glb`
- [x] Output is `{triangles, colours}`, the same thing `readObj` returns, so `voxeliseMesh`
      takes either without knowing which format it came from
- [x] Node transforms composed down the tree, so a mesh lands where the document puts it
- [x] `baseColorFactor` converted from linear light, like an MTL's `Kd`
- [x] A pack whose colour is only in a texture falls back to the material names, which is the
      whole Downtown City pack: no factor anywhere and every vertex colour white
- [x] The material-name table extended with the words a city is made of, and **matching
      changed to longest-first**, which fixed every chair coming out the colour of hair
- [x] Data URI buffers and `.glb` binary chunks, so a self-contained file needs no second fetch
- [x] Refusals name the model: no triangles, points-only, glTF 1.0, a sparse accessor, a
      buffer that was never supplied
- [x] 29 tests, against documents built in the test rather than downloaded packs
- [x] `tools/scan.js` finds `.gltf` and `.glb`, and lists a model once when a pack ships it
      in several formats
- [x] A test asserts every mesh in the manifest is a format the page can read, and that one
      model of each format loads all the way to a grid

### 2f - The library is everything on disk

- [x] Audit every pack against what the library actually offers. Two causes, both silent:
      153 models in an unread format, and 51 held back by the licence gate
- [x] Establish the licence of the three 2017 Quaternius packs that shipped without one, from
      `quaternius.com/faq.html`, and record the evidence in the manifest as `established`
- [x] A test refuses a pack recorded as CC0 with no licence file and no evidence, so an
      established licence stays distinguishable from a guess
- [x] `scan.js` keeps a mesh licence established by hand, instead of rewriting every mesh
      entry from scratch and undoing the work on the next scan
- [x] All 317 meshes put through the real path: none fail to voxelise
- [x] **Scale measured rather than predicted.** Ten packs of eleven agree at one unit to the
      metre, and agree with the hand-authored figure at 1.89
- [x] `atHeight`, and a `height` per mesh in the manifest, for the animals pack, which had
      been normalised before export so a shiba inu stood as tall as a bull
- [x] `scan.js` keeps a height across a rescan
- [x] The Downtown City MegaKit is a **modular kit**: 38 wall panels, 15 cornices, 17 decals.
      **101 of its 153 are excluded as parts rather than objects**, leaving the 52 that can be
      placed. Seven patterns in the manifest, kept across a rescan *and* across a re-download,
      which a list of 101 filenames would not be. The scan reports how many it held back
- [x] Measure where the disk actually goes before deleting anything for space. 675 MB in
      `models/`, of which **557 MB is never opened** - textures, Blender sources, FBX. The 101
      facade pieces are 2 MB, and the three buildings alone are 87 MB
- [ ] 557 MB of formats Trail never reads is still on disk. Deleting it from the working tree
      does not shrink `.git`, which is 285 MB and would need a history rewrite - the user's
      call, not something to do quietly
- [ ] The Universal Animation Library is an animation set, not models. Trail does no skeletal
      animation, so only its character mesh is of any use
- [ ] Names come from filenames, so a mesh pack arrives named but not categorised. The `.vox`
      pack is category-first - `table-oak`, `bush-low` - and mesh names are not

### 2c - Draw, when something specific is missing

- [x] **The figure**, hand-authored as a recipe rather than imported: 470 blocks, 1.89 units
      tall, three tint slots, and arms that sway on opposite phases
- [ ] MagicaVoxel is installed. Use it for anything a shot pushes in on

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
- [x] A startup test that runs the page against a stubbed browser and draws frames, since
      `index.html` is the one file the other tests cannot reach
- [x] The stub resolves only ids that exist in the markup, so code left pointing at a
      deleted control fails there rather than in a browser
- [x] Reaching for a control that is not in the markup names the id and says where to look
- [x] Failures carry their stack and the line they came from, not just a message
- [x] Free roaming: drag to orbit, right-drag to pan, wheel to close in, hold to walk
- [x] Roaming produces framings, not eye positions, so any angle found can be saved
- [x] Ascend and descend, as two held buttons and as `q` and `e`. Lifts the point being
      looked at rather than the eye, so climbing keeps the angle instead of tilting down
- [x] `c` copies the current framing, ready to paste into a route
- [x] A live cube-size multiplier, so the grain is judged by eye rather than guessed
- [x] Cube edges doubled. The fine grain existed for the cancelled morph
- [x] Picking: a ray through the frame against per-object boxes. Pure, and tested in Node
- [x] Click to select, drag a selected object to move it on the ground, `,` and `.` to turn it
- [x] The dragged object keeps hold of the point that was grabbed, rather than jumping
- [x] Moving an object rewrites only its own slice of the buffers, never the whole field
- [x] Selected objects lift out of the scene without their own colours changing
- [x] `p` copies the arrangement, ready to paste back over `PLACEMENTS`
- [x] Fullscreen on `enter`, which is the only way to get a 16:9 viewport in a browser
- [x] The panel is categories with real controls: sliders for anything with a value,
      segmented buttons for anything with a choice, and a number showing beside each
- [x] **Keys are for the camera and the take only.** Anything that is a value is a control,
      so there is one place to look for it rather than a legend to memorise
- [ ] Cloud in the sky shader. Currently a plain gradient
- [ ] Boxes are axis-aligned, so a rotated object has a slightly loose grab area
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

- [x] Canvas file schema and a validator that refuses a bad file with the reason
- [x] Version migration, forward only, one version at a time
- [x] Autosave to browser storage, so a reload is never a loss
- [x] Save to disk with ctrl+s, and open by dropping a file on the page
- [x] A stable round trip, so saving twice produces the same file
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

- [x] Ghosting in the shader: `aFrom` and `aUntil` against the current step. Ghosts are
      washed into the sky and drawn smaller, so no sorting is needed
- [x] Weather per step, cross-fading across the flight
- [x] Scar map: storm leaves the ground wet, fog leaves it pale, and both persist
- [x] Scars derived from the steps, so a seek looks identical to a playthrough
- [x] Name tags on a 2D layer, fading with distance and gone by the wide shot
- [x] Weather drives fog, ambient light, reflectivity and the specular highlight
- [x] Surface Nets: the same voxel grids drawn as a smooth watertight surface, so curved
      things read as curved. Authoring is unchanged; only what is drawn is different
- [x] A roundness dial from faceted to fully relaxed, and `m` to compare against the cubes
- [x] Both paths share one fragment shader, so they cannot disagree about light or fog
- [x] Rain: one fixed cloud of drops that follows the camera and wraps around it, so a
      fixed count covers any shot. Density is a weather value and cross-fades in
- [ ] Snow. Rain exists; snow is the same pass with a different fall and drift
- [x] Looped object motion: `sway`, `spin`, `bob` and `liquid`, turning a vertex about a
      pivot in the shader. No rig, no skeleton, and nothing per frame on the processor
- [x] The tree's canopy sways, in three parts on different phases, while its trunk stays still
- [ ] Motion in the cube path. Only the surface reads pivots so far

### Drawing on the frame

- [x] A pen layer over the composed frame, with its own floating panel at the bottom right,
      opposite the main one so the two never crowd each other
- [x] Six colours, a width, undo and clear
- [x] Points kept as fractions of the frame, so a mark stays on what it was drawn on when
      the window resizes or goes fullscreen
- [x] Strokes drawn as curves through midpoints, so a line looks drawn rather than plotted
- [x] The layer only takes pointer events while the pen is on, and sits below the panels
      so the controls never stop being clickable
- [ ] Marks are not saved. They are for talking over a shot, and vanish on reload

## Stage 5 - Play mode, originally listed

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
