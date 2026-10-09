# pedalsim - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes the page is also checked at phone
width in landscape in the browser's device view.

Nothing is built. Planning is in progress.

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
- [ ] The author decides: the engine line behind the gauges, and one palette or one per engine
- [x] The author picked CodePen inspiration: filipz/pen/dPygJGM, with ma77os/pen/xxyywo as a
      backup

## Stage 0 - Scaffold

- [ ] `pedalsim/` layout: `index.html`, `sim/`, `engines/`, `ui/`, `input/`, `tools/`,
      `test/`, `package.json` with `"type": "module"` and `"test": "node --test"`
- [ ] `sim/step.js` exporting `step(engine, chassis, state, inputs)` and `initialState(...)`
- [ ] `tools/drive.js`: a scripted input list in, a CSV trace out
- [ ] `index.html` opens under `npx serve`

Check:

    cd pedalsim
    npm test
    node tools/drive.js test/scripts/idle.json > idle.csv
    npx --yes serve .

## Stage 1 - Engines from their dimensions

- [ ] `sim/curves.js`: table lookup, linear interpolation, clamped ends; 2D for the load map
- [ ] `engines/params.js` for V4, V6, V8, V10, V12
- [ ] `tools/build-engines.js`: displacement, redline from piston speed, IMEP shape to torque,
      Chen-Flynn friction, inertia, load map, ripple, gearing, coach points; writes
      `engines/<id>.js` with a hash header
- [ ] Engine runtime in `sim/`: idle controller, limiter with hysteresis, stall, start key
- [ ] `tools/figures.js`: peak torque and power with their rpm, redline, free-rev rpm per pedal
- [ ] Tests: the formulas; free-rev settles at one rpm per pedal position and rises with it;
      limiter bounce; stall; each engine's figures inside its published range

Check:

    node tools/build-engines.js
    node tools/figures.js
    npm test

## Stage 2 - The drivetrain, headless

- [ ] Stick or slip coupling, shared by clutch and tyres, with the lock test
- [ ] The four cases (both stuck, either slipping, both slipping)
- [ ] Gearbox, final drive, efficiency, neutral, reverse
- [ ] Chassis: drag, rolling, weight transfer, ABS-capped brakes with the hold rule
- [ ] Torque converter, lock-up, shift map with hysteresis, kickdown, P-R-N-D
- [ ] Tests: gentle pull-away; stall on a dumped clutch at idle; wheelspin on a high-rev
      launch, and slower than a clean one; engine braking only in gear; braked car holds;
      top speed at the power-drag crossing within 1 percent; automatic creep and no hunting
- [ ] Determinism: golden traces, `SIM_VERSION`, the grep for forbidden calls in `sim/`

## Stage 3 - Gauges that build themselves

- [ ] Layout from the engine tables: ranges, nice-number tick steps, angles, redline arc,
      shift marks, one shift light per cylinder. Tests: every engine gets six to ten major
      ticks; a V4 and a V12 differ
- [ ] Face painter: each gauge drawn once to an offscreen canvas in the Warm palette, with
      Boldonse numerals and Bodoni Moda labels served from the repo
- [ ] Glow-line needles and arcs (core colour to edge colour, added on the dark); film grain
      in the reveal shader
- [ ] The engine line, if the author wants it: bank A, bank B and their sum against crank
      angle, from the ripple table
- [ ] Development field: bins, growth from revs and load, spread to neighbours, event parts
      (redline, shift marks, numerals), dyno bins from full-throttle torque
- [ ] Reveal shader (WebGL2): bin from angle, block size from development, ordered-dither
      threshold; canvas 2D fallback
- [ ] Dissolve on engine change and on a blown engine; restore on return; "build it all";
      reduced-motion preference builds at once
- [ ] Needles, gear indicator and arrows crisp on top; needle springs; key-on sweep; idle
      tremble from the ripple
- [ ] Trace player from a CSV, so the build-up is tuned before there is input: three or four
      pulls to the limiter complete the tachometer
- [ ] Looked at at 1280 wide and phone landscape; frame time checked on a phone

## Stage 4 - Live driving, automatic

- [ ] Fixed-step loop with the 250-step cap; inputs quantised at the step boundary
- [ ] Keyboard ramps; pointer drag on pedals; gamepad if present
- [ ] Engine picker; start key; P-R-N-D
- [ ] Every engine revs, drives and brakes

## Stage 5 - Manual and the coach

- [ ] Manual toggle; clutch; H-pattern knob on its gate segments; number keys
- [ ] Grind at the synchro without the clutch; matched clutchless shifts allowed
- [ ] Over-rev and the check engine light; past the over-rev limit the engine is blown and
      the faces break apart; "new engine"; stall and restart
- [ ] Coach: up arrow at the shift marker, economy upshift, down arrows (lugging, for speed,
      braking), rev-match needle, slip energy per shift
- [ ] Done-when: someone else shifts through the gears on a keyboard

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
- [ ] `.github/workflows/test-pedalsim.yml` running `npm test`, and the badge
- [ ] README: what it is, a recording, how to run it, what a shared run proves and does not
- [ ] Credits file: Filip Zrnzevic's pen as the inspiration (no code taken), and each font with
      its licence
- [ ] Root README lists pedalsim
