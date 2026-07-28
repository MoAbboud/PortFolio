# triage-agent - Architecture

Internal document. The access token is referred to by environment variable only.

## Components

A single command-line process. Not distributed. Two external services.

```mermaid
flowchart LR
    subgraph proc[One process]
        LOOP[Agent loop<br/>not built yet]
        GATE[Confirmation gate]
        TOOLS[Tool layer]
        CLIENT[Repository client]
        ERRS[Typed errors]
    end
    OP([Operator]) --> GATE
    LOOP --> GATE --> TOOLS --> CLIENT
    CLIENT -->|HTTPS| GH[Repository host]
    CLIENT --> ERRS --> LOOP
    LOOP -->|tool choice| LLM[Language model]
```

The tool layer exists and is tested. The loop and the gate are the next phase. This
document describes both, and marks which is which, because the safety policy was specified
before the loop was written and the loop must be built to it rather than around it.

## The single choke point

Every call to the repository host goes through one private request method on the client.
Nothing else in the codebase performs HTTP.

```mermaid
flowchart TB
    T1[list_open_issues] --> REQ
    T2[get_issue] --> REQ
    T3[add_label] --> REQ
    T4[post_comment] --> REQ
    REQ[_request<br/>the one place HTTP happens] --> RAISE[_raise_for_status]
    RAISE --> MAP{Status}
    MAP -->|401, 403 without rate limit| AUTH[GitHubAuthError]
    MAP -->|404| NF[GitHubNotFoundError]
    MAP -->|403 with rate limit| RL[GitHubRateLimitError]
    MAP -->|5xx| SRV[GitHubServerError]
    MAP -->|transport failure| CONN[GitHubConnectionError]
    MAP -->|ok| BODY[Parsed body]
```

Having one choke point is what makes the error mapping trustworthy. If four tools each did
their own error handling, three of them would eventually be wrong, and a caller could not
rely on catching a specific type.

Every request carries a timeout. A tool that hangs blocks the operator and gives them no
signal; a tool that fails quickly can be retried or reported.

## Class diagram

```mermaid
classDiagram
    direction LR

    class GitHubClient {
        +session
        +repo: str
        +token_env: str
        +list_open_issues() dict[]
        +get_issue(issue_id) dict
        +add_label(issue_id, label) str[]
        +post_comment(issue_id, text) dict
        -_request(method, path, ...) Any
        -_raise_for_status(response)$ None
    }

    class GitHubError {
        <<Exception>>
    }
    class GitHubConnectionError {
        <<Exception>>
    }
    class GitHubAPIError {
        <<Exception>>
        +status_code: int
        +message: str
        +body: str
    }
    class GitHubAuthError {
        <<Exception>>
    }
    class GitHubNotFoundError {
        <<Exception>>
    }
    class GitHubRateLimitError {
        <<Exception>>
    }
    class GitHubServerError {
        <<Exception>>
    }

    class ToolFunctions {
        <<module level>>
        +list_open_issues() dict[]
        +get_issue(issue_id) dict
        +add_label(issue_id, label) str[]
        +post_comment(issue_id, text) dict
        +default_client() GitHubClient
    }

    class AgentLoop {
        <<not built yet>>
        +run(goal) None
        -step_count: int
        -max_steps: int
    }

    class ConfirmationGate {
        <<not built yet>>
        +requires_confirmation(tool) bool
        +ask(tool, arguments) bool
    }

    GitHubError <|-- GitHubConnectionError
    GitHubError <|-- GitHubAPIError
    GitHubAPIError <|-- GitHubAuthError
    GitHubAPIError <|-- GitHubNotFoundError
    GitHubAPIError <|-- GitHubRateLimitError
    GitHubAPIError <|-- GitHubServerError

    GitHubClient ..> GitHubError : raises
    ToolFunctions --> GitHubClient
    AgentLoop --> ConfirmationGate
    ConfirmationGate --> ToolFunctions
```

The error hierarchy is shaped so a caller can be as specific or as general as it needs. A
retry policy catches the rate limit and the server error. A setup check catches the auth
error. Something that just wants to give up catches the base.

The tools are exposed twice: as methods on a client, and as four plain module-level
functions backed by a default client. The methods are what the tests drive, with an
injected session. The plain functions are what the loop will hand to the model, because a
model-facing tool should be a function with named arguments and nothing else.

## The tool set

Four tools, chosen and frozen before anything was built. Two read, two write. The split is
the entire safety story.

| Tool | Effect | Gated | Notes |
| --- | --- | --- | --- |
| `list_open_issues` | Read | No | Follows pagination to the end, so the agent sees the whole backlog rather than the first page |
| `get_issue` | Read | No | One issue in full |
| `add_label` | **Write** | Yes | Returns the resulting label set, so the effect is visible rather than assumed |
| `post_comment` | **Write** | Yes | Returns the created comment |

Across all four, the issue identifier is the issue **number** as the host displays it, not
any internal database identifier. Getting this wrong would apply a label to a different
issue than the one the operator approved, which is precisely the failure the gate exists to
prevent, arriving through the back door.

## Planned control flow

Not yet built. This is the specification the loop is to be written against.

```mermaid
flowchart TB
    START([Start a run]) --> ASK[Ask the model for the next tool call]
    ASK --> VALID{Arguments usable?}
    VALID -- no --> ERRBACK[Return an error to the model]
    ERRBACK --> RETRY{Correction attempts left?}
    RETRY -- yes --> ASK
    RETRY -- no --> NEXT
    VALID -- yes --> SIDE{Does this tool change anything?}
    SIDE -- no --> CALL[Call it]
    SIDE -- yes --> CONFIRM{Operator says yes?}
    CONFIRM -- no --> SKIP[Skip it, record the refusal]
    CONFIRM -- yes --> CALL
    CALL --> RESULT[Give the result back to the model]
    SKIP --> NEXT
    RESULT --> NEXT{Step cap reached?}
    NEXT -- no --> ASK
    NEXT -- yes --> STOP([Stop])
```

Three things in that diagram are the whole point, and none of them are the model:

- The gate sits between the decision and the call, so no write can bypass it.
- The step cap is checked by the loop, not requested from the model.
- A bad argument is fed back as data rather than raised, so the model can correct itself,
  but only a fixed number of times.

## Key sequence - a gated write

```mermaid
sequenceDiagram
    actor O as Operator
    participant L as Agent loop
    participant M as Language model
    participant G as Confirmation gate
    participant T as Tool layer
    participant GH as Repository host

    L->>M: here are the issues, what next?
    M-->>L: add_label(issue 42, "bug")
    L->>G: this tool has a side effect
    G->>O: apply label "bug" to issue 42?
    O-->>G: yes
    G->>T: add_label(42, "bug")
    T->>GH: request, through the single choke point
    GH-->>T: resulting label set
    T-->>L: labels now on the issue
    L->>M: result
    Note over L: step count incremented, cap checked
```

## Testability

The client takes its HTTP session by injection. The tests supply a fake, so the entire tool
layer runs offline with no token and no network. Thirteen tests cover the four tools, the
pagination behaviour and the status-code mapping.

This is why the tools were built first. A tool layer that can only be tested against a live
repository would mean testing write operations against a real repository, which is a bad
idea for the same reason the confirmation gate exists.

## Rules this architecture is meant to protect

- Exactly one place performs HTTP. Adding a fifth tool must not add a second.
- Every status code becomes a specific typed error. Nothing is swallowed and nothing is
  returned as a generic failure.
- Read tools and write tools are distinguishable in code, not just by convention, because
  the gate depends on the distinction.
- The safety policy lives in the loop, never in the prompt. A model cannot be relied on to
  respect a rule it was merely told about.
- The step cap is enforced by the loop, not requested from the model.
- The identifier passed to every tool is the issue number as the host displays it.
- Credentials come from `GITHUB_TOKEN` and the target from `GITHUB_REPO`. Neither appears
  in source.
- Every request has a timeout.
- The tool layer stays testable with an injected session and no network.
