# codevscode - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

Every stage is checked from a PowerShell terminal on Windows. If a stage cannot be checked
that way, it is not finished. Every stage that changes a page is also checked in a real
browser.

Planning only. Nothing below stage 0 has started.

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
- [ ] The author confirms the fine-tune route and the naming ("fine-tuned from"), and says
      whether a from-scratch experiment is wanted

## Stage 0 - Scaffold and one challenge

- [ ] `codevscode/` layout: `codevscode/` package, `migrations/`, `tests/`, `challenges/`,
      `judge/`, `web/`, `notebooks/`, `Dockerfile`, `docker-compose.yml`, `requirements.txt`
- [ ] FastAPI with `/health`; PostgreSQL in Compose; Alembic with an empty first migration
- [ ] `.github/workflows/test-codevscode.yml`: pytest against a real PostgreSQL service
- [ ] Decide where the hidden halves of challenges live; gitignore rule in place before any
      hidden file exists
- [ ] The challenge format as `challenge.toml` plus folders; `python -m codevscode.challenges
      validate <slug>`
- [ ] The sample challenge written by hand: brief, interface, starter, five to eight hidden
      requirements, reference app, hidden tests in all four categories, three or more planted
      bugs, house findings, two scripted conversations
- [ ] Authoring hours recorded in the context log

Check:

    cd codevscode
    docker compose up -d
    Invoke-RestMethod http://localhost:8000/health
    docker compose exec web pytest
    docker compose exec web python -m codevscode.challenges validate sample

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
