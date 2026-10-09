// The page's entry point.
//
// Stage 0 does one thing: import the simulation the same way the page always will, so a
// server that sends .js as text/plain (plain `python -m http.server` on Windows does) shows
// up now, as a page whose console says it could not load a module, rather than in stage 3.

import { SIM_VERSION } from '../sim/step.js';

document.documentElement.dataset.sim = String(SIM_VERSION);
