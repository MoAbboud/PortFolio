# evaluaters — two AI-engineering projects

Two small, honest projects that show you can build **around** LLMs like a
software engineer, not just call them. Together they tell one story: you can
*measure* model behavior (Project A) and *safely act* on it (Project B), and
you can point the first at the second to prove the second works.

| | Project A — eval-harness | Project B — triage-agent |
| --- | --- | --- |
| **What** | Score a model's structured extraction | An agent that labels GitHub issues, gated by you |
| **Core skill it proves** | Measurement, regression tracking, LLM-as-judge | Tool design, agent loops, safety guardrails |
| **Language** | Python + Anthropic SDK | Python + GitHub REST |
| **Status** | Phase 1 scaffold ✅ | Phase 1 tools ✅ |

Both are built in **phases**, on purpose — the git history shows the discipline,
and each has a `DECISIONS.md` logging every judgment call (your interview script).

---

## Why these two, for an AI resume

The AI job market is flooded with "I called the OpenAI API" demos. What's
scarce is engineers who treat an LLM as an *unreliable component in a system*:

- **Project A** is the evaluation muscle. Anyone can get a model to answer;
  proving it answers *correctly and consistently across versions* is the hard,
  valuable part. Deterministic scorers + an LLM judge + regression diffs is
  exactly what production AI teams do.
- **Project B** is the agent muscle done responsibly. The interesting content
  isn't "the LLM picked a tool" — it's the **safety policy**: confirmation
  gates on side effects, a step cap, and graceful handling of bad tool
  arguments. That's the part that separates a toy from something you'd let near
  a real repo.

The payoff is Project B's **Phase 4**: you point Project A's harness at the
agent and measure task success + how often each guardrail fired. Evaluating
your own agent with your own harness is a genuinely senior move.

---

## The software-engineering techniques on display

You asked to use SE technique to master this. Here's what each project
deliberately demonstrates, so you can point to it:

- **Separation of concerns / dependency inversion** — the harness's runner,
  scorers, and storage never import each other's internals; they meet at typed
  dataclasses and an ABC. The agent's tools meet the (future) loop at four plain
  functions.
- **Program to an interface** — `Scorer` (ABC) and `Runner`/`Runner` (Protocol)
  in A; the tool functions in B. New scorers/providers slot in without edits
  elsewhere.
- **Testability by injection** — the eval runner takes its model client, the
  GitHub client takes its HTTP session. Both let tests run offline.
- **Fail loudly, typed** — no swallowed errors; status codes and API faults
  become specific exception types callers can branch on.
- **Config, not secrets, in code** — every key/token comes from an env var.
- **Small, observable units** — the harness counts its own retries; the agent's
  side effects are named and gated.

---

## Phase roadmap (both projects)

Each project's README has the detail; the shape is the same:

```
Phase 0  you      define the contract (schema / job + tools)          done
Phase 1  build    scaffold: typed pieces, wired, testable             done  <-- you are here
Phase 2  mixed    the intelligence (scorers / agent loop + policy)
Phase 3  build    regression tracking / adversarial hardening
Phase 4  you      grow the eval set / point A at B
```

## Getting started

Each subfolder is self-contained:

```bash
cd eval-harness   && cat README.md   # Project A
cd triage-agent   && cat README.md   # Project B
```

Both use a local `.venv` and `requirements.txt`; neither needs a paid service
to *develop* (Project A needs an Anthropic key only to actually call the model;
Project B's tests run fully offline).
