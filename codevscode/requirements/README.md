# codevscode - requirements

The specification for Code vs Code (working name). When the code and these documents
disagree, one of them is wrong and it gets fixed rather than worked around.

| Document | Contents |
| --- | --- |
| [00-plan.md](00-plan.md) | Build stages, decisions settled by the author, decisions proposed and waiting, open questions, risks |
| [01-overview.md](01-overview.md) | What Code vs Code is and what it does. Public-facing, no internals |
| [02-interaction.md](02-interaction.md) | Actors, the boundary, what it deliberately ignores, use cases, the journeys |
| [03-architecture.md](03-architecture.md) | The pieces: the workspace, the helper model in the browser, the client who answers questions, the judge and its sandbox, findings and defence, scoring, the training pipeline and its harness |
| [04-data-model.md](04-data-model.md) | The challenge format, the database tables, what the browser keeps, the training data |
| [05-tasks.md](05-tasks.md) | The working task list, and how each stage is checked from PowerShell |

[00-plan.md](00-plan.md) is the one to read first: the stage order, the decisions already
settled with the reason each one was taken, and the open questions still outstanding.

**Stages 0, 1, A1 and 2 are done**: the scaffold and the challenge format; the sample
challenge "Team notes" (42 hidden tests, six planted bugs); five Colab runs that picked
cvchelper's base model (Qwen2.5-Coder-1.5B) and the teacher (Qwen2.5-Coder-7B); bug planting
with a mutation score; and the judge - a queue with a reaper and retries, and a locked-down
container that contains every hostile submission tested. Stage 3, the client who answers
questions, is next.

    cd codevscode
    npm install
    npm test                                      runner, validator, rules
    node tools/validate.mjs challenges/sample     the challenge is consistent
    node tools/run.mjs challenges/sample <app>    any app folder against the hidden tests
    node tools/mutate.mjs challenges/sample        what the hidden tests miss
    docker compose up -d
    Invoke-RestMethod http://localhost:8020/health
    docker build -t codevscode-judge -f judge/Dockerfile .
    .venv\Scripts\python -m codevscode.judge.worker   the judge, on the host

Three things worth stating here so they are not discovered as surprises:

- **It is a game about questions, not typing.** Each player has a helper, a coding model they
  name themselves, and the helper writes the code. The player's job is the one a lead or a
  quality analyst does: ask the client the right questions, direct the helper, catch what it
  got wrong, review the other player's app for bugs, and defend their own. The checklist -
  security, efficiency, practicality, correctness - decides who wins, not who typed fastest.
- **The helper is our own fine-tune and it runs in the player's browser.** No hosted model,
  no provider key, no per-request cost. A small open-weights coding model is fine-tuned on
  Colab on our own data, measured against the model it started from, and only shipped if it
  wins. It is called **cvchelper**, and always described as fine-tuned from its base, by name.
- **Matches are asynchronous first.** Two players take the same challenge at different
  times, then review and defend each other's apps over a window of days, like a code review.
  Live head-to-head comes later. Until there are players, the opponent is the house: the
  author's own reference app with bugs planted in it.

The stack follows roamer and mailman - Python, FastAPI, PostgreSQL, Docker Compose - with the
apps the players build written in plain JavaScript, judged in a sandbox with no network.

Commit as the work happens with real messages, because the history is on display.
