# codevscode - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked in a real
browser.

Stage 0 is done. Stage 1, the model candidates on Colab, is next.

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
- [ ] The author confirms the naming ("our helper model, fine-tuned from ...")

## Stage 0 - Scaffold and one challenge

Done. 36 Node tests, 4 Python tests; the sample validates.

- [x] `codevscode/` layout: `codevscode/` (Python package), `migrations/`, `tests/` (pytest),
      `runner/` (shared by browser and Node), `tools/`, `test/` (Node), `challenges/`,
      `Dockerfile`, `docker-compose.yml` (ports 5435 and 8020), `requirements.txt`,
      `package.json`. `judge/`, `web/` and `notebooks/` arrive with their stages
- [x] FastAPI with `/health`, green only at the newest migration; PostgreSQL in Compose;
      Alembic with an empty baseline migration
- [x] `.github/workflows/test-codevscode.yml`: the Node suite plus every challenge validated,
      and pytest against a real PostgreSQL service with `REQUIRE_DB=1`
- [x] Hidden halves of challenges ignored by the root `.gitignore`, the sample excepted -
      in place before any second challenge exists. Where the private halves are kept is still
      the author's call
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

- [ ] `notebooks/01-candidates.ipynb` for Colab: convert each candidate from its original
      weights to the 4-bit browser format, run it on Colab's GPU through the same runtime
      family, replay the sample's scripted conversations, save the files
- [ ] Three or four candidates from 03-architecture
- [ ] Each candidate's files run against the sample's hidden tests (Node on Colab, by the
      validator's runner, before the judge exists)
- [ ] A bare browser page that loads the best one or two converted builds and replays one
      conversation: does it load, time to first token, tokens per second, memory
- [ ] A results table in the context log: tests passed, valid JavaScript, download size, the
      browser numbers
- [ ] The gate decided with the author: challenge size, and the baseline - the smallest model
      that passes

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
- [ ] Data manifest with every licence; prepare scripts
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
