# fallacysuspect - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 5 - Model quality

The only stage that matters right now. Everything else is finished or waiting on it.

- [ ] Retrain both stages on the improved data using the prepared notebook on a free hosted
      GPU. Local CPU training works but is too slow to iterate on
- [ ] Check the honest per-epoch real-world metrics before accepting the run
- [ ] Reject the run if its real-world numbers are worse than the current pairing
- [ ] Place the new model files where the application looks for them
- [ ] Restart and confirm the newer data version is auto-selected with no code change
- [ ] Re-run the sample transcript and confirm the false dilemma is now caught
- [ ] Confirm the false alarm rate has not regressed
- [ ] Record the new measured numbers in `00-plan.md`, replacing the current table
- [ ] Re-check whether the per-model-family detector thresholds are still calibrated for
      the retrained models

## Stage 5 - Follow-ons, only if retraining is not enough

- [ ] Assess whether the labelled real-world corpus is large enough for fourteen classes
- [ ] Try classifying per speaker turn rather than per passage, and measure whether it helps
- [ ] Work out the highlighting consequences before committing to turn-level classification

## Stage 6 - Deployable

- [ ] Decide what quality is acceptable on a free host, given the weak light typer
- [ ] Regenerate the light model exports on the machine that will run them, so the
      serialised files match the installed library versions
- [ ] Add the hosting configuration, production server and entry point
- [ ] Confirm the transformer weights and the datasets stay out of the repository
- [ ] Confirm the light pairing runs inside the free tier memory limit
- [ ] State the model limitation plainly wherever it is deployed

## Maintenance

- [ ] Decide what happens to stored transcripts over time. Every analysis keeps the full
      text and nothing prunes it
- [ ] Note in the interface that stored analyses contain the transcript verbatim

## Done and verified

- [x] Transcript in, warnings out, in the browser and from the terminal
- [x] Live progress that advances through the text and shifts colour as findings accumulate
- [x] Single-page morph into transcript and report with no reload, and hover linking a
      highlight to its finding
- [x] Every analysis recorded, and listable afterwards
- [x] Moved off the paid backend onto locally trained models, with the paid path kept as a
      fallback behind the same contract
- [x] Dataset builder that merges the public sources, adds the missing pattern to reach
      fourteen classes, and splits the real-world material by document
- [x] Real-world negatives included in training, which was the fix for a detector that
      flagged ordinary prose
- [x] Quality measured on held-out real-world documents rather than on the training
      distribution
- [x] Three gates in place: minimum length, detector confidence, type confidence
- [x] Detector threshold set per model family after discovering one shared threshold was
      discarding most real findings from the flatter-scoring family
- [x] Models made self-describing, carrying their own class list and data version, so the
      application picks the better pairing per stage without being told
- [x] Sample transcript brought from seventy-five findings to twelve

## Blocked

| Task | Waiting on |
| --- | --- |
| Everything in stage 6 | Stage 5. There is no point deploying the current model quality |
| Recalibrating thresholds | The retrained models existing |

## Explicitly not doing

- Collecting any information about the person using the tool. Declined, and not revisited.
- Adding a verdict, a winner, or a per-speaker score.
- Running training inside the application.
- Returning to Docker as the run path.
