"""Build the training set for herder's merge model. Runs locally or in the Colab notebook.

    python -m training.nli.build_dataset --out training/nli/data
    python -m training.nli.build_dataset --out training/nli/data --no-share-alike

**What this is for.** The merge step asks an NLI cross-encoder whether a new claim duplicates,
refines, replaces or is unrelated to a stored one. Six off-the-shelf checkpoints were measured on
`bench/nli_pairs.json` and none is good at both halves of the job (`NOTES.md`): the general
SNLI/MNLI models read reversals correctly and call compatible sentences contradictory, and the
revision-trained models are the other way round. This builds a set aimed at both.

**The shape that matters, and where it comes from.** herder compares two short claims. Most NLI
corpora pair a long premise with a short hypothesis, which is why the VitaminC checkpoints - trained
on evidence-against-claim - call a plain reversal neutral. VitaminC's own structure fixes this: each
`case_id` + `wiki_revision_id` is one piece of evidence with several claims judged against it, and
they are minimal pairs ("more than 4000 years" / "less than 4000 years"). **A claim that SUPPORTS a
piece of evidence and a claim that REFUTES the same evidence contradict each other**, so pairing them
yields claim-versus-claim contradictions in herder's own shape. That derived set is the point of this
script; the raw evidence-against-claim rows are available too, behind a flag.

**Sources, and the licence position.** VitaminC is CC BY-SA 3.0 (share-alike) and WANLI is CC BY 4.0.
`--no-share-alike` drops every share-alike source, which leaves WANLI plus the hand-written pairs: that
addresses the false-contradiction failure and does nothing for `supersede`, the more valuable half.
ANLI is deliberately absent everywhere: CC BY-NC, and it puts a non-commercial claim on any checkpoint
fine-tuned from it.

**Contamination.** Nothing from the benchmark conversations may enter training - the 261 hand-written
facts are the instrument, and an instrument trained on is no instrument. Every candidate sentence is
checked against every sentence of `bench/datasets/*/conversation.txt` and dropped on an exact
normalised match. The check is reported, not silent, because zero overlap is a claim worth seeing.
"""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BENCH_CONVERSATIONS = REPO / "bench" / "datasets"

# herder's own three labels. The fact-verification vocabulary maps onto them exactly as
# `herder/core/nli.py` maps it at inference time - the same table, so training and serving agree.
ENTAILMENT, CONTRADICTION, NEUTRAL = "entailment", "contradiction", "neutral"
FACT_VERIFICATION = {"SUPPORTS": ENTAILMENT, "REFUTES": CONTRADICTION, "NOT ENOUGH INFO": NEUTRAL}

SHARE_ALIKE = {"vitaminc"}


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def benchmark_sentences() -> set[str]:
    """Every sentence of every benchmark conversation, normalised, for the contamination check."""
    out: set[str] = set()
    for path in sorted(BENCH_CONVERSATIONS.glob("*/conversation.txt")):
        for line in path.read_text(encoding="utf-8").splitlines():
            for piece in re.split(r"(?<=[.!?])\s+", line):
                cleaned = normalise(piece)
                if len(cleaned) > 25:
                    out.add(cleaned)
    return out


def vitaminc_pairs(limit: int, real_only: bool, include_evidence_rows: bool) -> list[dict]:
    """Claim-versus-claim contradictions, plus optionally the raw evidence-against-claim rows."""
    from datasets import load_dataset

    # Grouped by the evidence a claim was judged against, so SUPPORTS and REFUTES in one group are
    # two claims about the same fact - which is what makes them contradict each other.
    groups: dict[tuple[str, str], dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    evidence_rows: list[dict] = []
    seen = 0

    for row in load_dataset("tals/vitaminc", split="train", streaming=True):
        if real_only and row["revision_type"] != "real":
            continue
        seen += 1
        key = (row["case_id"], str(row["wiki_revision_id"]))
        groups[key][row["label"]].append(row["claim"])
        if include_evidence_rows:
            evidence_rows.append(
                {
                    "a": row["evidence"],
                    "b": row["claim"],
                    "label": FACT_VERIFICATION[row["label"]],
                    "source": "vitaminc-evidence",
                    "shape": "evidence_vs_claim",
                }
            )
        if seen >= limit:
            break

    pairs: list[dict] = []
    for (case, _revision), by_label in groups.items():
        supported = {normalise(c): c for c in by_label.get("SUPPORTS", [])}
        refuted = {normalise(c): c for c in by_label.get("REFUTES", [])}
        for key_r, claim_r in refuted.items():
            for key_s, claim_s in supported.items():
                if key_r == key_s:
                    # The same sentence cannot both support and refute the same evidence; if the
                    # corpus says so, the row is noise rather than a contradiction to learn from.
                    continue
                pairs.append(
                    {
                        "a": claim_r,
                        "b": claim_s,
                        "label": CONTRADICTION,
                        "source": "vitaminc-claims",
                        "shape": "claim_vs_claim",
                        "case": case,
                    }
                )
    return pairs + evidence_rows


def wanli_pairs(limit: int) -> list[dict]:
    """WANLI as it stands: ambiguous entailment-versus-neutral, which is the compatible-sentence bug."""
    from datasets import load_dataset

    out: list[dict] = []
    for row in load_dataset("alisawuffles/WANLI", split="train", streaming=True):
        gold = str(row["gold"]).strip().lower()
        if gold not in {ENTAILMENT, CONTRADICTION, NEUTRAL}:
            continue
        out.append(
            {"a": row["premise"], "b": row["hypothesis"], "label": gold, "source": "wanli", "shape": "wanli"}
        )
        if len(out) >= limit:
            break
    return out


def own_pairs() -> list[dict]:
    """The shape no public corpus labels: an open item about a claim does not replace the claim."""
    from training.nli.open_items import build as build_open_items

    return build_open_items()


def swap_symmetric(pairs: list[dict]) -> list[dict]:
    """Contradiction is symmetric and entailment is not.

    herder runs the model in both directions and reads the asymmetry - "A entails B but B does not
    entail A" is what separates a refinement from a duplicate. So the swapped copy is added only for
    contradiction and neutral, where the label genuinely holds both ways. Swapping an entailment pair
    and keeping the label would teach exactly the confusion that makes a refinement look like a
    duplicate.
    """
    extra = []
    for pair in pairs:
        if pair["label"] in (CONTRADICTION, NEUTRAL):
            extra.append({**pair, "a": pair["b"], "b": pair["a"], "shape": pair["shape"] + "-swapped"})
    return extra


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="training.nli.build_dataset")
    parser.add_argument("--out", default=str(REPO / "training" / "nli" / "data"))
    parser.add_argument("--vitaminc-rows", type=int, default=120_000, help="rows streamed before pairing")
    parser.add_argument("--wanli-rows", type=int, default=40_000)
    parser.add_argument("--evidence-rows", action="store_true", help="also keep VitaminC evidence-vs-claim rows")
    parser.add_argument("--include-synthetic", action="store_true", help="VitaminC synthetic revisions too")
    parser.add_argument("--no-share-alike", action="store_true", help="drop CC BY-SA sources (VitaminC)")
    parser.add_argument("--no-swap", action="store_true", help="do not add symmetric swapped copies")
    parser.add_argument("--dev-size", type=int, default=2_000)
    parser.add_argument(
        "--no-balance",
        action="store_true",
        help="keep the natural label mix. By default the majority label is capped at the size of the "
        "second largest, because the VitaminC pairing produces contradictions only",
    )
    parser.add_argument(
        "--own-repeat",
        type=int,
        default=8,
        help="how many times the hand-written training pairs are repeated. The first run used 1 and they "
        "were 0.7%% of the set",
    )
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)

    random.seed(args.seed)
    sources: list[dict] = []

    if args.no_share_alike:
        print("share-alike sources dropped: " + ", ".join(sorted(SHARE_ALIKE)))
    else:
        print("VitaminC (CC BY-SA 3.0): streaming and pairing by case ...")
        vc = vitaminc_pairs(args.vitaminc_rows, not args.include_synthetic, args.evidence_rows)
        print(f"  {len(vc):,} rows")
        sources += vc

    print("WANLI (CC BY 4.0): streaming ...")
    wanli = wanli_pairs(args.wanli_rows)
    print(f"  {len(wanli):,} rows")
    sources += wanli

    print("hand-written pairs ...")
    mine = own_pairs()
    print(f"  {len(mine):,} rows")

    if not args.no_swap:
        swapped = swap_symmetric(sources)
        mine_swapped = swap_symmetric(mine)
        print(f"symmetric swapped copies (contradiction and neutral only): {len(swapped) + len(mine_swapped):,}")
        sources += swapped
        mine += mine_swapped

    # Contamination, checked and reported rather than assumed.
    bench = benchmark_sentences()
    clean = lambda rows: [p for p in rows if normalise(p["a"]) not in bench and normalise(p["b"]) not in bench]
    before = len(sources) + len(mine)
    sources, mine = clean(sources), clean(mine)
    print(f"contamination check against {len(bench):,} benchmark sentences: {before - len(sources) - len(mine)} dropped")

    # Balance. Every VitaminC pair is a contradiction by construction, so without this the model
    # would meet three contradictions for every neutral and learn to say "supersede" - the failure
    # that costs entries, taught deliberately. Capped rather than equalised: the shapes are not
    # equally frequent in real conversations either.
    if not args.no_balance:
        by_label: dict[str, list[dict]] = defaultdict(list)
        for row in sources:
            by_label[row["label"]].append(row)
        sizes = sorted((len(v) for v in by_label.values()), reverse=True)
        cap = sizes[1] if len(sizes) > 1 else sizes[0]
        balanced: list[dict] = []
        for label, rows in by_label.items():
            random.shuffle(rows)
            if len(rows) > cap:
                print(f"balance: {label} {len(rows):,} -> {cap:,}")
            balanced += rows[:cap]
        sources = balanced

    random.shuffle(sources)
    dev = sources[: args.dev_size]
    train = sources[args.dev_size :]

    # The hand-written pairs, weighted. In the first run they were 647 of 90,328 rows - 0.7% - and the
    # shapes they carry are the ones the public corpora do not. Two orderings matter here:
    #   - added AFTER balancing, so the contradiction cap cannot throw them away;
    #   - split into train and dev BEFORE repeating, so no copy of a dev pair sits in train and
    #     flatters the dev score.
    random.shuffle(mine)
    own_dev_size = max(1, len(mine) // 10)
    own_dev, own_train = mine[:own_dev_size], mine[own_dev_size:]
    dev += own_dev
    train += own_train * args.own_repeat
    random.shuffle(train)
    random.shuffle(dev)
    print(
        f"hand-written pairs: {len(own_dev)} to dev, {len(own_train)} to train x{args.own_repeat} = "
        f"{len(own_train) * args.own_repeat:,} rows ({len(own_train) * args.own_repeat / max(1, len(train)):.1%} of train)"
    )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train", train), ("dev", dev)):
        path = out / f"{name}.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        counts: dict[str, int] = defaultdict(int)
        shapes: dict[str, int] = defaultdict(int)
        for row in rows:
            counts[row["label"]] += 1
            shapes[row["source"]] += 1
        print(f"\n{path}: {len(rows):,} rows")
        print("  labels: " + ", ".join(f"{k} {v:,}" for k, v in sorted(counts.items())))
        print("  sources: " + ", ".join(f"{k} {v:,}" for k, v in sorted(shapes.items())))

    (out / "recipe.json").write_text(
        json.dumps(
            {
                "seed": args.seed,
                "share_alike_included": not args.no_share_alike,
                "sources": {
                    "vitaminc": None if args.no_share_alike else "CC BY-SA 3.0, real revisions, paired by case",
                    "wanli": "CC BY 4.0",
                    "open_items": "written for this project",
                },
                "excluded": {"anli": "CC BY-NC - would put a non-commercial claim on the weights"},
                "swapped_copies": not args.no_swap,
                "own_repeat": args.own_repeat,
                "dev_size": args.dev_size,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"\nwrote {out / 'recipe.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
