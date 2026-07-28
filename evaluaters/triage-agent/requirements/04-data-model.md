# triage-agent - Data model

## Store

There is no database. This is deliberate and worth stating plainly, because it is the kind
of absence a reader assumes is an oversight.

The agent's durable state lives in the repository it operates on. A label that was applied
is on the issue. A comment that was posted is on the issue. Nothing needs a second copy,
and a second copy would immediately be capable of disagreeing with the first.

| Data | Where it lives | Lifetime |
| --- | --- | --- |
| Issues, labels, comments | The repository host | Permanent, owned by the host |
| Configuration | Environment variables | Process lifetime |
| Conversation with the model | In memory | One run |
| Step count | In memory | One run |
| Operator decisions | In memory, and visible in the terminal | One run |

## Configuration

| Variable | Contents | Notes |
| --- | --- | --- |
| `GITHUB_TOKEN` | Access token with write permission | Never in source, never logged |
| `GITHUB_REPO` | The target repository | Determines everything the agent can touch. Wrong value, wrong repository |

The whole blast radius of a run is set by these two values, which is why they are checked
before anything is attempted.

## Shapes the tools work with

Not schemas the project owns. These are the parts of the host's responses the agent
depends on, recorded so a change on their side is recognisable as a break on ours.

### Issue

| Field | Used for |
| --- | --- |
| Number | The identifier passed to every tool. Not any internal database id |
| Title | What the model reads first |
| Body | The description the triage decision is based on |
| Labels | What is already applied, so the agent does not propose a duplicate |
| State | Only open issues are listed |

The number against internal id distinction is the one that matters. Both appear in the
host's responses, both are integers, and using the wrong one silently addresses a different
issue. Every tool in this project takes the number.

### Label

Applied by name. The agent does not create labels, so a name that does not exist on the
repository is an error from the host rather than a new label appearing.

### Comment

Free text, authored as whoever the token belongs to. The comment is attributed to the
account, not to the agent, so anyone reading the issue later sees the account name. That is
a consideration for whichever token is used, not a code detail.

## Pagination

Listing issues follows the host's paging links until there are none left, rather than
returning the first page. An agent that saw only the first page of a backlog would triage
the newest issues and quietly ignore the rest, which looks like working and is not.

## Run record

Nothing is persisted about a run today. When the sibling harness starts measuring this
agent, it will need a record of what happened, and that record is the harness's to keep
rather than the agent's. What the harness will need:

| Fact | Why |
| --- | --- |
| Which tools were called, with what arguments | To judge whether the triage was right |
| Which calls were offered and declined | Refusal rate is a measurement, not a failure |
| How many times the confirmation gate fired | The gate firing is the thing being measured |
| Whether the step cap was reached | A run that hit the cap did not finish |
| How many bad-argument corrections were needed | Model quality signal |
| Which typed errors occurred | Separates agent problems from host problems |

Deciding the shape of that record is a joint decision with the harness project and is
listed as an open question in the plan.

## What is deliberately not stored

- The access token, anywhere except the environment of the running process.
- A local mirror of issues. The repository is the truth.
- Any history of previous runs. Adding one would create state that can disagree with the
  repository.
- Any record of the model's reasoning beyond what appears in the terminal during a run.
