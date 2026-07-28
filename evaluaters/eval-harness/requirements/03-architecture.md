# eval-harness - Architecture

Internal document. Credentials are referred to by environment variable only.

## Components

A single command-line process with a file store. Not distributed.

```mermaid
flowchart LR
    subgraph proc[One process]
        CLI[Command line]
        LOAD[Case loader]
        RUN[Runner]
        SC[Scorers]
        ST[Result store]
    end
    FILE[(Case file)] --> LOAD
    LOAD --> RUN
    RUN --> ST
    RUN --> SC
    SC --> ST
    ST --> DB[(SQLite results file)]
    RUN -->|HTTPS| PROV[Model provider]
```

## Layers

The dependency rule: the runner, the scorers and the store never import each other. They
meet at typed data objects and at two abstractions. That is what allows a scorer to be
added without touching the runner, and a provider to be swapped without touching either.

```mermaid
flowchart TB
    M["models - Case, ModelResponse, ScoreResult<br/>plain typed data, no behaviour"]
    C["cases - reads the case file into Case objects"]
    R["runner - Runner protocol, one implementation"]
    S["scorer - Scorer abstract base, implementations"]
    ST["storage - one row per run, per response, per score"]
    CL["cli - assembles the parts and runs them"]

    C --> M
    R --> M
    S --> M
    ST --> M
    CL --> C
    CL --> R
    CL --> S
    CL --> ST
```

Everything points at the data objects and nothing points sideways. The command line is the
only place that knows about all four.

The provider client is imported lazily inside the runner. That means the loader, the store
and the command line can be exercised without the provider library installed at all, which
keeps most of the harness testable offline.

## Class diagram

```mermaid
classDiagram
    direction LR

    class Case {
        +id: str
        +input_text: str
        +expected_json: dict
    }

    class ModelResponse {
        +case_id: str
        +model: str
        +raw_text: str
        +meta: dict
    }

    class ScoreResult {
        +scorer_name: str
        +score: float
        +detail: dict
    }

    class Runner {
        <<Protocol>>
        +run(case) ModelResponse
    }

    class AnthropicRunner {
        +model: str
        +system_prompt: str
        +max_tokens: int
        +max_retries: int
        +run(case) ModelResponse
        -_backoff(attempt) float
    }

    class RunnerError {
        <<Exception>>
    }

    class Scorer {
        <<Abstract>>
        +name: str
        +score(case, response)* ScoreResult
    }

    class CaseLoadError {
        <<Exception>>
    }

    class CaseLoader {
        +iter_cases(path) Iterator
        +load_cases(path) Case[]
    }

    class ResultsStore {
        +start_run(run_id, model, notes) None
        +save_response(run_id, response) None
        +save_score(run_id, case_id, result) None
        +run_summary(run_id) row[]
        +close() None
    }

    class Cli {
        +run(cases_path) None
    }

    Runner <|.. AnthropicRunner
    AnthropicRunner ..> RunnerError : raises
    CaseLoader ..> Case : produces
    CaseLoader ..> CaseLoadError : raises
    AnthropicRunner ..> Case : consumes
    AnthropicRunner ..> ModelResponse : produces
    Scorer ..> Case
    Scorer ..> ModelResponse
    Scorer ..> ScoreResult : produces
    ResultsStore ..> ModelResponse
    ResultsStore ..> ScoreResult
    Cli --> CaseLoader
    Cli --> Runner
    Cli --> Scorer
    Cli --> ResultsStore
```

`Runner` is a protocol and `Scorer` is an abstract base class. The difference is
intentional. A runner is something that already exists elsewhere and merely has to fit a
shape, so structural typing suits it. A scorer is something written for this harness, and
the base class gives it a name field and a contract it must implement.

`ResultsStore` is a context manager. It opens the database, is used, and closes.

## Retry policy

Retries live inside the runner and nowhere else. A caller asks for one case and either gets
a response or an error; it never sees the attempts in between.

```mermaid
flowchart TB
    START([run a case]) --> CALL[Call the provider]
    CALL --> OK{Success?}
    OK -- yes --> RESP[ModelResponse with raw text and metadata]
    OK -- no --> LEFT{Attempts remaining?}
    LEFT -- yes --> WAIT[Wait, backing off with each attempt<br/>bounded by a maximum delay]
    WAIT --> CALL
    LEFT -- no --> ERR[RunnerError]
```

The harness counts its own retries and carries the count in the response metadata, so a run
that looked fine but took twenty attempts is visible in the record rather than invisible.

## Key sequence - one run

```mermaid
sequenceDiagram
    actor E as Evaluator
    participant C as Cli
    participant L as CaseLoader
    participant R as Runner
    participant P as Model provider
    participant S as Scorer
    participant ST as ResultsStore

    E->>C: run against the case file
    C->>L: load cases
    L-->>C: cases, ids checked for duplicates
    C->>ST: start a run, recording the model
    loop each case
        C->>R: run(case)
        R->>P: request, retrying on transient failure
        P-->>R: text
        R-->>C: ModelResponse with raw text
        C->>ST: save the response unmodified
        loop each configured scorer
            C->>S: score(case, response)
            S-->>C: ScoreResult with a number and an explanation
            C->>ST: save the score
        end
    end
    C->>ST: close
    C-->>E: run id and summary
```

## Rules this architecture is meant to protect

- Raw model output reaches the store unmodified. Nothing cleans, parses or repairs it on
  the way.
- Retry logic belongs to the runner. No other component knows a request can fail.
- Adding a scorer requires implementing one method and nothing else.
- Swapping the system under test requires satisfying one protocol and nothing else.
- Credentials come from `ANTHROPIC_API_KEY` and are never written in source or stored in
  the results file.
- The provider library is imported lazily, so the harness remains largely testable without
  it.
- A duplicate case identifier is an error at load time, because the identifier is a
  database key.
- Errors are typed and raised. Nothing is swallowed.
