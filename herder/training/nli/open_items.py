"""The pairs no public corpus provides: an open item about a claim is not a replacement for it.

Every checkpoint measured in `bench/nli_compare.py` got this wrong, and it costs real entries: in the
benchmark run of 2026-09-15, "Something unresolved - two laptops are still waiting for their Windows 11
upgrade." retired "all staff laptops run Windows 11 Pro." Both are true. The second is an open question
*about* the first, and a memory that deletes the settled fact when someone mentions an exception has
lost the thing worth keeping.

Eight relations are generated, all in herder's own shape (two short claims):

- `open_item`            an unfinished item about a claim                  -> neutral       (distinct, keep both)
- `coexisting`           another attribute of the same subject, also true  -> neutral       (distinct)
- `unrelated`            two claims with nothing in common                 -> neutral       (distinct)
- `restatement`          the same claim said again                         -> entailment    (duplicate)
- `changed`              the same attribute given a new value              -> contradiction (supersede)
- `announced_change`     a lead-in announcing a change, then a new value   -> contradiction (supersede)
- `announced_elsewhere`  a lead-in announcing a change to something else   -> neutral       (distinct)
- `announced_same`       a lead-in that lands back on the held value       -> entailment    (duplicate)

The three `announced_*` shapes were added for the second training run, after the first lost a real
reversal ("Forget the 10,000 words I mentioned before - the limit is 7,500") because no training pair
had a lead-in at all.

`changed` and `restatement` are here so the file cannot teach "anything similar is neutral": the model
has to keep the distinction between an exception, a restatement and a replacement, which is the point.
`coexisting` is the shape that costs entries today - "No evening opening." retired by "Opening hours
will be 7am to 4pm", two claims that are true together.

**Vocabulary is deliberately unlike the benchmark's.** Different domains, names and nouns, so that
nothing here can teach the answer key. `build_dataset.py` also drops anything matching a benchmark
sentence outright.
"""

from __future__ import annotations

import itertools
import random

# (subject, attribute phrase, first value, replacement value, an exception that does not replace it,
#  a sibling claim about the same subject that is true at the same time)
FACTS = [
    ("the parts store", "opens at", "half past seven", "nine in the morning", "it stayed shut last Monday for stocktaking", "it never opens on a Sunday"),
    ("the night shift", "is staffed by", "four technicians", "six technicians", "one of them is off sick this week", "the day shift is larger"),
    ("the loading bay", "is cleaned", "every evening", "twice a day", "nobody cleaned it over the holiday", "the bay is lit all night"),
    ("the archive room", "is locked with", "a keypad", "a card reader", "the keypad battery has been flat since Friday", "the room has no windows"),
    ("the delivery van", "is serviced", "every six months", "every three months", "the last service was missed", "the van is kept in the yard overnight"),
    ("the tasting notes", "are written in", "a shared notebook", "a spreadsheet", "last week's notes were never written up", "the notes are kept for five years"),
    ("the greenhouse", "is watered by", "a timer", "the gardener", "the timer failed twice in June", "the greenhouse has three benches"),
    ("the reading group", "meets on", "Wednesday evenings", "Saturday mornings", "two members can rarely make it", "the group reads one book a month"),
    ("the ferry", "runs", "hourly", "every forty minutes", "it was cancelled in the storm", "the crossing takes twenty minutes"),
    ("the museum", "charges", "eight pounds", "twelve pounds", "schools sometimes get in free", "the museum has two floors"),
    ("the bakery counter", "closes at", "four", "six", "it shuts early on bank holidays", "the counter takes orders until closing"),
    ("the pottery studio", "fires the kiln", "on Tuesdays", "on Thursdays", "the kiln has been broken since spring", "the studio has two wheels"),
    ("the swimming lane", "is reserved for", "the club", "beginners", "the club skipped two sessions", "the pool is twenty-five metres long"),
    ("the allotment tap", "is turned off", "in November", "in October", "somebody left it running last winter", "the plot is at the far end"),
    ("the lighthouse", "is painted", "every four years", "every two years", "the painters never finished the north side", "the lamp is visible for miles"),
    ("the village hall", "is heated by", "oil", "a heat pump", "the boiler is unreliable in February", "the hall seats ninety people"),
    ("the repair desk", "is open", "on weekdays", "on Saturdays as well", "it closed for three days in August", "the desk is staffed by one person"),
    ("the orchard", "is harvested by", "volunteers", "a contractor", "not enough volunteers came last autumn", "the trees are forty years old"),
    ("the darkroom", "is booked through", "a paper diary", "an online form", "the diary went missing in May", "the darkroom has two enlargers"),
    ("the choir", "rehearses for", "ninety minutes", "two hours", "the last rehearsal ran short", "the choir has thirty singers"),
    ("the ticket office", "takes", "cash only", "cards as well", "the card machine has not arrived", "the office is beside the entrance"),
    ("the climbing wall", "is inspected", "once a year", "twice a year", "last year's inspection is not on file", "the wall is twelve metres high"),
    ("the stable yard", "is swept", "at dawn", "after lunch", "it was skipped during the show", "the yard has six stalls"),
    ("the community fridge", "is emptied", "on Sundays", "on Fridays", "nobody emptied it over Easter", "the fridge stands by the door"),
    ("the bell tower", "is opened to visitors", "in summer", "at weekends all year", "it stayed shut for repairs", "the tower has a hundred and twenty steps"),
]

OPEN_ITEM_FRAMES = [
    "{exception_capitalised}, and nobody has decided what to do about it.",
    "Still unresolved: {exception}.",
    "An open item - {exception}.",
    "We have not sorted out that {exception}.",
    "One thing left over: {exception}.",
]

RESTATEMENT_FRAMES = [
    "{subject} {attribute} {value}, which suits most people.",
    "People are happy that {subject_lower} {attribute} {value}.",
]

# The failure that costs entries: two claims about different attributes of the same subject, both
# true at once, which a general NLI model reads as a contradiction because they share a subject.
COEXISTING_FRAMES = [
    "{sibling_capitalised}.",
    "Worth noting, {sibling}.",
    "As things stand, {sibling}.",
]

CHANGED_FRAMES = [
    "{subject} {attribute} {new} now.",
    "From next month {subject} {attribute} {new}.",
    "{subject} {attribute} {new}, not {value}.",
]

# Added for the second training run. The first model lost "Forget the 10,000 words I mentioned before -
# the limit is 7,500" because nothing in its data had this shape: a lead-in that announces a change,
# then the new value. Every frame here carries a cue from `herder.domain.merge.CHANGE_CUE`, so the pair
# exercises the same reversal path the merge step takes - and `tests/test_training_data.py` checks both
# that, and that no frame opens the way a benchmark reversal does. The cue vocabulary is ordinary
# English; the benchmark's own openers ("Swap one of the ... I listed earlier", "Update the ... I
# described earlier") are deliberately not copied.
ANNOUNCED_FRAMES = [
    "Small correction: {subject} {attribute} {new}, not {value}.",
    "I've changed my mind - {subject} {attribute} {new}.",
    "Ignore what I said about {subject}: {subject} {attribute} {new} instead.",
    "Disregard my earlier note - {subject} {attribute} {new}.",
    "Scrap that plan; {subject} {attribute} {new} from now on.",
    "What I told you before was wrong: {subject} {attribute} {new}.",
    "Revised arrangement: {subject} {attribute} {new}.",
]

# The guard the first run needed and did not have: a change cue is not a verdict. An announcement that
# changes a *different* attribute leaves the claim standing (the NAS-schedule over-reach from attempt
# 4), and an announcement that lands back on the same value agrees with it.
ANNOUNCED_ELSEWHERE_FRAMES = [
    "Small correction: {sibling}.",
    "I've changed my mind about one thing - {sibling}.",
]
ANNOUNCED_SAME_FRAMES = [
    "After all, {subject} {attribute} {value}.",
]


def build(seed: int = 11) -> list[dict]:
    random.seed(seed)
    rows: list[dict] = []

    for subject, attribute, value, new, exception, sibling in FACTS:
        claim = f"{subject.capitalize()} {attribute} {value}."

        # An open item about the claim: keep both. This is the relation nothing else labels.
        for frame in OPEN_ITEM_FRAMES:
            rows.append(
                {
                    "a": frame.format(exception=exception,
                                     exception_capitalised=exception[0].upper() + exception[1:]),
                    "b": claim,
                    "label": "neutral",
                    "source": "open_items",
                    "shape": "open_item",
                }
            )

        # The same claim said again: a duplicate, and entailment is what says so.
        for frame in RESTATEMENT_FRAMES:
            rows.append(
                {
                    "a": frame.format(subject=subject.capitalize(), subject_lower=subject,
                                      attribute=attribute, value=value),
                    "b": claim,
                    "label": "entailment",
                    "source": "open_items",
                    "shape": "restatement",
                }
            )

        # Different attributes of one subject, true at the same time: keep both.
        for frame in COEXISTING_FRAMES:
            rows.append(
                {
                    "a": frame.format(sibling=sibling,
                                     sibling_capitalised=sibling[0].upper() + sibling[1:]),
                    "b": claim,
                    "label": "neutral",
                    "source": "open_items",
                    "shape": "coexisting",
                }
            )

        # The same attribute with a new value: this one really does replace the claim.
        for frame in CHANGED_FRAMES:
            rows.append(
                {
                    "a": frame.format(subject=subject.capitalize(), attribute=attribute, new=new, value=value),
                    "b": claim,
                    "label": "contradiction",
                    "source": "open_items",
                    "shape": "changed",
                }
            )

        # A change announced by a lead-in, then the new value: this replaces the claim.
        for frame in ANNOUNCED_FRAMES:
            rows.append(
                {
                    "a": frame.format(subject=subject, attribute=attribute, new=new, value=value),
                    "b": claim,
                    "label": "contradiction",
                    "source": "open_items",
                    "shape": "announced_change",
                }
            )

        # A change announced about something else: the claim stands.
        for frame in ANNOUNCED_ELSEWHERE_FRAMES:
            rows.append(
                {
                    "a": frame.format(sibling=sibling),
                    "b": claim,
                    "label": "neutral",
                    "source": "open_items",
                    "shape": "announced_elsewhere",
                }
            )

        # A change announced that lands on the value already held: agreement, not replacement.
        for frame in ANNOUNCED_SAME_FRAMES:
            rows.append(
                {
                    "a": frame.format(subject=subject, attribute=attribute, value=value),
                    "b": claim,
                    "label": "entailment",
                    "source": "open_items",
                    "shape": "announced_same",
                }
            )

    # Unrelated claims from different facts: distinct, and a check that nothing here teaches
    # "two sentences in the same file are related".
    subjects = list(itertools.combinations(range(len(FACTS)), 2))
    random.shuffle(subjects)
    for left, right in subjects[: len(FACTS) * 3]:
        s1, a1, v1, *_ = FACTS[left]
        s2, a2, v2, *_ = FACTS[right]
        rows.append(
            {
                "a": f"{s1.capitalize()} {a1} {v1}.",
                "b": f"{s2.capitalize()} {a2} {v2}.",
                "label": "neutral",
                "source": "open_items",
                "shape": "unrelated",
            }
        )

    return rows


if __name__ == "__main__":
    import collections

    built = build()
    print(f"{len(built)} pairs")
    for key, count in sorted(collections.Counter((r["shape"], r["label"]) for r in built).items()):
        print(f"  {key[0]:12} {key[1]:14} {count}")
    for row in built[:4]:
        print(f"\n  [{row['shape']} -> {row['label']}]\n    a: {row['a']}\n    b: {row['b']}")
