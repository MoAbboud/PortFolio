"""Score NLI checkpoints on the labelled pairs in `nli_pairs.json`, through herder's own merge rules.

    python -m bench.nli_compare
    python -m bench.nli_compare --models cross-encoder/nli-deberta-v3-base,tals/albert-base-vitaminc-mnli

Why this exists. The merge step's verdicts come from an NLI cross-encoder, and stage 10 measured two
failures it makes on real conversations: a correction read as neutral against the claim it replaces,
and two compatible sentences read as a contradiction. Both are properties of the checkpoint, not of
the code around it, so the checkpoint is worth choosing rather than inheriting.

**Choosing is done on the `written` pairs only.** The `observed` pairs come from benchmark runs, and
picking a model on them would be selecting on the test set - the same mistake as tuning the extractor
against the benchmark, which this project refused at stage 10. They are scored and printed separately
because they are the failures that prompted the search, and a model that fixes them is interesting -
but the decision is the written column, and the confirmation is a benchmark run.

Each verdict is produced exactly as `derive_project` produces it: the reversal path first when the
candidate announces a change, then `decide_against`. A checkpoint whose head is not three-label
(entailment / neutral / contradiction) is refused by `CrossEncoderNli` rather than scored, because a
binary head cannot express `supersede` at all.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from herder.core.config import get_settings
from herder.core.nli import CrossEncoderNli, NliUnavailable
from herder.domain.merge import Match, Verdict, announces_change, claim_of, decide_against, decide_reversal

PAIRS = Path(__file__).resolve().parent / "nli_pairs.json"

# The current model first, so every other line reads as a change from what is running.
DEFAULT_MODELS = [
    "cross-encoder/nli-deberta-v3-base",
    "cross-encoder/nli-deberta-v3-small",
    "tals/albert-base-vitaminc-mnli",
    "MoritzLaurer/deberta-v3-base-zeroshot-v2.0-c",
    "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli",
]

# Licence notes carried into the report, so a tempting score cannot be adopted without seeing them.
NOTES = {
    "cross-encoder/nli-deberta-v3-base": "current. SNLI+MNLI, Apache-2.0",
    "cross-encoder/nli-deberta-v3-small": "SNLI+MNLI, Apache-2.0, smaller",
    "tals/albert-base-vitaminc-mnli": "revision-aware (VitaminC), 11.7M - LICENCE NOT STATED ON CARD, check before shipping",
    "MoritzLaurer/deberta-v3-base-zeroshot-v2.0-c": "MIT, commercially-clean lineage - may be a binary head",
    "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli": "trained on ANLI: NON-COMMERCIAL claim inherited. Reference only",
}


def verdict_for(nli, candidate: str, existing: str, floor: float) -> Verdict:
    """The verdict herder would reach for this pair, similarity assumed to have cleared."""
    match = Match(entry_id=None, status="active", title="", text=existing, similarity=1.0)
    if announces_change(candidate):
        readings = [nli.both_ways(candidate, existing)]
        claims = (claim_of(candidate), claim_of(existing))
        if claims != (candidate.strip(), existing.strip()):
            readings.append(nli.both_ways(*claims))
        reversal = decide_reversal(match, readings)
        if reversal is not None:
            return reversal.verdict
    forward, backward = nli.both_ways(candidate, existing)
    return decide_against(match, forward, backward, floor).verdict


def score(model_name: str, pairs: list[dict], floor: float) -> dict:
    nli = CrossEncoderNli()
    nli.model_name = model_name
    started = time.perf_counter()
    try:
        nli.check_ready()
    except NliUnavailable as error:
        return {"model": model_name, "refused": str(error)}
    load_seconds = time.perf_counter() - started

    results, wrong = [], []
    started = time.perf_counter()
    for pair in pairs:
        got = verdict_for(nli, pair["candidate"], pair["existing"], floor)
        right = str(got) == pair["expect"]
        results.append((pair, right))
        if not right:
            wrong.append((pair, str(got)))
    elapsed = time.perf_counter() - started

    by_group = Counter()
    totals = Counter()
    for pair, right in results:
        totals[pair["group"]] += 1
        by_group[pair["group"]] += right
    by_shape = Counter()
    shape_totals = Counter()
    for pair, right in results:
        shape_totals[pair["shape"]] += 1
        by_shape[pair["shape"]] += right

    return {
        "model": model_name,
        "load_seconds": load_seconds,
        "seconds_per_pair": elapsed / max(1, len(pairs)),
        "written": (by_group["written"], totals["written"]),
        "observed": (by_group["observed"], totals["observed"]),
        "by_shape": {s: (by_shape[s], shape_totals[s]) for s in sorted(shape_totals)},
        "wrong": wrong,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bench.nli_compare")
    parser.add_argument("--models", default=",".join(DEFAULT_MODELS))
    parser.add_argument("--floor", type=float, default=None, help="NLI confidence floor; default from settings")
    parser.add_argument("--show-wrong", action="store_true", help="print every pair a model got wrong")
    args = parser.parse_args(argv)

    floor = args.floor if args.floor is not None else get_settings().nli_floor
    data = json.loads(PAIRS.read_text(encoding="utf-8"))
    pairs = data["pairs"]
    print(f"{len(pairs)} pairs, floor {floor}\n")

    rows = [score(m.strip(), pairs, floor) for m in args.models.split(",") if m.strip()]

    print(f"{'model':46} {'written':>10} {'observed':>10} {'s/pair':>7}  note")
    for row in rows:
        if "refused" in row:
            print(f"{row['model']:46} {'REFUSED':>10} {'-':>10} {'-':>7}  {NOTES.get(row['model'], '')}")
            print(f"    {row['refused'][:150]}")
            continue
        w, wt = row["written"]
        o, ot = row["observed"]
        print(
            f"{row['model']:46} {f'{w}/{wt}':>10} {f'{o}/{ot}':>10} {row['seconds_per_pair']:>7.2f}"
            f"  {NOTES.get(row['model'], '')}"
        )

    print("\nby shape (written + observed):")
    shapes = sorted({s for row in rows if "by_shape" in row for s in row["by_shape"]})
    print(f"{'model':46} " + " ".join(f"{s[:13]:>14}" for s in shapes))
    for row in rows:
        if "by_shape" not in row:
            continue
        cells = " ".join(f"{f'{row['by_shape'][s][0]}/{row['by_shape'][s][1]}':>14}" for s in shapes)
        print(f"{row['model']:46} {cells}")

    if args.show_wrong:
        for row in rows:
            if "wrong" not in row:
                continue
            print(f"\n--- {row['model']} got wrong:")
            for pair, got in row["wrong"]:
                print(f"  [{pair['group']}/{pair['shape']}] expected {pair['expect']}, got {got}")
                print(f"      candidate: {pair['candidate'][:100]}")
                print(f"      existing:  {pair['existing'][:100]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
