# pedalsim - Overview

Public document. Behaviour only.

## What this is

A page of gauges with an engine behind them - and the engine draws the gauges.

Pick an engine - a V4, a V6, a V8, a V10 or a V12 - and drive it by the needles.
Press the throttle and the rev counter climbs by exactly as much as that much fuel can push
that engine. Let it out in gear and the speedometer starts to move. Brake and watch both fall.
There is no road, no steering and no view. The gauges are the whole car.

What is real is underneath. Each engine is built from its dimensions - how many cylinders,
how wide, how long a stroke - and its torque, its redline and how quickly it revs all come
out of those numbers. The clutch slips and grabs, the tyres grip and spin, the car has weight
and air resistance. Every needle reports something the simulation actually calculated.

## The gauges build themselves

The page starts as two empty circles. Choose an engine and rev it, and the gauges pixelate
in - coarse blocks first, sharpening as the needle returns - but only where the engine has
actually been. The tachometer fills in behind the needle; the redline appears the first time
you reach it; the torque curve draws itself from your full-throttle pulls, like a run on a
dyno; the speedometer fills up to the fastest you have gone. Every tick and number is placed
from that engine's own figures, so a V12's dials come out different from a V4's. Change
engine and the faces dissolve and start again. Blow the engine and they break apart.

## What you can do

- **Choose an engine.** Cycle from a V4 to a V12. They sound different on paper and they
  drive differently on the dials: the small one revs quickly and runs out of breath, the V12
  pulls from nothing and keeps going. The same car carries each one, so the engine is the only
  thing that changes.
- **Rev it.** In neutral, the rev counter follows the throttle. A little throttle, a little
  rise; floor it and it climbs to the limiter and bounces there.
- **Drive it, automatic or manual.** The automatic changes gear itself. Switch to manual and
  you get a clutch and a gear stick, and the page shows you when to change up, when to change
  down, and what revs to match when you do.
- **Brake.** The speed falls, and in gear the revs fall with it until you change down or the
  engine stalls.
- **Do the 0 to 60 run.** From a standstill, manual, as well as you can. You are timed and
  scored on how you did it: the launch, every shift, the time lost on each, against a
  perfect run the page has worked out for that engine. A ghost needle shows the perfect run
  beside yours.
- **Beat your best, and share it.** While the page is open, it keeps your best run for each
  engine. Refresh and everything starts over - it is a sandbox. To keep a run, send it as a
  link and their page drives it again from your inputs, so the
  score they see is the one the run really earns.

## What it is not

- Not a racing game. There is nowhere to go and nothing to steer.
- Not a model of any particular car or brand. The engines are typical of their kind.
- Not a driving lesson. It will teach you shift points. It will not teach you the road.

## Where it runs

In a desktop browser, and in a phone browser turned sideways. Nothing to install, no sign-in,
no server, nothing saved. It works offline once loaded, and every refresh is a fresh start.
