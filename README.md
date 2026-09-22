# Portfolio

Ten projects, built to be run rather than described. They fall into two groups: **systems with a
number attached** - a pipeline or a method, and a harness in the same repository that says how well it
works, including where it does not - and **single-file browser apps** that do one thing and need no
backend, no build step and no keys.

Most folders carry a `requirements/` directory with the same six documents (overview, interaction,
architecture, data model, plan, tasks). They are written before the code and updated as decisions
change, so the reasoning behind a design is readable without reading the diff.

## Start here

**[herder](herder/)** - portable memory for AI chat. Paste a long conversation, get a compact brief
where every line traces back to the messages it came from, and paste that into any other tool. The
benchmark in the repository compares it against a plain summary and against keeping the most recent
text, at the same token budget, on eight conversations with a 261-fact answer key written by hand.

> At a 3,000-token budget it recalls 0.68 of the facts using 772 tokens, against 0.20 for a plain
> summary using 2,084. At 500 tokens, 0.54 against 0.07 and 0.04. It never carried forward a claim the
> user had reversed; the summary did so three times. It misses its own target of 0.85, and the README
> says so in the same table.

Runs entirely locally - no hosted model, no API key. FastAPI, PostgreSQL with pgvector, a local
entailment model for merging, 506 tests.

**[mailman](mailman/)** - document intake. Messy invoices (PDF, scan, spreadsheet) in, validated
records out, with a review queue in the browser for the ones it is unsure about. Its own evaluation
reports **98.3% field accuracy** (529 of 538 fields across 34 documents) against a 75.1% baseline,
and 355 tests pass. Stages 0-9 of 12; runs locally.

Both were built the same way: an evaluation harness first, one change at a time, and the failures kept
in the write-up rather than deleted.

## Everything here

| Project | What it is | How to run it | State |
| --- | --- | --- | --- |
| [herder](herder/) | Portable, inspectable memory for AI chat, with a benchmark that measures it | `docker compose up -d`, then `localhost:8000` | Measured; hosting outstanding |
| [mailman](mailman/) | Invoices to validated records, with a human review queue | `docker compose up -d --build` | Stages 0-9 of 12 |
| [fallacysuspect](fallacysuspect/) | Flags passages that may lean on a logical fallacy - a warning with a confidence, never a verdict | `python -m fallacy_warn serve` | Working; one model needs retraining |
| [evaluaters](evaluaters/) | Two AI-engineering pieces: a harness that scores structured extraction, and typed GitHub tools for a triage agent | `python -m harness run --cases cases.jsonl` | Phase 1 scaffold |
| [trail](trail/) | A voxel diorama a camera walks through on a timeline, for recording video. Hand-written WebGL2, no engine | open `index.html`, or `npm run serve` | Runs; mid-redesign |
| [whereyago](whereyago/) | A day logger: record a good day out stop by stop, browse and copy other people's | `docker compose up` plus `npx expo start` | Vertical slice; sharing unbuilt |
| [snowball](snowball/) | Branching idea builder: a seed thought grows into a tree you can export as an essay | open `index.html` | Prototype |
| [tektak](tektak/) | A hand-curated tracker for online drama, written as summaries rather than video | open `index.html`, `admin.html` to edit | Prototype |
| [story generator](story%20generator/) | Turns a story told in beats into a tree that reveals itself one beat at a time, for narration | open `breakdown-takes.html` | Prototype, two versions |
| [resume](resume/) | An interactive resume that never scrolls: six colour-coded sections, all movement lateral | open `index.html` | Finished |

The browser apps are one HTML file plus Tailwind from a CDN and `localStorage`. No build, no server,
no accounts. The Python projects use Docker Compose and PostgreSQL, and their tests run with `pytest`.

## Live

- Pneumonia detector: <https://pneumonia-x9mz.onrender.com/>
- Client work: <https://www.kcsportsdirectory.org/>, <https://kidscloset.biz/>

The rest run locally today. Hosting the whole repository behind one domain is the next piece of work,
which is why herder's own plan treats hosting as a portfolio-level task rather than its own.

## Notes

- **`index.html` at the root** is a side-scrolling navigator - you walk a character to a signpost to
  open a project. It currently links two of them and predates most of what is here.
- **[DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md)** puts the repository behind one domain: the
  browser apps on GitHub Pages, published by `.github/workflows/pages.yml` on every push, and
  mailman live on a small server from `deploy/docker-compose.prod.yml`.
- **No hosted model keys where it can be avoided.** herder runs every model locally by design;
  fallacysuspect trains and serves its own classifiers. Where a hosted model genuinely is the subject
  being measured, the key comes from the environment and is never committed.
