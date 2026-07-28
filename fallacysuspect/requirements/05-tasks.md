# fallacysuspect - Task list

Status key: `[ ]` not started, `[~]` in progress, `[x]` done, `[!]` blocked.

## Stage 5 - Model quality

The only stage that matters right now. Everything else is finished or waiting on it.

Retraining is done and the transformer stage is now the primary pairing. The flagship miss
is fixed. Retraining did not fix everything, and what it surfaced is now the live work.

- [x] Retrain both stages on the improved data using the prepared notebook on a free hosted
      GPU. Local CPU training works but is too slow to iterate on
- [x] Widen the training data by reconciling the three sources: add the previously unused
      climate set, recover the collapsed pattern from its original label, drop the two
      unlearnable classes, and feed the educational fallacies to the detector as positives
- [x] Check the honest per-epoch real-world metrics before accepting the run, selecting the
      epoch, encoder and threshold on validation and scoring test once
- [x] Place the new model files where the application looks for them, as a second model set
- [x] Confirm the newer data version is auto-selected with no code change
- [x] Re-run the sample transcript and confirm the false dilemma is now caught
- [ ] Record the refreshed measured numbers in `00-plan.md` once the detector over-firing
      below is addressed

### Discovered during stage 5, now the live work

- [ ] Rebalance the detector. On a real debate transcript it fires on almost every
      argumentative sentence, because its positives outnumber its negatives roughly four to
      one and it learned "sounds like debate" rather than "is a fallacy". This is a data
      problem, not a threshold problem
- [ ] Improve the typer, still the weaker stage. Merge the pairs it consistently confuses
      and measure whether cleaner separation sharpens its probabilities
- [ ] Fix the sentence splitter. Hard-wrapped lines and stray quotation marks split a
      sentence mid-way, so a highlighted span can start or end in the middle of a sentence
- [ ] Assess whether the labelled real-world corpus is large enough for the class count
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
- [x] Detector threshold set per model family after discovering one shared threshold was
      discarding most real findings from the flatter-scoring family
- [x] Models made self-describing, carrying their own class list and data version, so the
      application picks the better pairing per stage without being told
- [x] Retrained the transformer stage on the reconciled three-source data, and installed it
      as a second model set the application defaults to as the newest
- [x] A transformer detector ships the decision threshold measured for it, so the number
      travels with the model instead of living as a guess in configuration
- [x] Moved from three independent gates to a combined score, after measurement showed the
      type gate was discarding correctly-detected fallacies the typer could not confidently
      name. The old gate behaviour is retained as an opt-in mode
- [x] A model switcher in the interface: install several model sets and pick which one runs,
      with the report tagged by the model that produced it
- [x] Sample transcript brought from seventy-five findings to a reviewable handful, and the
      flagship false dilemma, previously missed, now caught

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
