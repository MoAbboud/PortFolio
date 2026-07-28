# triage-agent - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 2 - Agent loop

The current work. Ordered so that there is a point where the agent can think but not act.

- [ ] Loop skeleton with the step cap enforced by the loop, before any tool is wired in
- [ ] Confirm the loop terminates on the cap with no tools available at all
- [ ] Wire in the two read tools only
- [ ] Confirm the agent can list issues, read one, and produce a proposal it cannot apply
- [ ] Decide what the confirmation prompt shows, so a yes is an informed yes
- [ ] Build the confirmation gate between the model's decision and the call
- [ ] Wire the two write tools behind the gate
- [ ] Confirm no write path exists that bypasses the gate
- [ ] Return bad tool arguments to the model as an error rather than raising
- [ ] Bound the number of correction attempts
- [ ] Decide whether a declined action is reported back to the model
- [ ] Confirm a declined action leaves the repository untouched and the run continuing

## Stage 3 - Break it deliberately

- [ ] Pick a repository where a mess does not matter, with write access
- [ ] Decide which account the comments are attributed to
- [ ] Feed it issues written to confuse it: empty bodies, contradictory titles, issues that
      are already labelled, issues that are not issues
- [ ] Feed it a label that does not exist on the repository
- [ ] Feed it an issue number that does not exist
- [ ] Trigger a rate limit and confirm the typed error is distinguishable from a failure
- [ ] Log every failure with what happened and what was changed in response
- [ ] Adjust the policy where it did not hold, and record why

## Stage 4 - Measurement

- [ ] Define task success, jointly with the harness project
- [ ] Define what "a rule fired" looks like as a measurable event
- [ ] Decide who owns the run record - probably the harness, since the agent keeps no state
- [ ] Provide whatever entry point the harness needs to drive a run
- [ ] Build a case set of issues with known correct triage outcomes
- [ ] Report task success, gate firing rate, decline rate, cap-reached rate, and correction
      counts

## Done and verified

- [x] The job, the four tools, and which two have side effects, all fixed before any code
- [x] The safety policy written down before the agent existed
- [x] Two read tools: list open issues, get one issue
- [x] Two write tools: add a label, post a comment
- [x] Pagination followed to the end when listing, so the whole backlog is visible
- [x] One private request method as the only place HTTP happens
- [x] Status codes mapped to specific typed errors in a hierarchy
- [x] HTTP session injected, so the tool layer tests offline with no token
- [x] Timeout on every request
- [x] The issue number, not the internal id, used as the identifier everywhere
- [x] Tools exposed as plain functions as well as client methods, ready for the loop
- [x] Configuration read from the environment, with a check that credentials resolve
- [x] Thirteen tests covering the tools, pagination and status-code mapping - all pass with
      no network

## Blocked

| Task | Waiting on |
| --- | --- |
| Everything in stage 4 | A definition of task success, agreed with the harness project |
| Stage 3 | Choosing a repository to run against and an account to comment as |

## Explicitly not doing

- An unattended mode. Removing the human is the opposite of the point.
- Closing, reopening, assigning or editing issues.
- Creating or deleting labels.
- Any local copy of repository state.
- Putting the safety policy in the prompt.
