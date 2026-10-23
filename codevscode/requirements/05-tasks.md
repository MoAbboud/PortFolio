# codevscode - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked in a real
browser.

Stage 0 is done. Stage 1's first run scored 0 of 42 everywhere; the second (scaffold, repair turns, teachers) got a browser-sized model to 12 of 42. Reading its apps is next.

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
- [x] Run 2 on Colab's free tier (pasted output, 2026-10-12). Qwen2.5-Coder-1.5B 12 of 42
      asking nothing (6 correctness, 4 security, 2 practicality) but 2 asking everything;
      0.5B 1 and 0; Qwen3-1.7B 0 (does not load after 2 repairs) and 1; SmolLM2 1 and 1, its
      8,192-token context smaller than our 8,776-token prompt; 7B teacher at 4 bits 0 (does not
      load) and 3; 14B out of GPU memory in attention. Most apps now load
- [x] Run 3 (free-tier notebook, results zip read 2026-10-12): identical scores to run 2 -
      greedy decoding is reproducible. The apps explained both puzzles: (1) a harness bug - the
      helper's earlier replies were replayed with code shortened to "[wrote app.js]", models
      copied that and wrote nothing, so every turn after the first, repairs included, was a
      no-op; (2) one crash at the gate decides the score - asks-everything's PBKDF2 instruction
      led the 1.5B to misuse Web Crypto ("Unrecognized algorithm name") in signup, blocking 36
      tests; asks-nothing's simpler hashing got through signup and login, then createNote crashed
- [x] Prompt fixed: each turn is one system and one player message; earlier player requests are
      listed in the system message; the helper's replies are never replayed
- [x] Run 4 (2026-10-21, after the prompt fix was pushed): later turns now write code. The 7B
      at 4 bits, told everything, reached 13 of 42 (8 correctness, 4 security) after three turns
      and one repair; the 1.5B is unchanged (12 asking nothing, 2 asking everything). Every app
      still dies on one crash in the main path - a deleted scaffold helper (bearerToken,
      readJson), a Web Crypto call that does not exist, an undefined value bound to SQL - and
      the repair turns never saw them: the check only tried GET / and POST /
- [x] `public/smoke.json` for the sample and check.js walking it: crashes along sign up, log in
      and the note routes are now what a repair turn passes back. Validator checks the
      walk-through is well formed and the reference walks it cleanly. Tests: 57 Node, 12 pytest
- [x] Run 5 (2026-10-21): repair turns that see the walk-through's crashes work. The 7B at 4
      bits, told everything, reached 20 of 42 (13 correctness, 4 security, 3 practicality) and
      is the first app to finish with no crash at all; the 1.5B told everything went 2 -> 10.
      Every run used both repair turns; several still crash, and the 1.5B repeated one reply
      twice. The 7B's remaining failures are mostly two stubs: a fake token ("generated_token",
      every user is user 1) and a validation that refuses an empty note body
- [x] The stage 1 gate ("go for it"): baseline Qwen2.5-Coder-1.5B, teacher Qwen2.5-Coder-7B,
      Team-notes size, teacher data kept if crash-free and at least half the hidden tests, A1
      mutation pairs as a second source
      (waiting on the free-tier GPU limit to reset; the notebook now stops early without a GPU)
- [x] Notebook fitted to the free tier: SmolLM2 and the 14B removed with the reasons in the
      cell; a model that runs out of GPU memory is skipped and the rest carry on
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

Done. 37 pytest (nothing skipped with the database and Docker up), 57 Node.

- [x] `jobs` table (migration 0002), claim with `FOR UPDATE SKIP LOCKED`, complete, fail with
      retries, reaper - tested against PostgreSQL, including a claim skipping a row another
      worker holds
- [x] `judge/Dockerfile` (253 MB) and `judge/entry.mjs`: frozen intrinsics, locked globals,
      the permission model, a nonce-marked result written by a captured writeSync
- [x] `codevscode/judge/sandbox.py`: the container flags, wall-clock limit, output cap,
      verdicts; sandbox failures told apart from the app's by what Docker prints
- [x] In the sandbox: the reference passes 42 of 42; each planted bug fails exactly its tests;
      the house's findings run as their own job kind
- [x] Hostile submissions, one test each: endless loop, memory bomb, spawning processes,
      network, writing files, flooding output, exiting early, exiting 125, forging a result
      line, tampering with built-ins. (Reading the hidden tests is allowed: challenges are public)
- [x] `python -m codevscode.judge.worker`: reaps, claims, runs, records; a job naming no real
      challenge is done with an error, not retried; a sandbox failure is retried then failed
- [x] CI builds the judge image and runs the sandbox tests with REQUIRE_DOCKER=1

Check:

    cd codevscode
    docker compose up -d db
    .venv\Scripts\python -m alembic upgrade head
    docker build -t codevscode-judge -f judge/Dockerfile .
    .venv\Scripts\python -m pytest -q
    .venv\Scripts\python -m codevscode.judge.worker --once

## Stage 3 - The client

Done. 50 pytest, 58 Node.

- [x] Requirements and phrasing vectors from the challenge folder, built once per challenge
      version and kept in memory (no challenges or requirements tables - files are enough)
- [x] Two matchers (lexical, embedding) and `python -m codevscode.client.report`: recall, wrong
      and false reveals per threshold; embedding chosen, 16 of 28 at 0.65 against lexical 2
- [x] `hidden/questions.json`: 45 labelled questions, 17 that must reveal nothing; the
      validator checks every label and that both kinds exist. Written by Claude - questions
      the author writes are the better test
- [x] `attempts` and `questions` tables (migration 0003); `POST /attempts`,
      `GET /attempts/{id}`, `POST /attempts/{id}/questions`, with length, count and rate limits
- [x] The leak test: no response carries a requirement key, a phrasing, a test or bug id, or an
      answer the question did not unlock
- [x] The model baked into the web image; cached in CI

Check:

    cd codevscode
    docker compose up -d --build
    .venv\Scripts\python -m codevscode.client.report challenges/sample
    $a = Invoke-RestMethod -Method Post http://localhost:8020/attempts -ContentType application/json -Body '{"challenge":"sample"}'
    Invoke-RestMethod -Method Post "http://localhost:8020/attempts/$($a.id)/questions" -ContentType application/json -Body '{"text":"Should accounts lock after too many failed logins?"}'

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
