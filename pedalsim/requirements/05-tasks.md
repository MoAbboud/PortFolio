# pedalsim - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes the page is also checked at phone
width in landscape in the browser's device view.

Nothing is built. Planning is in progress; the open questions in [00-plan.md](00-plan.md)
come first.

## Planning

- [x] Requirements folder: README, 00 to 05, and the private context log
- [ ] The author answers the open questions in 00-plan, starting with the backend's job and
      who designs the look
- [ ] Proposed decisions confirmed or overturned, and moved to "settled"

## Stage 0 - Scaffold

- [ ] `pedalsim/` layout: `index.html`, `sim/`, `cars/`, `ui/`, `input/`, `audio/`,
      `server/`, `tools/`, `test/`, `package.json` with `"type": "module"` and
      `"test": "node --test"`
- [ ] `sim/step.js` exporting `step(car, state, inputs)` and `initialState(car, options)`,
      returning state unchanged
- [ ] `tools/drive.js`: reads a scripted input list, runs the steps, writes a CSV trace of
      time, rpm, speed, gear, clutch state
- [ ] `index.html` opens under `npx serve` and shows the page title

Check:

    cd pedalsim
    npm test
    node tools/drive.js test/scripts/idle.json > idle.csv
    npx --yes serve .

## Stage 1 - The maths, headless

- [ ] `sim/curves.js`: table lookup with linear interpolation, clamped at the ends
- [ ] Engine: torque table, friction, inertia, idle controller, limiter with hysteresis,
      stall, starter, over-rev flag
- [ ] Clutch: engagement curve, capacity, stick or slip with the lock test
- [ ] Manual gearbox: ratios, final drive, efficiency, neutral, reverse
- [ ] Car: drag, rolling, grade, brakes with the hold rule
- [ ] Fuel, coolant, odometer
- [ ] `hatch`, `coupe` and the silly car as data, with targets
- [ ] `tools/figures.js`: each car's 0 to 60, top speed and rpm at 70 against its targets
- [ ] Tests: idle holds within 50 rpm; clutch dumped at idle stalls; pulled away gently it
      does not; engine braking slows the car in gear and not in neutral; a braked car on a
      grade does not creep; top speed equals the power-drag crossing within 1 percent;
      targets met; energy never appears from nowhere in neutral
- [ ] Determinism: golden traces and their hashes; `SIM_VERSION`; a test that greps `sim/`
      for `Math.sin`, `cos`, `tan`, `exp`, `pow`, `log`, `random`, `Date`, `performance`

Check:

    npm test
    node tools/figures.js

## Stage 2 - The cluster

- [ ] Dial generator: range, start angle, sweep, major and minor ticks, numerals, redline arc
- [ ] Needle spring per dial, tuned per gauge
- [ ] Key-on sweep and light test
- [ ] Warning lights, gear or P-R-N-D indicator, shift light, small display
- [ ] Trace player: loads a CSV from stage 1 and plays it through the cluster
- [ ] Looked at at 1280 wide and at phone landscape

## Stage 3 - Pedals and the live loop

- [ ] Fixed-step loop with the accumulator and the 250-step cap
- [ ] Input quantised to 1/1023 at the step boundary
- [ ] Pedals drawn and pivoting
- [ ] Keyboard ramps per pedal, the slow modifier, rebinding
- [ ] Mouse and touch drag, several fingers at once
- [ ] Gamepad axes and buttons; device calibration screen; saved per device
- [ ] Ignition key; gears on number keys
- [ ] Done-when: someone other than the author pulls away using only a keyboard

## Stage 4 - The stick

- [ ] Knob constrained to the gate segments; nearest-point projection
- [ ] Synchro point, grind, matched clutchless change, reverse lockout
- [ ] Over-rev damage, check engine light, "new engine"
- [ ] Controller and shifter-device mapping

## Stage 5 - Automatic

- [ ] Torque converter: K and TR tables, creep, stall speed, coasting
- [ ] Lock-up clutch through the stick or slip code
- [ ] Shift map with hysteresis, kickdown, shift time
- [ ] Lever: P-R-N-D, brake interlock, parking pawl refusal
- [ ] `family` and `pickup` cars with targets met
- [ ] Tests: creep speed, stall speed against the K table, no hunting between gears at steady
      throttle, kickdown

## Stage 6 - Sound

- [ ] `AudioWorklet` voice: firing frequency, load-dependent harmonics, throttle filter, noise
- [ ] Limiter, starter, grind, stall cough, parking pawl
- [ ] Mute and volume; nothing plays before the first gesture

## Stage 7 - Challenges, recording, replay

- [ ] Run log recorder and packer
- [ ] The six challenges in `sim/challenges.js`
- [ ] Personal bests and the last ten runs
- [ ] Watch a run back
- [ ] Test: a run recorded in headless Chrome replays to the same result in Node

## Stage 8 - Backend and the board

- [ ] Node server: `/health`, `POST /api/runs`, boards, run fetch
- [ ] Verifier: version and car hash checks, step budget, the server's result stored
- [ ] Migration for `runs`; keyed address hash; rate limit; name rules
- [ ] Board view in the page; "unreachable" handled
- [ ] Docker Compose for local; `.github/workflows/test-pedalsim.yml` with a real database
      and the badge in the root README

## Stage 9 - Host it

- [ ] `deploy/build-static.mjs` and the Pages workflow paths include pedalsim
- [ ] `pedalsim` profile, initdb database and login, Caddy block
- [ ] README: what it is, a recording with sound, how to run it, what it does not do,
      what a verified run does and does not prove
- [ ] Root README lists pedalsim
