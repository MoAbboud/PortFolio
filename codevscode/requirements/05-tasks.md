# codevscode - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked in a real
browser.

Stage 0 is done. Stage 1's first run scored 0 of 42 everywhere; the second run - scaffold, repair turns, teachers - is next.

## Planning

- [x] The idea: two coders, a QA checklist, questions, review, bugs in code they did not
      write, chat-assisted
- [x] The author's answers: working name Code vs Code; our own model, no tokens; a website;
      a "soft engine" about asking and answering the right questions; the helper writes the
      code and the player defends it; players name their helper; coaching in practice, off
      in competition; async first, head-to-head later
- [x] Requirements folder: README, 00 to 05, and the private context log
- [x] "Soft engine" means a light engine, where possible. Players can type by hand. All
      model work on Colab; the author's GPU does not matter
- [ ] The author reads 00-plan and confirms or changes the proposed decisions
- [x] Hugging Face for the weights: yes. Public datasets left out unless needed later; v1
      trains on our own data
- [x] Fine-tuning confirmed ("go for fine tuning"). A small from-scratch model becomes the
      GitHub Pages prototype (stages P1 and P2)
- [x] The model is called cvchelper ("call it the cvchelper model"), described as fine-tuned
      from its base

## Stage 0 - Scaffold and one challenge

Done. 32 Node tests, 4 Python tests; the sample validates. (Later stages add to both: 51 Node and 9 Python after A1.)

- [x] `codevscode/` layout: `codevscode/` (Python package), `migrations/`, `tests/` (pytest),
      `runner/` (shared by browser and Node), `tools/`, `test/` (Node), `challenges/`,
      `Dockerfile`, `docker-compose.yml` (ports 5435 and 8020), `requirements.txt`,
      `package.json`. `judge/`, `web/` and `notebooks/` arrive with their stages
- [x] FastAPI with `/health`, green only at the newest migration; PostgreSQL in Compose;
      Alembic with an empty baseline migration
- [x] `.github/workflows/test-codevscode.yml`: the Node suite plus every challenge validated,
      and pytest against a real PostgreSQL service with `REQUIRE_DB=1`
- [x] Where hidden halves live: in the repo, whole - the author's call. (A gitignore rule for
      them was written and then removed)
- [x] The challenge format in JSON (the browser reads it too); `node tools/validate.mjs <dir>`
- [x] The shared runner: fresh database and module per test, a clock the tests control, query
      counting and query plans for efficiency, stored-value inspection for security
- [x] `node tools/run.mjs <challenge> <app folder>`: any app against the hidden tests, for
      stage 1
- [x] The sample challenge, "Team notes": brief, interface, starter, six hidden requirements,
      reference app, 40 hidden tests in all four categories, six planted bugs each failing
      exactly one test, three house findings, two scripted conversations. The validator
      caught two mistakes in it while it was written (a bug's edit that did not match, and a
      test that could not catch the bug it was for)
- [!] Authoring hours: the sample was written by me in one session, so it does not measure
      the author. The author times the second challenge

Check:

    cd codevscode
    docker compose up -d
    Invoke-RestMethod http://localhost:8020/health
    docker compose exec web python -m pytest -q
    npm install
    npm test
    node tools/validate.mjs challenges/sample

## Stage 1 - Can a browser-sized model build it

The code is built; the runs are the author's, on Colab.

- [x] `helper/prompt.js` and `helper/reply.js`: the helper's prompt and the reply parser, shared
      by the workspace and the harness; `tools/helper.mjs` exposes them to Python
- [x] `codevscode/harness.py`: replays a challenge's scripted conversations through any
      `generate(messages) -> text` and scores the final app with `tools/run.mjs`. Tested with
      fake models: a perfect helper scores 40 of 40, a silent one leaves the starter, broken
      code is reported as not loading
- [x] `notebooks/01-candidates.ipynb`: Part A, every candidate at full precision under
      transformers; Part B, the finalists converted by us to MLC `q4f16_1` and run through
      MLC on Colab's GPU. No Google Drive: the last step zips the results and the 4-bit model
      for the author to download. Gitignored - the author's working copy, uploaded to Colab by
      hand
- [x] The author runs Part A on a T4 and sends the table. Every candidate 0 of 42; in 7 of 8
      runs the app did not load (imports of crypto, sqlite3 or files that do not exist; a
      schema error; replies cut off before the code block closed). The failures are about the
      game's app shape more than coding skill - see the context log
- [x] The sample's starter is a scaffold (routing, readJson, reply/fail, bearerToken, route
      stubs); it loads and passes 1 of 42 (an unknown address answers 404)
- [x] `runner/check.js` and `tools/check.mjs`: what a player sees when the app does not run
- [x] Harness repair turns (`repair_turns`, default 0; the notebook uses 2), tested with fakes
- [x] The helper's prompt states the runtime: no imports, crypto is Web Crypto, the method is
      upper case, the body is text
- [x] Notebook: candidates at 16 bits plus teachers Qwen2.5-Coder 7B and 14B at 4 bits
      (bitsandbytes), REPAIR_TURNS = 2, a `repairs` column
- [ ] The author pushes, uploads the notebook, runs Part A, sends the results zip
- [!] Part B - our own 4-bit conversion - is parked. MLC's converter segfaults inside TVM
      while compiling the quantisation step (MLC nightly, TVM 0.26.dev246), on the GPU and the
      CPU, under Python 3.13 and 3.12. It returns once a model passes Part A, as an ONNX export
      quantised to 4 bits and run by transformers.js, which needs no TVM
- [ ] A bare browser page that loads the best converted build and replays one conversation:
      does it load, time to first token, tokens per second, memory
- [ ] The results in the context log; the gate decided with the author: challenge size, and
      the baseline - the smallest model that passes

Check:

    cd codevscode
    npm test
    .venv\Scripts\python -m pytest -q

## Stage P1 - A tiny model trained from scratch

- [ ] Teacher picked (an open-weights coding model that fits a T4 in 4-bit, licence allows
      training on its outputs)
- [ ] `notebooks/p1-corpus.ipynb`: made-up briefs in the app shape, the teacher writes apps
      and edit conversations; kept only if the app loads in the runner and answers a request
      without crashing; train-split challenges added; held-out never
- [ ] Our own tokenizer trained on the corpus
- [ ] `notebooks/p1-train.ipynb`: a small decoder-only model trained from nothing,
      checkpoints to Drive; size picked from the corpus size
- [ ] Exported to ONNX at 8 bits; size recorded; loads in a browser
- [ ] Through the harness on the sample: valid JavaScript rate, tests passed, beside the base
      models from stage 1

## Stage P2 - The static prototype on GitHub Pages

- [ ] The workspace page in static mode: brief, questions, helper chat, editor, preview, local
      tests in a worker by the shared runner, score card
- [ ] Questions matched in the browser (word overlap first; a sentence model only if it
      measures better on labelled questions)
- [ ] The tiny model as the helper, in the browser
- [ ] In `deploy/build-static.mjs` and the Pages workflow at `/codevscode/`; says plainly it
      is a prototype with a model trained from nothing

## Stage A1 - Planting bugs

Done.

- [x] `analyzer/mutate.js`: twelve operators over app.js and schema.sql, by acorn and source
      splicing; every app.js mutant parses
- [x] `tools/mutate.mjs`: each mutant against the hidden tests in its own process with a time
      limit; the report (mutation score, per operator, the survivors); `--out` dataset rows
- [x] On the sample: 120 mutants, 52% caught at first; two tests added for the gaps it showed;
      57% now
- [x] Tests: each operator on small sources, ids unique, the tiny fixture labelled end to end

Check:

    cd codevscode
    npm test
    node tools/mutate.mjs challenges/sample --out data/mutants-sample.jsonl

## Stage A2 - Rules baseline

- [ ] A rule per operator kind, over one function's source; scored on the rows

## Stage A3 - The classifier

- [ ] The label policy settled with the author (declared or test-confirmed, per operator)
- [ ] Rows from the P1 corpus, labelled by operator
- [ ] `notebooks/a3-classifier.ipynb`: a code encoder fine-tuned on Colab, multi-label over
      the four categories; ONNX at 8 bits

## Stage A4 - Measured and put to work

- [ ] Classifier against rules on held-out challenges, per category; README either way
- [ ] Practice hints, "what you missed", the house's targeting

## Stage 2 - The judge and its sandbox

- [ ] `jobs` table, claim with `FOR UPDATE SKIP LOCKED`, reaper, retries
- [ ] Job image: Node, test runner, sql.js; container flags from 03-architecture
- [ ] Reference passes all hidden tests; each planted bug fails exactly its tests
- [ ] Hostile submissions, one test each: endless loop, memory bomb, fork bomb, network call,
      huge output, reading outside the app folder, writing to the hidden mount
- [ ] A killed worker's job is picked up again; a third failure marks it failed

## Stage 3 - The client

- [ ] Requirements and phrasing vectors loaded from the challenge
- [ ] `POST /attempts/{id}/questions` with rate and length limits
- [ ] Labelled question set for the sample (30 or more); matcher report: recall, false reveals
- [ ] A test that no response ever contains an unrevealed answer or a test name

## Stage 4 - The workspace and the helper

- [ ] Workspace page: brief, questions, chat, editor, preview, local tests, clock
- [ ] App runtime in a worker with sql.js; preview requests routed to it
- [ ] Helper runtime with the stage 1 baseline; prompt assembly and token budget; whole-file
      answers shown as a diff before applying
- [ ] Helper naming, checked against a list
- [ ] Coach rules, practice only; ranked build does not include its code
- [ ] Hand-edit and paste counters

## Stage 5 - Practice match end to end

- [ ] Start, ask, build, submit, judge, score card, without an account
- [ ] Someone other than the author plays it through

## Stage 6 - Review and defend against the house

- [ ] Review view of the house app; filing a finding; finding checks as judge jobs
- [ ] House findings filed against the player's app on submission
- [ ] Fix and concede; fix jobs; the review and defence lines on the score card

## Stage 7 - Accounts and async matches

- [ ] Email-link sign-in through the outbox; Mailpit in development
- [ ] Ranked attempts, pairing, review and defence windows, the house after seven days
- [ ] Score cards published to both sides when defence closes
- [ ] Two real players complete a match

## Stage 8 - Datasets and our model v1

- [ ] Train and held-out split of challenges, fixed and recorded
- [ ] Teacher picked; Colab notebook that generates conversations on train challenges and
      keeps only those whose app passes the hidden tests
- [ ] Data manifest with every licence; prepare scripts that refuse to read a held-out
      challenge, with a test that proves it
- [ ] Colab notebook: QLoRA fine-tune, merge, convert
- [ ] Harness: held-out challenges, several seeds, MultiPL-E JavaScript sanity check
- [ ] Ship or not by the harness; README numbers either way

## Stage 9 - Defence answers graded

- [ ] Reviewer questions and answers in a match; author defence questions per challenge
- [ ] Entailment grading against key points; the author grades a set by hand; agreement
      reported before grades count

## Stage 10 - Enough challenges

- [ ] Authoring checklist and tooling (bug planting from the reference, phrasing helpers)
- [ ] The launch count, from stage 0's hours, written and met

## Stage 11 - Launch hardening

- [ ] Rate limits, reports, moderation pages
- [ ] Training consent, terms, privacy
- [ ] Licences of every model and dataset checked again
- [ ] Name checked
- [ ] Real email relay; backups and a proven restore
- [ ] On the portfolio's server under its own subdomain; root README lists it
