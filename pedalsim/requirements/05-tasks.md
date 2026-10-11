# pedalsim - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes the page is also checked at phone
width in landscape in the browser's device view.

Stages 0 to 5 are done. Stage 6, the perfect-run solver, is next.

## Planning

- [x] Requirements folder: README, 00 to 05, and the private context log
- [x] The author's answers: no server, engines four to twelve cylinders, rpm follows the gas,
      manual as an option with a coach, the board scores shifting on 0 to 60, sporty, no
      hardware, car engines first, a sister app later
- [x] Engines built from measurements: confirmed. Cycle between them: confirmed. Clean run:
      confirmed. Sound: later
- [x] New idea from the author: the maths builds the interface - empty circles that
      pixelate in as the engine is revved. Designed in 03-architecture
- [x] V10 is in. Every refresh is a new run: a sandbox, nothing saved
- [x] The author pasted the pen's HTML, CSS and JS; read, and written up in 03-architecture,
      "The look, from the pen"
- [x] Engine lines: yes. Colours: cycle with the engine
- [x] The author picked CodePen inspiration: filipz/pen/dPygJGM, with ma77os/pen/xxyywo as a
      backup

## Stage 0 - Scaffold

Done. 26 tests. The page served by `npx serve` loads its module in headless Chrome (the html
element carries `data-sim="0"`), and was looked at at 1280 x 720 and at 844 x 390.

- [x] `pedalsim/` layout: `index.html`, `sim/`, `ui/`, `tools/`, `test/`, `package.json`
      with `"type": "module"` and `"test": "node --test"`, `serve.json` (no caching, as in
      trail). `engines/` and `input/` appear with their first files in stages 1 and 4
- [x] `sim/step.js`: `step(engine, chassis, state, inputs)` returning a new state with the
      clock moved on, `initialState()`, `DT`, `STEPS_PER_SECOND = 1000`, `SIM_VERSION = 0`
- [x] `sim/inputs.js`: the five channels, pedals as integers 0 to 1023, `quantise` (the one
      place a fraction is rounded), `applyEvent` that refuses bad values
- [x] `sim/replay.js`: drive the simulation from a script in run-log shape; refuses a broken
      script before stepping. The ghost, the solver and share links will use it
- [x] `tools/drive.js`: script in, CSV trace out; `--every`, and `--out`, which writes plain
      UTF-8 and makes the folder (PowerShell 5.1's `>` can write UTF-16 or a BOM).
      `traces/` is gitignored
- [x] `test/rules.test.js`: reads every file in `sim/` and fails on `Math.sin` and friends,
      `**`, `Date`, `performance`, `Math.random`, browser globals, or an import from outside
      `sim/` - with a test that the checker itself catches each of them. Pulled forward from
      stage 1, because the rule matters from the first line
- [x] `index.html`: the starting state - two empty circles in the V4's colours - and a module
      import, so a server that sends `.js` as text/plain shows up now rather than in stage 3
- [x] `.github/workflows/test-pedalsim.yml`, pulled forward from stage 8 as roamer did at
      its stage 0. The badge in the root README waits for stage 8, with the root README entry

Check:

    cd pedalsim
    npm test
    node tools/drive.js test/scripts/idle.json --out traces/idle.csv
    npx --yes serve .        # then open the address it prints: two empty circles

## Stage 1 - Engines from their dimensions

Done. 82 tests in about a second. Every figure inside its reference engine's published range;
checked from PowerShell; the page still loads its modules in headless Chrome (`data-sim="1"`).

- [x] Published figures looked up first, not guessed: K20A and K20C2 for the V4's class,
      2GR-FKS, 2UR-GSE, the Huracan 5.2 V10, F140GA and L539. Each engine copies its
      reference's bore and stroke; the references are named in `engines/params.js`
- [x] `sim/curves.js`: evenly spaced tables, straight-line lookup, clamped ends. No 2D table:
      the load is a formula of three square roots instead (`airLoad`)
- [x] `sim/clock.js`: `DT`, `STEPS_PER_SECOND`, `RPM_PER_RAD_S`, so `sim/` has no import cycle
- [x] `engines/params.js` for V4, V6, V8, V10, V12, and the shared physics
- [x] `tools/engine-maths.js` + `tools/build-engines.js`: displacement, redline from piston
      speed, the breathing hump to combustion torque, simplified Chen-Flynn friction,
      pumping, throttle area, inertia, starter; writes `engines/<id>.js` and
      `engines/index.js` with a parameters-hash header; `--check`
- [x] Engine at runtime (`sim/engine.js`): airflow load, manifold filling lag, idle
      controller, limiter with hysteresis, firing on the key, stall, starter, coast to a stop
- [x] `tools/measure.js` and `tools/figures.js`: peaks, start-up, held-throttle rpm, rev time
- [x] `tools/golden.js` + `test/golden.json` + `test/golden.test.js`: a fingerprint of every
      state of a scripted workout per engine; fails if the numbers move without
      `SIM_VERSION`. Proven by changing one constant by 0.0001 and watching it fail
- [x] `tools/drive.js --engine`, and `load` and `cut` columns in the trace
- [x] Tests: the formulas; generated files current; figures in range; start and settle at
      idle; one steady rpm per held pedal, rising with it; limiter bounce; rev time; back to
      idle after a blip without dipping toward a stall; stall; no firing without the key;
      coasting to a stop, never backwards
- [x] Moved to stage 2: gearing and the coach's shift points, which need the chassis
- [x] Moved to stage 3: the ripple table for the idle tremble and the engine lines

Found and fixed on the way: friction too steep (every torque peak too early); the idle
controller unlearning on the way down from a blip (dip toward a stall) and then, once fixed
too far, never unlearning a start-up flare (idling 200 rpm high).

Check:

    cd pedalsim
    node tools/build-engines.js --check
    node tools/figures.js
    npm test

## Stage 2 - The drivetrain, headless

Done. 119 tests in about three seconds; checked from PowerShell; the page loads its modules
in headless Chrome (`data-sim="2"`).

- [x] `sim/chassis.js`: the one car, with performance-tyre grip (1.15 / 0.90) and 52% rear
- [x] Gearing per engine in the build tool: top gear at peak power at top speed; first gear
      to a quarter of top speed (not grip-sized - that gave the V12 a 150 mph first); six
      ratios closing up toward the top; the coach's full-throttle shift points
- [x] `sim/couplings.js`: a chain solver for joints that stick or slip, with the lock test.
      One solver for clutch, tyres and brakes instead of eight cases written out
- [x] `sim/drivetrain.js`: engine, clutch or converter, wheels, tyres with grip that fades
      with spin, weight transfer, drag, rolling, brakes with the hold rule, Park's pawl
- [x] `sim/gearbox.js`: manual from the stick; automatic shift lines with hysteresis,
      kickdown, lock-up from third, P-R-N-D
- [x] `sim/converter.js`: capacity-factor torque converter, coasting included
- [x] `sim/engine.js` split: works out the crank torque; the drivetrain moves everything.
      Friction fades over the last 20 rpm. Traction control (on for the automatic). Idle
      controller capped at 10% pedal
- [x] `SIM_VERSION` 2; golden fingerprints now cover a manual drive through three gears and
      an automatic run from Park through kickdown to reverse, for every engine
- [x] `tools/measure.js` `drive()` for closed-loop tests, `autoZeroToSixty()`;
      `tools/figures.js` prints gearing, top speed and 0-60; `tools/drive.js` adds
      `wheel_mph` and `tc` columns
- [x] Tests: the solver by hand (7); gearing shape; pull away gently (V4, V12); dumped clutch
      stalls; stopping in gear stalls; wheelspin slower than a fed-in launch; engine braking
      in gear only; braked car stays exactly still in neutral and against creep; top speed
      within 1%; creep 2-8 mph and steady; no hunting; kickdown two gears; converter stall
      speed; brake stand stays put; reverse; Park holds and refuses at speed; 0-60 ordering;
      a coasting car only loses energy

Found and fixed on the way: the build overwrote each engine's mass with the whole car's; in
neutral the released clutch held the engine still; the automatic sat on the limiter in first
because the converter slips; a tyre that broke loose never gripped again; integral-only
traction control oscillated; the idle controller could spin the tyres against the brakes.

Check:

    cd pedalsim
    node tools/build-engines.js --check
    node tools/figures.js
    npm test
    node tools/drive.js test/scripts/workout.json --engine v8 --out traces/v8.csv

## Stage 3 - Gauges that build themselves

Done. 131 tests (12 new for the display maths); checked from PowerShell; looked at in headless
Chrome at 1280 x 800 and 844 x 390, with WebGL2 and with it switched off. Not done: frame time
on a real phone.

- [x] Fonts: Boldonse and Bodoni Moda italic, Latin subsets, copied into `fonts/` with their
      SIL Open Font License files (both checked in google/fonts). Nothing fetched at runtime
- [x] `ui/layout.js`: tidy scales (steps of 1, 2, 2.5, 5 x 10^n, six to ten majors - 2.5 was
      needed for the V8's 216 mph), angles, one shift light per cylinder, shift marks from
      the coach. Every engine gets different dials
- [x] `ui/palette.js`: the pen's presets per engine; redline and type fixed
- [x] `ui/face.js`: each face painted once per engine - glowing ticks, Boldonse numerals,
      Bodoni unit - and the redline arc on its own layer
- [x] `ui/development.js`: bins (100 rpm, 1 mph), growth by dwell and load with a Gaussian
      spill, redline on first reaching it, dyno bins from full-throttle torque, shift marks
      when passed, settle to 0 (dissolve) or 1 (build it all)
- [x] `ui/reveal.js`: WebGL2 shader - bin from angle, block size 2^round(5(1-d)), 4x4 Bayer,
      grain; canvas 2D fallback fades each bin's wedge in
- [x] `ui/gauge.js`: crisp layer - empty circle from the start, glowing needle once the key
      turns, hub, shift marks; `ui/needle.js` springs; key-on sweep; idle tremble from
      `ui/ripple.js` (early-peaking pulses: 62 rpm on the V4 at idle, 1 on the V12)
- [x] `ui/lines.js`: the engine lines; `ui/dyno.js`: the measured dyno strip
- [x] `ui/demos.js` + `ui/main.js`: the simulation run in real time at 1000 steps a second,
      three scripted drives (rev it, manual, automatic) instead of a CSV trace player - the
      simulation is in the page, so a script is simpler and exact. Engine cycle with dissolve,
      build it all, reduced motion builds at once
- [x] Address options: `?engine=v12`, `?demo=0..2`, `?build=1`, `?at=12` (run the first 12
      seconds at once) - for sharing a drive and for screenshots
- [ ] Frame time on a real phone
- [ ] Phone landscape: the dyno strip and buttons sit below the fold - revisit with the
      on-screen pedals in stage 4
- [x] Engine lines kept out of the dial faces (the author: "lets keep the dials clean"):
      each gauge's circle is cut out of the lines, with a soft edge

Found and fixed on the way: a negative first frame step (a frame stamped before the last clock
read) un-built the faces; a symmetric pulse shape made the V8 rougher than the V6; red added to
its own glow washed the redline out to pink; the V12's manual demo was still braking at the end.

Check:

    cd pedalsim
    npm test
    npx --yes serve .
    # open the address it prints, then try ?engine=v8&demo=0 and ?engine=v12&demo=2&build=1

## Stage 4 - Live driving, automatic

Done. 140 tests (9 new for the controls). Driven in a real Chrome through its remote-control
protocol with real key and mouse events - start, the Park interlock, creep, flat out, Park
refused at speed, braking to a stop, the on-screen throttle pressed and slid. Layouts looked
at at 1280 x 800, 844 x 390 and, inside a 390 px frame, 390 x 844.

- [x] `input/pedals.js`: keyboard ramps (throttle 2.5 / 4 per second, brake 3 / 5, clutch
      6 / 1.2 for stage 5), Shift halves them; the hardest of keyboard, pointer and
      controller wins
- [x] `input/lever.js`: P-R-N-D; leaving Park needs the brake; Park and Reverse refused
      above walking pace; a notch at a time from Q / E or the bumpers
- [x] `input/controls.js`: keyboard, on-screen pedals pressed anywhere along them (top is a
      little, bottom is all; several fingers at once), hold-to-crank START, lever buttons,
      traction control button, a standard-layout game controller
- [x] `ui/main.js`: live inputs each frame, rounded once with `quantise`; the fixed-step loop
      and its 250-step cap were already there; touching a control during a demo hands the
      car over (a fresh automatic, engine off); hints for refusals and "hold K or START"
- [x] Traction control toggle (T, the TC button, controller Y): on by default for the
      automatic; changes apply at the next turn of the key, or at once with the engine off.
      Recording it in the run log waits for the run log itself (stage 7)
- [x] `index.html`: one grid - lever and START on the left, pedals on the right, gauges
      between; phone landscape puts them under the thumbs; portrait stacks them
- [x] Every engine revs, drives and brakes (the demos run all five; driven live on the V8)
- [ ] Calibrating a USB pedal set or wheel: dropped for now. The author has no hardware, a
      sandbox page cannot keep a calibration, and a standard-layout controller works as is

Check:

    cd pedalsim
    npm test
    npx --yes serve .
    # open the address it prints: hold K, brake + D, then Up - see 02-interaction J2

## Stage 5 - Manual and the coach

Done. 154 tests (14 new); `SIM_VERSION` 3. Driven in a real Chrome with real key and mouse
events: start refused in gear without the clutch, started with it, pulled away, first to the
shift point (the coach's arrow lit), second, third without the clutch (ground, stayed in
neutral), third with it; the knob dragged through second, third, a rough diagonal to sixth and
back to neutral. Layouts with the third pedal at 1280 x 800, 844 x 390 and 390 x 844.

- [x] `sim/gearbox.js` `manualEngage`: the stick asks, the synchro decides - neutral always;
      into a gear with the clutch down, or clutchless with the revs within 3%; otherwise it
      grinds and stays in neutral; reverse only below 1 m/s; gear to gear passes neutral
- [x] `sim/engine.js`: the starter cranks a manual only in neutral or with the clutch 80% down,
      an automatic only with the lever in P or N; check engine past the limiter + 150 rpm;
      blown past the over-rev limit - stopped, and the key does nothing
- [x] `sim/drivetrain.js`: `slipJ`, the heat the clutch has made (torque x slip speed x time)
- [x] `input/stick.js`: the H-pattern on line segments, nearest-point projection, gear at a
      position, sequential shifting through neutral; `ui/stick.js`: the knob dragged through
      the gates, resting where the box put it, stopped at the synchro and shaking while it
      grinds
- [x] `ui/coach.js`: up at the shift point and for economy; down when lugging, for speed and
      when braking in too tall a gear; the revs to match with the clutch down, drawn as a
      faint dashed needle; "last shift N J" after each shift
- [x] Manual controls: M or the AUTO/MANUAL button; C or A the clutch; 1-6, R, N; Q / E
      sequential; controller X the clutch and the bumpers sequential; an on-screen clutch pedal
- [x] Blown: the faces break back to empty circles, NEW ENGINE starts again; CHECK ENGINE light;
      "stalled" and "grind" hints; `?box=manual` and `?debug` in the address
- [ ] Done-when: someone other than the author shifts through the gears on a keyboard - the
      author's to arrange

After the author drove it: an upshift flared the revs far above the new gear and took a second
and a half to settle. Two keyboard rates, not the engine: the gas key lifted in a quarter of a
second (revving the free engine with the clutch down), and the clutch key came up at launch
speed (still slipping when the gas went back on). Now the gas lifts at 8 a second and the
clutch comes up at 5 a second once the car is rolling, 1.2 from a standstill - reproduced
before and after with the page's own ramps: from an 8200 rpm flare to gripping at third's revs
in a third of a second.

Found on the way: the blown-engine test expected an instant over-rev; at 45 m/s a dumped
clutch into first locks the rear wheels into a skid first (the light wheels slow far more
easily than the heavy engine spins up) and the road drags the engine past its limit over a
second or two - kept as true, test lengthened. Headless Chrome with software graphics runs the
building faces at about 3 to 10 frames a second and the page's per-frame cap then slows the
simulation; with normal graphics it is 75 frames a second and real time.

Check:

    cd pedalsim
    npm test
    npx --yes serve .
    # open the address it prints with ?box=manual: C down, hold K, 1, ease C up with a little gas

## Stage 6 - The perfect-run solver

- [ ] `tools/solve.js`: parameters, interpolated 60 mph crossing, golden section then
      coordinate descent, human shift limits
- [ ] `engines/perfect/<id>.js` for all five
- [ ] Test: every stored perfect run replays to its stored time
- [ ] The author drives each engine and checks its perfect run looks believable

Check:

    node tools/solve.js
    npm test

## Stage 7 - 0 to 60, score, board, share link

- [ ] Countdown; recorder; ghost sim and ghost needle
- [ ] Phase split and time lost per phase, summing to the gap (tested)
- [ ] Score and clean mark; score card
- [ ] Bests, recent runs and opened links in memory only; watch any run back; a test that
      nothing touches `localStorage`, cookies or IndexedDB
- [ ] Share link: pack, deflate, base64url in the fragment; open, re-drive, show
- [ ] Test: a run recorded in headless Chrome scores the same in Node

## Stage 8 - Publish

- [ ] `deploy/build-static.mjs` and `.github/workflows/pages.yml` include pedalsim
- [x] `.github/workflows/test-pedalsim.yml` running `node --test` (done at stage 0)
- [ ] The badge in the root README
- [ ] README: what it is, a recording, how to run it, what a shared run proves and does not
- [ ] Credits file: Filip Zrnzevic's pen as the inspiration (no code taken), and each font with
      its licence
- [ ] Root README lists pedalsim
