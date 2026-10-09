# pedalsim - Interaction and system boundary

## Actors

| Actor | Type | What they want |
| --- | --- | --- |
| Driver | Human, the public | To pick an engine, rev it, drive it by the needles, and see what it does. A few minutes, no sign-in |
| Challenger | Human, the public | A driver doing the 0 to 60 run again and again to shift better and beat their best |
| Receiver | Human, the public | Someone who opened a shared run link and wants to see the run and its score, and try to beat it |
| Portfolio visitor | Human, the public | Wants to see it work in a minute: choose the V12, floor it, change gear, see the score card |
| Author | Human | Adds and tunes engines, regenerates their tables, hosts the page |

There is no server, so no system actor. Everything happens in the visitor's browser.

## Interaction diagram

```mermaid
flowchart TB
    subgraph people[People]
        DR[Driver]
        RC[Receiver]
    end

    subgraph page[pedalsim - one static page in the browser]
        CTRL[Controls<br/>keyboard, mouse, touch]
        SEL[Engine and<br/>gearbox choice]
        SIM[Simulation<br/>engine, clutch, tyres, car]
        COACH[Shift coach]
        G[Gauges]
        RUN[0 to 60 run<br/>recorder and score]
        PERF[(Perfect runs<br/>worked out in advance)]
        LS[(Browser storage<br/>bests, settings)]
    end

    subgraph offline[Author's machine, before publishing]
        GEN[Engine generator<br/>and perfect-run solver]
    end

    DR --> CTRL --> SIM
    DR --> SEL --> SIM
    SIM --> G
    SIM --> COACH --> G
    SIM --> RUN
    PERF --> RUN
    PERF --> G
    RUN --> LS
    RUN -->|share link| RC
    RC -->|opens link| RUN
    GEN --> PERF
    GEN -->|engine tables| SIM
```

The link is the only thing that leaves a browser, and only when a driver chooses to send it.

## What the system is in the business of

- Making the needles honest. The rev counter answers the throttle by as much as the engine
  can, the speedometer answers the gearing and the weight, and braking takes speed off at the
  rate the brakes and the tyres allow.
- Showing how engines differ, with nothing else changing: same car, same tyres, five engines.
- Teaching shifting: when to change up, when to change down, what revs to meet.
- Scoring a 0 to 60 run against the best that engine can do, and saying where the time went.
- Being plain to look at, and sporty. The page is simple; the calculation is not.

## What the system does not care about

- Where the car is. No road, map, track, scenery, steering or camera.
- A server, accounts, or a global leaderboard. Bests live in the browser; sharing is a link.
- Real car brands, model names, trademarks.
- Exotic engine layouts in the first version: rotary, two-stroke, diesel, turbocharging,
  electric. Later, perhaps.
- Sound, in the first version. See the open questions.
- Hardware. No wheels, pedals or shifters are needed or assumed. A game controller works if
  one happens to be plugged in.
- Damage to anything but the engine's dignity.
- Money in any form.
- Being a training tool anyone relies on.

## Main use cases

| ID | Actor | Goal | Trigger | Result |
| --- | --- | --- | --- | --- |
| UC-1 | Driver | Choose an engine | Clicks I4, V6, V8, V10 or V12 | The engine is swapped in the same car. The tachometer's scale and redline, and the dyno strip, change to that engine |
| UC-2 | Driver | Start it | Start key or button | Needles sweep and return, the engine catches and idles. Idle is smoother the more cylinders there are |
| UC-3 | Driver | Rev it in neutral | Throttle | The revs rise and settle where the throttle holds them, fall when released, bounce off the limiter if floored |
| UC-4 | Driver | Drive in automatic | Selects D, throttle, brake | Creeps, accelerates, shifts up by itself, kicks down when floored, slows when braked |
| UC-5 | Driver | Drive in manual | Switches to manual, clutch, stick, throttle | Pulls away or stalls; changes gear or grinds; the coach shows up and down arrows and the rev-match target |
| UC-6 | Driver | Brake | Brake | The speed falls, the revs fall in gear; at a stop in gear without the clutch, it stalls |
| UC-7 | Challenger | Do the 0 to 60 run | Starts the run | Countdown, the run, the time, the score card, the ghost of the perfect run |
| UC-8 | Challenger | See where the time went | Reads the score card | Time lost on the launch and on each shift, shift revs against the best revs, wheelspin, limiter time |
| UC-9 | Challenger | Keep a best | Finishes a run better than before | The run is the new best for that engine, kept in the browser, and can be watched again |
| UC-10 | Challenger | Share a run | Copies its link | A link that holds the inputs, not the score |
| UC-11 | Receiver | See a shared run | Opens the link | The page re-drives the run, shows the score it earns, and offers "beat it" on the same engine |

## The page

One screen. Proposed arrangement, to be restyled by the author's sporty design:

```
+--------------------------------------------------------------------+
|  pedalsim      [ I4 ][ V6 ][ V8 ][ V10 ][ V12 ]     [ AUTO | MAN ] |
|                                                                    |
|   [ shift light bar: o o o o o o o o o o ]                         |
|                                                                    |
|        .-------------.          .-------------.                    |
|       /  TACHOMETER   \        /  SPEEDOMETER  \       GEAR        |
|      |   ghost needle  |      |                 |       [ 3 ]       |
|      |   shift marker  |      |                 |      up / down    |
|       \   redline     /        \               /       arrow       |
|        '-------------'          '-------------'                    |
|                                                                    |
|   dyno strip: torque and power curves, a dot at the current revs   |
|                                                                    |
|   [clutch] [brake] [throttle]      H-pattern stick     0-60: 5.82s |
|                                                    [ START RUN ]   |
+--------------------------------------------------------------------+
```

The pedals and stick are simple on-screen controls that also show what the keyboard is doing.

## Journeys

### J1 - First visit

1. The page opens on the four-cylinder, automatic, engine off.
2. Start. The needles sweep and settle; the tach trembles at idle.
3. Throttle in neutral: the revs climb, settle, drop when released. Floored: the limiter.
4. D, throttle: the speed builds, the box shifts at the shift marker, the light bar fills.
5. Brake: speed and revs fall together; the box shifts down.
6. Swap to the V12 and do it again. The dyno strip changes shape and the needles move
   differently. That comparison is the point.

### J2 - Manual and the coach

1. Switch to manual. Clutch and stick appear active.
2. Clutch, first, throttle, clutch out: it pulls away - or stalls, and the start key again.
3. As the revs reach the best shift point for this gear, the light bar completes and an up
   arrow lights. Shift.
4. Brake from speed: a down arrow and a second, faint needle on the tach - the revs the engine
   will need in the lower gear. Blip the throttle to meet it, release the clutch, smooth.

### J3 - The 0 to 60 run and a shared link

1. Start run, on the V8, manual. Countdown on the gauges.
2. The ghost needle runs the perfect launch and shifts alongside.
3. 60 mph: 5.31 s against a perfect 4.92 s. The card says: launch 0.21 s lost to wheelspin;
   1 to 2 shifted 600 rpm early, 0.09 s; 2 to 3 0.06 s; clutch held in 0.03 s too long.
4. Copy link. A friend opens it, their page drives the run again, shows the same 5.31 s, and
   offers to beat it.
