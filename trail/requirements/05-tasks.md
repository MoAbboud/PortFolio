# Trail - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

The app runs. Items past stage 1 are marked honestly: `[x]` means built and tested.

**The next work is stage 8, and it is mostly deletion.** Trail was redesigned on 2026-08-08
into an event recreator: the canvas is a long strip, distance along it is time, the camera is
fixed and orbits whatever hour the clock is showing, and pulling back reads the whole event in
a line. The reasoning is in `06-context.md` under "Trail is an event recreator", and the
decisions are in `00-plan.md`.

**Everything in stages 1 to 7 below describes the app as it is today.** Where a task there
contradicts stage 8, stage 8 is right and the older item is left in place as history rather
than deleted, because knowing what was tried is most of the value of this file.

**Reading the script is not part of any of it** - it was built and cancelled on 2026-08-07, and
the script is a document beside the app now. An earlier version of this paragraph said Trail
would tell you what it can build from a pasted narration. It will not, and it should not be
made to again without being asked.

The question the whole project was framed around has been replaced by a sharper one: **does
dragging a clock and watching a scene rearrange itself along a strip read as an event being
recreated?** It cannot be answered by more features either.

### Bugs found in use, 2026-08-08

- [x] **Adding a step reassigned every object already placed to the new step**, so an object
      placed on step one ghosted blue the moment a second step was added. Adding a step splices
      a *copy* of the step it follows, so the order names one old step twice and the second
      entry was overwriting the first in `reorder`'s lookup. **The first copy of a duplicated
      step wins.** Tested at the module and through the page, and both were confirmed by
      putting the bug back
- [x] Inserting a step still moves what pointed at a **later** step, which is the other half of
      the rule and has its own test. Without it, a step inserted in front of an object silently
      re-times the video
- [x] **The clock bar said "2 of 2 steps on the clock" wherever you were.** It was a count of
      how many steps carry an hour, and it read like a position. It names where you are now:
      `step 2 of 3`, or `between steps 1 and 2`
- [x] The panel's own step readout had the same symptom from a different cause: it showed the
      step being *arrived at*, which is a step ahead of where you are. It shows the step being
      worked on
- [ ] **A newly placed object gets `from: 0`**, so it is present from the first step rather
      than from the step being looked at. Correct for the reported sequence and worth deciding
      deliberately: the film strip makes it moot, because an object will belong to the piece it
      was placed on

## Stage 8 - The film strip

**Decided 2026-08-08, one module in.** A canvas is an ordered list of pieces, each one a minute
with its own objects and its own weather, laid side by side like frames of film. Ordered so the
app runs at every point: the pure module first, then the file, then the renderer, then what is
torn out.

### 8a - The strip itself, which is one pure module

- [x] `lib/timeline.js`: pieces butt together at a fixed distance, so **only the minutes you
      author take up room** and the times a piece carries do not position it
- [x] `placeInPiece`: an object is stored against its own piece and placed against the strip.
      This is the only code that undoes the relative positions, and it is why a cut is a splice
- [x] `spliceOut` and `insertPiece`: cutting a section lets the strip close up, and a new piece
      lands in the order its time runs. **`spliceOut` returns a new list** - a mutating version
      takes six tests down with it, which is the blast radius it would have in the app
- [x] `pieceAt` and `hourAt`: which piece is in front of the camera, how far between two it is,
      and what time that lands on. The same shape a flight used to return, so the weather
      cross-fade and the daylight read a scrub exactly as they read playback
- [x] **`hourAt` searches outward in both directions.** Reading only the piece under the camera
      and the one after left an untimed piece at the *end* of the strip with no time at all -
      found by its own test, and the third time this project has had to hold the line that
      **absent is not midnight**
- [x] Minute resolution: `toMinute`, `fromMinute` and `clockOfPiece`, so a piece can be 12:07
      and the bar can say so
- [x] The camera's position from the strip, so moving along the film keeps its own yaw, pitch,
      zoom and height. A test asserts all five are **identical** either side of a scrub, because
      that is the one rule neither redesign was allowed to break
- [x] The rectangle's depth is **derived from its width and the pitch** rather than stored, so
      the rig is four numbers and a tilt never leaves part of the frame empty. Confirmed by
      asserting that growing either axis pushes the camera back, which is only true when
      neither is slack
- [x] `stripExtent` and `revealFraming`: the ending fits every piece and lifts the pitch,
      because a strip read end to end is read from above
- [x] `fogFor`: fog scales with how far out the shot is. **This is the one that would have
      ruined the ending** - the test fails with "fog reaches 180 and the strip is 360 long"
      when the old fixed-unit fog is put back
- [x] `runAt` and `runDuration`: the film runs at a steady rate because every piece is the same
      width, resting `hold` at each. Replaces `routeAt` and its flights
- [x] 38 tests in Node, against the module rather than through the page. Three were confirmed
      by reintroducing the bug they exist to catch, and one found a hole rather than confirming
      one
- [ ] **Written once against a continuous-ground design and rewritten against the film strip.**
      The first version is in the history if a continuous world is ever wanted back

### 8b - The strip moves, which is the first thing you can see

**Built 2026-08-08**, after the user reported that nothing had changed: *"the film strip isnt
moving. When i go from step 1 to step 2, its the same step just a different weather."* It had
not, because `timeline.js` was written and nothing imported it.

- [x] **A step stands at its own place on the strip.** `restage` turns each step's framing into
      `framingOf(rig, index, PIECE)`, so a step says *how* it is looked at and its position in
      the film says *where*. Going from step 1 to step 2 now travels a whole piece
- [x] Scrubbing the clock travels along the strip, so the world slides past. The rule it looks
      like it breaks - "moving through the day never touches the camera" - is intact: what
      travels is the camera's position, and the yaw, pitch and width are untouched
- [x] **Ghosting is gone.** Being somewhere else on the strip is what hiding means now, and a
      ghost would have made the overview a smear: two thirds of the film washed into the sky
- [x] Name tags and ground places no longer disappear by step range, for the same reason
- [x] **An overview button**, which is the ending: far enough back to hold every piece at once,
      in the order it happened. A way of looking rather than a place, so turning it off puts
      the camera back where it was
- [x] The opening canvas is a three-piece strip of the user's own example - two people and a
      car at nine, one person and the car at half one, one person at quarter past six - so the
      app demonstrates the idea the moment it opens
- [x] `onStrip()` rebuilds the staged route if it has fallen out of step with the real one. A
      derived array refreshed by hand is the exact shape of bug this project has been caught by
      four times
- [x] Two tests, both confirmed by reintroducing the bug. Staging every piece at the same place
      fails with `step 2 is 0.0 units from step 1, so the world did not move`, which is the
      report, in the words it was made in
- [ ] Positions are still **absolute**, not piece-relative. Placing works because the camera is
      already at the piece, and cutting a section will need the relative form - which is 8c

## Stage 9 - Halo mode: the film is a ring in space

**Asked for 2026-08-09.** *"Imagine i rolled the film strip and made a sphere with it... the
earth rolls as im cycling... Then the overview unfurls the ball into a straight long piece...
where the strip isnt covering I want a space theme."* Settled as a **ring** rather than a
sphere - a strip rolls into a cylinder, and the user's own reference was Halo, so the middle
stays open.

### 9a - The world rolls

- [x] **`ROLL` in the shaders**: one shared block, injected into every program that draws part
      of the world. `uRoll` blends flat to rolled, `uRadius` is the size of the loop and
      `uFocusX` is the place on the film at the top of it
- [x] **The overview is the same geometry unrolling**, not a second view. `uRoll` eases to
      nought and the ring opens into a long straight strip
- [x] Nothing runs per frame on the processor: three uniforms, and the field is still built
      once and uploaded once
- [x] Normals turn with the world, or the far side of the ring is lit as though it were still
      facing up
- [x] **The radius is the length of the story**, so the world grows as the film does - with a
      floor, because three pieces closing a loop puts 120 degrees through each one and bends a
      scene into a horseshoe. Under the floor the strip is an arc of a larger circle
- [x] `easeRoll` is pure and frame-rate independent, so a stutter moves further rather than
      making the whole animation longer, and it settles exactly instead of creeping
- [x] The camera stops travelling in Halo mode: it sits at the top of the ring and the world
      turns to bring a piece to it

### 9b - The film is the only ground

- [x] **The infinite floor is gone**, and with it the mirrored reflection pass that existed to
      be seen in it. *"I never needed the infinite floor, its useless."*
- [x] **`uploadStrip`**: one plate of ground per piece, instanced, rolled with everything else.
      Without it a piece has no ground and objects float in the dark
- [x] A darker lip at the edge of a plate, so one piece of film reads as one piece
- [x] Weather marks are read in **strip space**, so a scar stays on the piece it fell on however
      the world is rolled
- [x] A **solid** switch fills the middle of the ring, for comparing a hoop against a body

### 9c - Space

- [x] `uSpace` pulls the sky to black, keeping a little of the hour's colour so the time of day
      still says something
- [x] Stars all the way round rather than fading out below a horizon, because there is no
      horizon and no ground to hide the lower half of the sky

### 9d - Picking on a curved world

- [x] `ringGround`: a ray against the ring's surface, read back as a place on the flat film.
      Everything that places, drags or draws works on the strip, so a click has to come back to
      it. The near face only - clicking through the world onto its far side is not a gesture
- [x] Placing lands on the piece being looked at rather than where the camera is, which are no
      longer the same thing

### 9e - The film list, and four bugs the ring brought with it

- [x] **The film list, top right.** A row per piece: the time it happens at, what stands on it
      counted by name, a button to turn the ring to it and one to cut it. **Cutting asks
      first** - it takes what stands on the piece with it and there is no undo
- [x] The clock bar's job is turning the ring; the list is where the film is changed. Add and
      remove moved past the overview and solid switches, with a gap, because changing what the
      film is made of sat a pixel from moving through it
- [x] **A frame of film is flat.** Bending every vertex by its own position curved the things
      standing on the strip - a tall object leaned, a wide one sheared, and its base no longer
      met its plate. The angle is taken once from the middle of the **piece** and everything on
      it turns rigidly, so the plate, its contents and their shadows share one frame. This is
      the tilt, the hovering and half the shadow bug in one change
- [x] **Shadows and places are rolled too.** The shared block was injected into their shaders
      but `bend` was never applied to their positions, so they stayed flat while the world
      turned out from under them
- [x] **The stutter after placing an object.** `rebuild` emptied every grid, re-voxelised every
      recipe, re-hollowed and re-anchored **every model ever converted** - the whole library as
      browsed, not what is on the canvas - and cleared the mesh cache so every object was meshed
      again. On every change. Only the grain is a reason to start again now, and grids are built
      for what the canvas actually uses
- [x] **Turning between pieces glides.** An arrow or a piece picked off the list asks the clock
      to travel and the ring turns to it; dragging the bar is still direct, because an animation
      fighting the hand on the mouse feels broken
- [x] Arrows chain from where the clock is **heading**, not where it has reached, so pressing
      twice quickly moves two pieces instead of finding the same one again

### 9g - The film had no ground when a canvas was opened

- [x] **Opening a canvas never told the renderer how many pieces the film has**, so a restored
      film kept the count from an empty startup - none - and had no ground under it until a step
      was added, which is the one path that happened to refresh it. Reported as the floor being
      wrong on load and *"when a new step gets added the floors get reset"*
- [x] `refreshStrip` is **guarded**, and called from everything that rebuilds the world. That is
      the third derived thing here to go stale by being refreshed by hand - `staged` and the
      grids were the others - and the answer is the same each time: comparing is cheap,
      remembering is not reliable
- [x] **A floor size slider.** How much ground a piece shows, from a fifth to two and a half
      times a piece
- [x] **How big a plate is drawn and how far apart pieces stand are now separate.** The pitch is
      what every position on the film is measured against, so it cannot move without taking
      every object on the strip with it - which is what widening the join cost a migration for.
      The plate is only what you can see, so it is free
- [x] `renderer.pieces` and `__trail.shot().pieces` report what the renderer is actually
      holding. Asked on demand, because a page starved of frames has drawn nothing and that says
      nothing about what it was given - the fourth time that distinction has mattered

### 9f - Still to do

- [ ] Judge the ring by eye: the bend limit, the plate lip, and whether a solid body reads
      better than an open hoop
- [ ] Rain still falls in a box around the camera, which is a weather for a flat world
- [ ] **Picking treats the ring as smooth and it is a polygon.** `ringGround` meets a cylinder,
      but a piece is a flat plate, so a click near a plate's edge is out by up to the sagitta of
      its chord - about a unit at the smallest radius. Harmless so far; it would show as a
      dragged object jumping slightly near an edge
- [ ] The list counts what stands on a piece by name. A piece with forty of something reads as
      "tree x40", which is right, but there is no way to reach one of them from the list

### The overview could not be left - 2026-08-09

- [x] **The overview frames the film, whatever shot it was called from.** It used to floor the
      width at the shot you were already in, so that pulling back could never be a push in -
      which made it a **no-op** on an empty canvas or any short film seen from a wide shot. It
      returned exactly what was on screen, so pressing the button changed nothing and neither
      did pressing it again: a state you could not tell you were in and could not leave.
      **Reversed after seeing it**, which is the third camera decision reasoned out and then
      undone by looking
- [x] Showing the whole film sometimes means closing in, and that is right. A one-piece film
      seen from three hundred units out is a speck
- [x] **Going to a step leaves the overview** - a mark, an arrow, a number key, the panel strip,
      or adding a step. Asking to be somewhere and staying pulled back is the app ignoring what
      was asked
- [x] Two tests, both confirmed by reintroducing the bug: `the overview framed exactly what was
      already on screen`, and the reveal depending on the shot it was called from

### The app opens empty - 2026-08-09

- [x] **No opening arrangement and no opening route.** *"The app should just load and i need to
      fill it up with objects and steps."* It used to open on a three-piece demonstration, which
      had to be deleted every time, made "did my canvas load?" ambiguous, and came back over work
      in progress
- [x] The demonstration moved into `test/startup.test.js` as a fixture, opened **through the
      file control** - the same route a person takes. A test that can only reach something by a
      route the user has not got is testing a route that can rot unnoticed
- [x] **Opening a canvas now reads the models it names first.** A pack's models are only listed
      until something asks for one, so `rebuild` found no grid and dropped every one of them as
      "not in the library". The app got away with it because the arrangement it opened on named
      the same two pack models every time and startup read those; opening empty is what exposed
      it. **Any saved canvas using pack models was being quietly emptied**
- [x] `apply` is async, and every caller awaits it
- [x] Opening a canvas marks it edited, so the deferred startup does not lay the last autosave
      over the file that was just opened

### Clearing the canvas, and what the library was holding - 2026-08-09

- [x] **"remove everything"** under the library. A canvas keeps what has been placed on it
      whether or not there are any steps - that is what makes an empty day a playground - so
      objects outlive the steps they were put there for. The steps are left alone: clearing the
      canvas is not cutting the film
- [x] **`release`** gives back every conversion, mesh, preview and decoded image that is not
      standing on the canvas. `forget` is the ordinary housekeeping and keeps the last 48;
      this keeps nothing, because clearing is a statement that none of it is wanted
- [x] A **held** readout in the panel: models converted and megabytes of images. A cache that
      quietly stops releasing looks exactly like one that works
- [x] **A real eviction bug, found while looking.** `imported` is keyed by model *and pose* -
      `Matt@Idle@0` - and the check for what was in use was built from `p.model` alone, so a
      posed model standing on the canvas never matched and could be evicted. Browsing far
      enough would drop its grid and the next rebuild would take the object off the canvas as
      "not in the library": a cache evicting the thing it is held for
- [x] **Startup no longer overwrites work done while it was loading.** The packs load in a
      deferred frame that ends by applying the opening arrangement, so anything edited in that
      window was silently thrown away - which looks exactly like a button not working
- [x] **A duplicate id took an hour.** "remove everything" was given the id the pen's "clear"
      already had, so both handlers bound to the same element: the pen cleared its marks and the
      canvas was never touched, with no error anywhere. A test now refuses a repeated id, and
      fails with `these ids appear more than once: b-clear`

### Pieces carry what stands on them - 2026-08-09

- [x] **`openPiece`**: making room moves every later piece **and what stands on it** one join
      along the strip. Without it a new piece moved the later cameras and left their scenes
      behind, so step three's contents sat on step two's ground and the far end went empty
- [x] **`cutPiece`**: cutting takes what stood on the piece with it and closes the strip up.
      Objects used to be stranded past the end of a shorter film and **came back** when a step
      was added and the strip grew over them again
- [x] Both read which piece a thing is on from **where it is**, not from `from`, because the two
      disagree the moment somebody drags something
- [x] A new step takes **the hour on the clock** and is inserted where that time belongs. The
      previous fix timed it halfway to the next step, which is where the reported "35 min later
      for some magical reason" came from
- [x] Cutting a piece keeps the selection on an object standing somewhere else, rather than
      dropping it because the indices moved
- [x] Two tests, both confirmed by reintroducing the bug: `house1 moved 0.0, not one piece (64)`
      and the deleted objects coming back with the new step

### A step added in the middle landed at the end - 2026-08-09

- [x] **A new step is timed halfway to the step it was added between.** It took whatever the
      clock happened to be showing, which is the whole bug: a piece stands on the strip by its
      **array position** and the camera finds it by its **hour**, so an hour that does not sit
      between its neighbours makes the two orders disagree. The panel said step 2 and the camera
      went to the far end of the film
- [x] The clock moves to the new step, so adding one in front of you does not then show you
      somewhere else
- [x] A test drives the reported sequence and asserts the route stays in time order. It fails
      with `added at 9, which is not between 9 and 12` when the old behaviour is put back
- [ ] **Array order and clock order are two orders, and only convention keeps them together.**
      Nothing enforces it: `reorder` can be handed any order, and a hand-edited file can carry
      any hours. The film strip makes the two the same thing, so the honest fix is for a piece's
      position to *be* its place in time - which is the version 5 file, still not built

### Separating the film, and letting the camera look up - 2026-08-09

- [x] **The veil**: the world fades out by distance from the piece being looked at, not from the
      camera. Distance fog could never have done this - a neighbouring piece is *beside* the
      camera at the same depth as the one in front of it, so anything keyed to depth shows both
      or hides both. One clear pool around the scene, everything either side of it in the sky
- [x] **The join was widened from 3 to 30.** A piece is 34 across, so its own scene reaches 17
      and the next piece used to begin at 20 - no room to fade across. The next piece starts at
      47 now and the veil lives between 20 and 44. A test asserts both ends against the piece
      geometry rather than against numbers
- [x] **The world reads as endless.** The ground is gone long before it runs out, and the floor
      is sized from the veil rather than from a constant, so it can never be caught ending
- [x] Canvas file version 6 carries a canvas written at the old spacing across, keeping each
      object on its own piece
- [x] The opening arrangement is written against pieces rather than world coordinates, so
      changing the spacing cannot strew it between them again
- [x] **The camera can look up.** Pitch reaches -38 and the look-at point rises to keep the eye
      out of the ground: at full tilt the eye sits at 0.60 and the target at 15.95. It could
      only ever look down before, because the eye is always `sin(pitch) * distance` above its
      target and the pitch floor was 1.5 degrees
- [x] The ground rule left `orbit.js` for `timeline.js`, because how much lift is needed depends
      on how far back the camera stands. The 500-turn property test moved with it
- [x] The lift is **not** banked into the rig, or the camera would ratchet upward on every tilt
- [x] `dusk` and `night` are gone from the panel: times of day dressed as weather, arguing with
      the clock. Still understood when a canvas names one, so nothing already built breaks
- [x] The varying check now compares **types** as well as names, and covers the `area` pair,
      which it had been missing. A mismatch is a link error and the stub says yes to linking
- [x] **The veil is thick.** Asked for as *"thick fog that would hide the entire canvas except
      the space im in"*: it closes halfway across the join rather than most of the way to the
      next piece. Measured: the piece reaches 17, the veil is clear to 17.9 and shut by 32.9,
      and the next piece does not begin until 47
- [x] **The overview is a reset**, not a wider version of the shot you were in. It keeps neither
      the yaw nor the height, because doing so left the strip skewed across the frame and
      pointing off the side of it. **Reversed after seeing it**, which is the second camera
      decision this project has made twice
- [x] The overview fits what has actually been **placed** as well as where the pieces stand, so
      an object dropped past the edge of its piece is still in the shot
- [x] **Name tags fade with the veil.** Removing the step range from tags left them as
      screen-space labels with no idea where their object was, so the names of every other piece
      hung in mid-air over ground that had been faded to sky. They use the same numbers the
      shaders are given, so a label and the thing it names go together
- [ ] The veil is a circle. A shape that follows the piece - a soft-edged rectangle - would sit
      closer to what a frame of film looks like, and is worth trying by eye

### Reported in use, 2026-08-09, and all three had one cause each

- [x] **There were two cameras.** `state.roaming` was a second position the camera fell back to
      the moment anything was dragged, and from then on the clock could not move it. Cycling
      changed nothing and clicking snapped back to the opening `fit`. **One camera now**:
      `state.rig` is how it looks, the strip is where it stands, and `adjustCamera` feeds the
      same tested `orbit`, `zoom` and `rise`
- [x] `state.mode`, `state.roaming`, `walk` and `panScreen` removed. Free roaming was a second
      answer to a question with one answer
- [x] **A middle step could not be reached.** `routeAtHour` reports the step being arrived at
      *and* the one being left, and standing on a mark counts as both; the panel took the one
      being left, so step 2 always reported as step 1. Landing exactly on a step pins it
- [x] `window.__trail.at().step` carried the same fault, so a test could not have caught it.
      **A hook that mirrors the implementation tests nothing**
- [x] **Canvas file version 5**: an old canvas is spread along the strip instead of piled on
      the first piece, by reading `from` one last time as a position. Guarded by the version,
      with a test that saving and opening twice does not walk the story down the strip
- [x] Objects are placed on the piece being looked at, and `from` records which piece that is
- [ ] `f` now toggles the overview rather than fitting everything, which is the same idea on a
      strip. Worth a look by eye before it is called settled

### 8c - The canvas file, version 5

- [ ] A piece is `{ hour, weather, hold, label, objects, areas }`. **No framing, no approachTime**
- [ ] An object is `{ model, at, rot, scale, pose, tints, label }`, positioned **from the middle
      of its own piece**. No from, no until, no path
- [ ] `piece: { width, depth, gap }` - how big a frame of this film is, per canvas
- [ ] The camera rig - yaw, pitch, width, height - is saved, because it is the composition now
- [ ] Migration from 4: `from` is read one last time and used to **sort the flat object list
      into pieces**, shifting each object's position into its piece's own coordinates, so an old
      canvas opens as a strip rather than as a heap on one piece
- [ ] The round trip stays stable, and a version 4 file still opens

### 8c - The camera stops travelling, and the bar becomes the strip

- [ ] Remove `walk` and `panScreen` from `orbit.js`, and the keys that drove them
- [ ] The camera's position follows the strip, and only the strip
- [ ] `orbit`, `zoom`, `rise` and `revealFraming` are the whole camera
- [ ] Remove `routeAt`, flights, `approachTime` and the per-step `framing`
- [ ] Playback is `runAt`: the film running at a steady rate, resting `hold` at each piece
- [ ] **The clock bar becomes the strip in miniature** - one evenly spaced mark per piece,
      each labelled with the time it carries. This retires the note below about the bar showing
      all 24 hours whatever the story uses, because a bar made of pieces has no empty regions
- [ ] **Cut a section**: select a run of pieces on the bar and splice them out
- [ ] Add a piece at a minute, which is what "add a step" now means

### 8d - The renderer stops drawing cubes

- [ ] Measure object boxes, contact shadows and world extent from the **mesh**, not the cube field
- [ ] Stop calling `voxeliseMesh` on imported models, which removes work at import
- [ ] Remove `CUBE_VS`, `CUBE_FS`, the instanced field, `assemble`, `place` and `updatePositions`
- [ ] Remove `look.surface`, `cubeScale`, the roundness dial and `m` to compare
- [ ] Remove `aFrom`, `aUntil`, `solidity()`, `SOLIDIFY`, `stepT` and the ghosting fade
- [ ] Remove `travelOf`, `aTravel` and `arrive`
- [ ] Remove `reorder` and its four reference remappings. Nothing points at a piece by index,
      so the silent re-timing class it exists to prevent stops existing for the second time
- [ ] Remove `lib/script.js`, which has been unused since the step tab went
- [ ] `voxel.js`, `surfaceNets` and the four recipes are **left in the tree, unused**, until a
      real event says whether tinting and sway were missed

### 8e - Three things that are work rather than deletion

- [ ] **Fog has to scale with how far out the camera is.** It runs 26 to 180 units today, and a
      day-long strip is longer than that, so the pull-back would show the timeline fading into
      the sky. This is the one that would ruin the ending
- [ ] **A piece has to look like a piece.** A plate of ground with edges, with a join between,
      rather than one unbroken floor. This is what makes the pull-back read as film, and it is
      the one addition in stage 8 that is geometry rather than arithmetic
- [ ] **The floor has to follow the camera, or stop being an infinite plane.** One quad of
      extent 400 centred on the origin runs out along a strip, and may be replaced outright by
      the plates
- [ ] **The scar map becomes per piece.** 256 texels over 60 units is a map of a room, and a
      piece is a room. A scar belongs to the piece whose weather made it, which is cheaper than
      one map over a whole strip and is the answer that survives a cut
- [ ] Measure the frame rate **at the pull-back**, which is the shot that draws every piece at
      once. It has only ever been measured close in

### 8f - Composing a strip, once it runs

- [ ] **Copy a piece and paste it**, which the user confirmed 2026-08-08: *"thats fine if there
      is a copy this strip option to store a strip in the clip board and then paste it."* A
      clipboard rather than a repeat rule - the pasted piece is an independent copy you then
      edit, so placement stays manual. This is how a strip is actually built: the second piece
      is the first with one person taken out, and building every piece from scratch is the
      chore this whole stage is at risk of becoming
- [ ] Duplicate a selected object into the next piece, at the same spot, so a thing that stays
      put across four minutes is not four trips to the library
- [ ] Update `01-overview.md`, `02-interaction.md` and `03-architecture.md`, which all still
      describe a cube diorama toured by a routed camera



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
- [x] **Imported models are drawn as the mesh their artist made**, not voxelised. One new
      function, `fromTriangles`, returning exactly what `surfaceNets` returns, so the renderer,
      ghosting, weather, the route, shadows and the canvas file are all untouched
- [x] Occlusion baked from a coarse occupancy grid built for the purpose. Without it the
      renderer's crease term does nothing and every model is lit flat
- [x] **Normals welded by position, and the shimmer seed hashed from position.** Vertices are
      kept per face so an edge stays an edge, which means a corner exists once per face
      touching it - and the shimmer moves a vertex along its normal, so the copies walked
      apart and tore visible holes in every model
- [x] `preview` draws real geometry with a depth buffer, so the library shows what the canvas
      will show
- [x] The opening arrangement uses real pack models for the house and the car. It was four
      voxel recipes, so the app opened showing the look that had just been rejected
- [x] **The tree gap is closed.** Two CC0 nature packs arrived 2026-08-07: birch, maple,
      dead and twisted trees, bushes, flowers, grass, pebbles. 367 models across 15 packs
- [x] The two character packs were normalised before export, like the animals. One real
      height each: men 1.80, women 1.68
- [x] **The shimmer was sized by the median and was destroying faces.** It moved a vertex
      117 per cent of a character's smallest triangle. Smoothing still reads the typical
      triangle; the shimmer now reads the smallest, capped at a fifth of it
- [x] **The trees were blue.** "leaves" does not contain "leaf", and bark, flower, birch
      and maple were not in the name table. 77 of 740 materials still guess, 30 of them
      the Zombie kit's `Atlas`
- [x] **Texture sampling.** 184 models keep their colour only in a texture and every one of
      them is now painted from it. The plan here was wrong: it said the OBJ path could not
      reach them because of the nature pack's 88 absolute `C:/` paths, so the OBJ-over-glTF
      preference would have to flip. Taking the filename off the end resolves all 184, and
      the preference was left alone
- [ ] The `house` and `car` recipes are no longer placed by default and are candidates for
      retirement. `person` stays: it is the only tintable model and the only one that moves
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
- [x] **Sample the texture atlas.** Done, and it is the change the Zombie kit needed: Matt
      was one flat hash purple and is now a person in 25 colours. `lib/png.js` decodes,
      `lib/texture.js` samples a colour per face, `readObj` reads `vt` and `readGltf` reads
      `TEXCOORD_0`. 184 models across three packs, not 60
- [x] A colour is sampled **across the face**, not at one texel of it, and transparent texels
      are left out. A leaf texture is a cut-out on a field exporters leave black, and
      averaging that in makes every canopy dark
- [x] Colours are quantised to 250, because a detail texture gives a shade per face and a
      model indexes a palette of 255. 23 of 363 models reach the cap; the furthest a face
      moved was 42 of a possible 441
- [x] **Where each image lives is written into the manifest by `npm run scan`.** A model's own
      statement about it cannot be followed - two packs name a path from the artist's own
      machine and a third names a file that is not in its folder - and a static server cannot
      be asked to search. 26 images serve the whole library
- [x] Decoded images are reduced to 512 on the longest side and held in a 24 MB cache. It is
      only ever a saving: every colour is baked into the geometry at import, so dropping one
      costs a decode and never a colour
- [ ] **The `_C` texture of the nature pack's twisted tree is bright red**, so `bush-common`
      is a red bush. Checked in both formats, which agree: it is the artist's colour. Left
      alone deliberately
- [ ] **The Downtown buildings are darker and browner than the name table made them.** The
      pack's own preview render agrees with the texture, so this is the faithful answer and
      the bright red brick was this project's invention. Worth a look by eye: it is the one
      place the change makes something less illustrated
- [x] Up axis is assumed to be Y. Held for all 317 meshes across eleven packs

### 2g - Posing a rigged character

A pose is chosen when a model is imported and baked into its vertices. Nothing is played, so
this is authoring rather than the skeletal animation the not-doing list rules out.

- [x] Read `skins`, joints, weights and inverse bind matrices
- [x] Sample a clip at a moment: linear for translation and scale, spherical for rotation,
      held at both ends so a time past the end gives the last frame
- [x] Linear blend skinning on the processor, once, at import. 10 to 40 ms a pose
- [x] A skinned mesh's own node transform is ignored, as the specification requires
- [x] Weights normalised when an exporter has not made them sum to one
- [x] **One library entry per rigged model, and the pose lives on the placed object.**
      Reversed after seeing it: 309 poses across 22 rigged models would have been 309
      entries burying the other 216. The pose is saved per object in the canvas file,
      cached by model *and* pose, and stepped with a control in the object panel
- [x] **The character's two materials are tint slots**, so one model is a whole cast. The
      first tintable model that is not a hand-authored voxel recipe
- [x] `npm run clips` lists every pose in every rigged model, with lengths and heights
- [x] **Converted models are released.** Browsing the library retained 103 MB and never
      gave any back; capped at 48, never releasing anything on the canvas, it holds 27 MB
- [x] A conversion that fails no longer keeps its rejected promise forever, which had
      made a failed model impossible to retry
- [x] The GPU side checked rather than assumed: every upload deletes its old buffers
- [ ] **Facial expressions are not possible with these models.** Neither character has a
      morph target or a face bone, and the atlas is flat colour patches, so there is no
      face to move. Measured: at the route's framings a head is 12 to 53 px and an eye 2
      to 7 px, so it would not read without deliberate 3 to 4 metre close-ups
- [ ] **Attaching a model to a named joint** is the way in if it is ever wanted, and is
      worth more for props: each character file carries ten weapons as separate meshes,
      including a guitar
- [x] **A model is finished according to how fine its own triangles are.** Measured: the
      shimmer was moving a character's vertices 2.1x the width of their own triangles,
      sliding neighbouring faces through each other, while a car's moved 0.1x and looked
      right. Flat shading has the same cause: it suits a car and shatters a character
- [x] `finishFor` ramps between 0.045 and 0.012 units, includes the placement's scale,
      and scales the shimmer rather than switching it off. Verified across the library:
      no model can be torn open, 25 drawn smooth, 192 left faceted
- [x] **A colour per tint slot in the object panel.** Slots, saving and drawing all
      existed already; the only way to set one had been editing the page source
- [x] `scan.js` keeps hand-written poses across a rescan
- [x] 13 tests, against a rig built in the test rather than a downloaded pack
- [ ] **28 rigged models are in the library and only one is posed so far.** Matt, Lis, Sam and
      Shaun carry 20 poses each - `Idle`, `Walk`, `Wave`, `Yes`, `No`, `Punch`, `Death` - and
      the twelve animals carry 13 each
- [x] The named characters no longer come out one flat guessed colour each: they are painted
      from `Zombie_Atlas.png`. They still cannot be **tinted**, because their colours come from
      an image rather than from slots - which matters less now that the four of them are four
      visibly different people
- [ ] **`scan.js` prefers OBJ over glTF, and the OBJ export carries no rig**, so the rigged
      Matt is deduped out of the library while the static one stays. A pose entry names its
      file directly and is unaffected, but the preference is worth revisiting. **Texture
      sampling was expected to force this and did not** - both formats reach their images

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

### The script - CANCELLED 2026-08-07

Built, used, and removed at the user's request: *"it adds complications for nothing."* The
script is a document beside the app now. **Do not rebuild this without being asked** - the
reasoning is in `06-context.md`.

- [x] ~~Paste a script, tokenise it, resolve it against a dictionary~~ **cancelled**
- [x] ~~Object tray, cast list, gap list, name detection, synonyms~~ **cancelled**
- [x] A step keeps a note saying what happens in it. Nothing reads it
- [x] Split a note at the cursor, and merge two back together

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

### The clock, places, moves and a walked line - added 2026-08-07

Five things asked for in one message. Four fitted the design; the fifth looked
like it revived a cancelled one and does not. Reasoning in `06-context.md`.

- [x] **A time of day per step.** 6 is sunrise, 12 is noon, 18 is sunset, and
      the sun travels between them. `lib/daylight.js`, pure and tested
- [x] **A moon opposite the sun**, fading up across the horizon rather than
      switching on, with stars that arrive after it because a sky with the sun
      just under it is still bright
- [x] The ambience follows the hour: sky, horizon, floor, sun colour and light
- [x] **The hour and the weather are separate.** The hour says where the light
      comes from, the weather says how much gets through. A preset carries
      `dull`, saying how far it pulls the sky back to its own colours
- [x] A step with no hour resolves to exactly the preset it always did, so every
      canvas built before the clock looks identical. **Absent is not midnight**
- [x] A flight interpolates the **hour**, round the clock, and asks the sky
      again. Mixing two sun directions sends the sun through the middle of the
      world, and at six against eighteen there is no midpoint direction at all
- [x] **The sky shader takes the camera's axes** and turns each pixel into a
      direction, so the sun is where it is rather than painted at a fixed place
      on the screen. It could not have moved otherwise
- [x] **A name tag per object**, typed in the panel. The layer that draws these
      has existed since the first build with no way to set one, so every figure
      was anonymous unless the page source was edited
- [x] **Places: a named rectangle of ground**, drawn into the floor rather than
      standing on it. Not an object - no model, no cubes, no height - so it is
      its own list and never goes near the voxeliser or the picker
- [x] A place carries a step range, so it arrives with the part of the story
      that happens in it, and its name is drawn by the layer that names people
- [x] **An automatic camera: orbit on the spot, or push in slowly.** Expressed
      as a framing, so it can never end up underground. A sway rather than a
      circuit, and the push has a floor
- [x] Camera moves live on the step, not on a switch somebody holds, because
      play mode carries no interface and a take must play the same way twice
- [x] **Trace a line and an object walks it.** The field is still built once and
      uploaded once: the offset is added in the vertex shader from three numbers
      per vertex. Its shadow and its name tag travel with it
- [x] Canvas file version 4, carrying all of it, migrating forward from 3
- [ ] **Picking a travelling object mid-flight picks where it started**, because
      a box is measured from the buffers. Harmless while the route is not
      playing, which is when picking happens
- [ ] A place cannot be selected or resized after it is drawn, only renamed or
      removed. Redrawing one is cheap, so this is only worth fixing if it bites
- [ ] `dusk` and `night` now overlap the clock: they are times of day expressed
      as weather. Kept because canvases refer to them, and candidates for
      retirement once the clock has been used in anger

### An empty canvas is a playground - 2026-08-08

Reported: *"i removed all the steps and now i cant cycle the time and the
weather doesnt change... it should be an open play ground then i add steps."*

- [x] **The hour belongs to the world, not to the route.** `state.hour` is
      always a number, so the clock lights an empty canvas
- [x] **The weather belongs to the world too.** With no step to write to, the
      control sets the playground's own weather rather than doing nothing
- [x] The last step can be removed. A canvas with no steps is a place at a time
      of day, and `parse` was refusing one for no reason anybody could name
- [x] Adding the first step takes the day as it stands - the camera where it is,
      the hour on the clock, the weather on screen - rather than replacing what
      is on screen with a default
- [x] Playback and the panel cope with an empty route rather than assuming one
- [x] `skyNow` is one expression, used by the frame and readable by a test, so
      the test asks the thing that actually runs

### The bar is the route editor, and the camera is nobody's but yours - 2026-08-08

- [x] **Moving through the day never touches the camera.** The first version
      scrubbed the framing too, which made the bar useless for the thing it is
      for: watching one place change through a day
- [x] The clock works the same whether the camera is roaming or on the route,
      rather than taking the camera's mode away as a side effect of dragging
- [x] **A step's hour is set by dragging its mark along the bar**, which
      replaced both the time-of-day slider and the move-earlier/later buttons
- [x] Dragging a mark re-sorts the route by time, so the order it plays in and
      the order it reads in agree. `byTime`, through `reorder`, so every
      reference to a step follows it
- [x] Add and remove a step, on the bar, at the time the clock is showing
- [x] **Orbit and push are switches on the camera**, not something a step
      carries, and are gone from the canvas file. They survive the rule because
      they add to where the camera is rather than replacing it
- [x] **The step tab is gone.** It was a route editor, a script editor and a
      camera editor in one place. What is left is "this moment" - weather, hold,
      flight - and "camera moves"
- [x] "Frame this step from the view" removed: a step no longer drives the
      camera, so a framing saved on it had nothing to do
- [x] "Split the script at the cursor" removed. Reading the script was cancelled
      a session ago and this was its last piece still on screen
- [ ] **`splitStep` is now unused by the page.** It is the last of the cancelled
      script feature, and removing `lib/script.js` outright is a decision to
      take deliberately rather than while tidying a panel
- [ ] `moved` in `canvas.js` is unused by the page now that order follows the
      clock. Kept as a tested pure helper in case reordering by hand comes back
- [ ] A step still carries a `framing`, and nothing reads it except playback.
      If the camera is to be manual during a take as well, that field and the
      flight between steps are the next things to look at

### Moving through the day - added 2026-08-08

The interface turned round: the clock is the main control and the panel is the
in-depth settings. *"i want to move through time."*

- [x] **A bar across the bottom centre**, the whole day end to end, tinted night
      to day to night so it reads as a day at a glance
- [x] Each step is a **mark at its hour**. Clicking one lands on it exactly
- [x] Dragging the bar moves through time, and the camera follows: between two
      steps it is part way through the move between them
- [x] The hour under the hand drives the sun, so dragging reads as a day passing
- [x] Arrows either side jump to the step before or after, **by time**
- [x] **It is not a second way of driving the camera.** `routeAtHour` hands back
      the same framing, step and progress a flight does, so ghosting, weather
      and a walked line all behave the same played or scrubbed
- [x] Scrubbing does not arc. A flight lifts to show the ground in between; a
      camera that rises whenever you drag is fighting the hand on the mouse
- [x] **The panel starts closed**, behind a button in the bottom left corner
- [ ] The step strip in the panel is now the fallback for steps with no hour.
      Worth removing once every route is on the clock
- [ ] The bar shows the whole 24 hours whatever the story uses, so a route that
      happens between five and seven in the evening sits in a tenth of it.
      Zooming to the range in use is the obvious next move if it grates

### The route is a clock, and it can be rearranged - added 2026-08-08

- [x] **A step is named by the hour it happens at**, not by 1, 2, 3. The strip
      reads 09:00, 13:30, 18:15. A step with no hour keeps its number
- [x] Order and time stay **separate**: a story can double back to an earlier
      hour, so sorting the route by time would decide something that belongs to
      whoever is writing it
- [x] Move a step earlier or later, as well as adding and removing one
- [x] Adding a step lands **half an hour after the one it follows**, so a route
      is a sequence of times immediately rather than a stack of noon
- [x] **`reorder` drags every reference with the step it points at**: an
      object's range, the step it walks its line on, and a place's range. Moving
      a step without it does not fail or warn - it silently re-times the video
- [x] A reference to a dropped step falls back to the nearest surviving step
      **before** it, which keeps an object on screen
- [x] An open-ended range stays open. 9999 is "to the end of the route", not a
      step number
- [x] **Everything stopped being drawn**, because `aTravel` was bound in three
      vertex arrays and created in none. An enabled attribute array with no
      buffer makes every draw call invalid. `attribute` now refuses by name,
      and the startup test catches it
- [ ] The stubbed WebGL context says yes to anything, so it can never catch a
      draw call a real driver refuses. Everything it cannot refuse has to be
      refused by the code itself

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
