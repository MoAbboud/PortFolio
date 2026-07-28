# eval-harness - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 2 - Scoring

The current work. Deterministic first, judge last.

- [ ] Well-formedness scorer: does the output parse into the expected shape at all
- [ ] Confirm it catches malformed output rather than erroring on it
- [ ] Field comparison scorer: compare against the expected answer field by field
- [ ] Report which fields differ in the detail, not just a pass or fail
- [ ] Decide which fields must match exactly and which tolerate a variant wording
- [ ] Model-as-judge scorer for the fields exact matching is too strict for
- [ ] Work out how the judge itself is validated before trusting it
- [ ] Wire the scorers into the run so scores are written alongside responses
- [ ] Add a mode that scores responses already stored, without calling the model again

## Stage 3 - Regression tracking

- [ ] Diff two runs per case per scorer
- [ ] Report what moved, in which direction, and by how much
- [ ] Decide what size of movement is worth reporting on the current case set
- [ ] Surface the retry counts, so a run that barely completed is visible

## Stage 4 - Grow the case set

- [ ] Find or write fifty to a hundred realistic tickets
- [ ] Label them by hand
- [ ] Make sure the set covers the failure modes written down in stage 0, not just the
      cases the model already handles
- [ ] Confirm identifiers stay unique as the file grows

## Stage 5 - Evaluate the sibling agent

- [ ] Define, jointly with the triage agent, what task success means
- [ ] Define what "a guardrail fired" looks like as a measurable event
- [ ] Implement a runner that drives the agent instead of the model directly
- [ ] Build a case set of issues with known correct triage outcomes
- [ ] Measure task success and guardrail firing rate

## Done and verified

- [x] Task chosen, expected output shape fixed, failure modes written down
- [x] Eight cases labelled by hand
- [x] Case loader reading line-delimited cases, reporting bad lines by line number
- [x] Duplicate case identifiers rejected at load
- [x] Runner with its own retry and backoff, returning raw text unmodified
- [x] Retry count carried in response metadata
- [x] Scorer contract defined as an abstract base class
- [x] Results store with separate run, response and score tables, opened as a context
      manager
- [x] Command line that assembles the parts and runs a case file
- [x] Provider library imported lazily, so the loader, store and command line work without
      it installed
- [x] Verified end to end: a run collects raw responses under a fresh run id

## Blocked

| Task | Waiting on |
| --- | --- |
| Everything in stage 5 | A definition of agent task success, agreed with the sibling project |
| Judge scorer | A decision on which fields tolerate a fuzzy match |

## Explicitly not doing

- Repairing, reformatting or retrying model output to improve a score.
- Forcing structured output mode, which would hide the failure the harness exists to catch.
- Drawing conclusions from percentages on a set of eight cases.
