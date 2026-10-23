"""How well a matcher answers a challenge's labelled questions:

    python -m codevscode.client.report challenges/sample                 both matchers
    python -m codevscode.client.report challenges/sample --matcher lexical

For each threshold: recall (good questions that reveal the right requirement), wrong (good
questions that reveal another one) and false (questions that should reveal nothing but do). A
false or wrong reveal gives a player something they did not ask for, so the threshold chosen is
the one with the best recall among those with no false and no wrong reveals - the middle of that
range when several tie, so a small shift in scores does not tip it over.

The labelled set is small and the threshold is chosen on it, so the numbers are optimistic: they
say which matcher to start with and roughly where its threshold sits, no more.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from codevscode.client.matcher import MATCHERS, Matcher, best, load_requirements

THRESHOLDS = [round(0.05 * i, 2) for i in range(2, 19)]


@dataclass
class Row:
    threshold: float
    recall: int
    wrong: int
    false: int
    good: int
    empty: int


def load_questions(challenge_dir: Path | str) -> list[dict]:
    return json.loads((Path(challenge_dir) / "hidden" / "questions.json").read_text(encoding="utf-8"))["questions"]


def evaluate(matcher: Matcher, questions: list[dict], threshold: float) -> Row:
    recall = wrong = false = 0
    for q in questions:
        got, _ = best(matcher, q["text"], threshold)
        if q["requirement"] is None:
            false += got is not None
        elif got == q["requirement"]:
            recall += 1
        elif got is not None:
            wrong += 1
    good = sum(q["requirement"] is not None for q in questions)
    return Row(threshold, recall, wrong, false, good, len(questions) - good)


def choose(rows: list[Row]) -> Row | None:
    safe = [r for r in rows if r.false == 0 and r.wrong == 0]
    if not safe:
        return None
    top = max(r.recall for r in safe)
    tied = [r for r in safe if r.recall == top]
    return tied[len(tied) // 2]


def report(challenge_dir: Path, matcher_name: str) -> Row | None:
    requirements = load_requirements(challenge_dir)
    everything = load_questions(challenge_dir)
    # The threshold is chosen on the "dev" questions only. "fresh" ones are scored afterwards at
    # that threshold, untouched: the honest number for questions nothing was tuned on.
    questions = [q for q in everything if q.get("set", "dev") == "dev"]
    fresh = [q for q in everything if q.get("set") == "fresh"]
    matcher = MATCHERS[matcher_name](requirements)
    rows = [evaluate(matcher, questions, t) for t in THRESHOLDS]
    print(f"\n{matcher_name}: {rows[0].good} questions that should reveal a requirement, {rows[0].empty} that should not")
    print("threshold  recall  wrong  false")
    for r in rows:
        print(f"   {r.threshold:4.2f}   {r.recall:3}/{r.good:<3} {r.wrong:4}  {r.false:4}")
    chosen = choose(rows)
    if chosen is None:
        print("no threshold reveals nothing it should not")
        return None
    print(f"chosen: {chosen.threshold:.2f} - recall {chosen.recall}/{chosen.good}, no wrong or false reveals")
    print("misses at that threshold:")
    for q in questions:
        got, score = best(matcher, q["text"], chosen.threshold)
        if got != q["requirement"]:
            print(f"   {score:5.2f}  wanted {q['requirement'] or '-':13} got {got or '-':13} {q['text']}")
    if fresh:
        row = evaluate(matcher, fresh, chosen.threshold)
        print(f"fresh questions at {chosen.threshold:.2f}, nothing retuned: recall {row.recall}/{row.good}, "
              f"wrong {row.wrong}, false {row.false} of {row.empty}")
        for q in fresh:
            got, score = best(matcher, q["text"], chosen.threshold)
            if got != q["requirement"]:
                print(f"   {score:5.2f}  wanted {q['requirement'] or '-':13} got {got or '-':13} {q['text']}")
    return chosen


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure the question matchers on a challenge's labelled questions.")
    parser.add_argument("challenge")
    parser.add_argument("--matcher", choices=[*MATCHERS, "both"], default="both")
    args = parser.parse_args()
    names = list(MATCHERS) if args.matcher == "both" else [args.matcher]
    for name in names:
        report(Path(args.challenge), name)


if __name__ == "__main__":
    main()
