# herder - browser prototype

A page you can paste a chat into. It runs herder's extraction, render and residue steps entirely in
the browser - no server, no database, no model download, no key - and shows the brief they produce.

Built so herder can be demonstrated on a free static host. The full system needs PostgreSQL with
pgvector, Ollama and a DeBERTa cross-encoder, which is why [the deployment
guide](../../DEPLOYMENT-GUIDE.md) lists it as not hosted.

**Nothing in `herder/` was changed to add this.** Everything here is additive and read-only against
the app. The one exception is outside herder: two lines in `deploy/build-static.mjs` that publish
this folder.

## Running it

Open `index.html`. That is all - it is one self-contained file, so a double-click works and so does
a USB stick. Hosted, it is `/herder/prototype/` on the static site.

It needs the network for one thing only: Tailwind from a CDN, as the other browser apps here do.
Offline the page works and looks unstyled. Removing that last dependency means replacing Tailwind
with hand-written CSS, which has not been done.

**Why one file rather than three modules.** A module is fetched, and a fetched script is refused
unless it arrives as JavaScript. Python's `http.server` on Windows reads MIME types from the
registry and serves `.js` as `text/plain`, so the obvious way to look at this locally - `python -m
http.server` - was the one way that silently did not work: no styling, no output, an error only in
the console. `deploy/_headers` sets `nosniff`, which closes the same door on any host that guesses
wrong. Inlining removes the failure rather than documenting it.

## What runs here, and what cannot

The pipeline is capture, extract, **merge**, render, serve, verify. Three of those are pure
functions over text; one is not.

| Step | Here | Why |
| --- | --- | --- |
| Capture | yes | Splitting a transcript into turns is string work. Accepts `User:`/`You:`/`Human:` and `Assistant:`/`Claude:`/`ChatGPT:`, which is what a copied chat actually looks like |
| Extract | yes, unchanged | Rules over the user's turns. No weights - the shipping extractor never had any |
| Merge | **no** | Needs `all-minilm` embeddings and `cross-encoder/nli-deberta-v3-base`. Gigabytes |
| Render | yes, unchanged | Priority ordering under a budget, pure |
| Residue | yes, unchanged | Sentences no entry carries, pure |
| Serve / verify | no | A resume pack needs no logic; a checkpoint needs the grader, which is the same NLI model |

**What losing merge costs, stated plainly on the page too.** Merge decides whether a new claim
repeats a stored one, refines it, or **retires** it. Without it this page cannot resolve a change of
mind, so it does the honest half: it finds the sentences that announce one, with the same
`CHANGE_CUE` regex the real merge step uses, and marks them - while still listing the claim they
replace. Load the sample and you can see it: "Stock is rounded to the nearest 100 grams" sits three
lines above "keep stock exact to the gram". The full pipeline retires the first. That gap is the
demo's most useful moment, so it is labelled rather than hidden.

Token counts here are **estimates** (`max(chars/4, words)`). The real pipeline counts with cl100k,
which is a vocabulary file too large to ship for this. Every number on the page says "estimated",
because a demo that prints an exact-looking figure it cannot compute is worse than one that admits
the approximation.

## Why the rules are generated

`rules.generated.js` is written by `generate.py`, which imports the Python modules and reads the
patterns off the compiled regex objects. Nothing is retyped. Two hand-maintained copies of a rule
is the drift this project already went out of its way to avoid once - `domain/sentences.py` exists
so that extraction and residue cannot split sentences differently.

```powershell
.\.venv\Scripts\python prototype\generate.py
```

| File | What it is | |
| --- | --- | --- |
| `index.html` | The page a visitor loads, everything inlined | **generated** |
| `rules.generated.js` | herder's patterns and tables as data | **generated** |
| `page.html` | The HTML shell, with a `/* BUNDLE */` placeholder | source |
| `herder.js` | The ported pipeline: capture, extract, residue, render | source |
| `ui.js` | The page logic: stats, the brief, the reversal notice | source |
| `generate.py` | Writes both generated files | source |
| `parity.mjs` | Runs the port over the benchmark conversations | source |
| `smoke.mjs` | Executes the built page against a stub DOM | source |
| `tests/test_parity.py` | The guard | source |

Only `index.html` is published. Everything else is build and test machinery and stays in the repo.

## The guard

```powershell
.\.venv\Scripts\python -m pytest prototype
```

21 tests, and they fail in four distinct ways:

- **Stale** - regenerating changes a checked-in generated file, so a rule moved in Python, or
  `page.html`/`ui.js`/`herder.js` changed and the page was not rebuilt.
- **Parity** - the JavaScript disagrees with `heuristic.py` on the eight benchmark conversations.
  Generating the patterns does not protect the hand-ported *algorithms*; this is what does.
  Extraction and residue are compared candidate by candidate, in order, on all eight.
- **The page** - `smoke.mjs` runs the built script against a stub DOM, clicks "Load a sample", and
  checks a brief came out with the ordering and the reversal notice in it. Without this a UI mistake
  shows up as a blank panel and no error the author will see. It caught two things already: a budget
  read as `0` rendering an empty brief, and the MIME problem above.
- **Self-containment** - the published page must not reach for a file that is not published.

One test asserts the rule that outranks every other rule, on what a visitor actually sees: nothing
an assistant said ever reaches the brief.

The tests live here rather than in `tests/`, so the app's suite is untouched. They skip when `node`
is not installed.

## What this is not

Not a second implementation of herder, and not where its behaviour is decided. The Python is the
system; this is a window onto three of its six steps. The measured results - 0.88 recall at a
3,000-token budget, none of 40 reversed claims carried forward, against 0.21 for a plain summary -
come from the real pipeline on the real corpus, and are in [the repository README](../README.md) and
[NOTES.md](../NOTES.md).
