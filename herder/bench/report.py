"""Turn a run's verdicts into `report.md`. Pure apart from reading and writing the run folder.

Three views, because one number hides the thing worth seeing:

1. Each method at each budget, combined - with counts beside every rate.
2. The same per archetype - a method that wins on coding and loses on planning is a finding,
   not an average.
3. **The per-fact detail**: every fact, and what each method's reader said about it. This is
   what makes the next change informed rather than a guess (plan, stage 10).

**Re-scoring a run judged before the tiers existed** (`--tiers-from`). Its rows all read
`unrated`, so its report has no tier table. The tiers can be filled from the current fact lists
by fact id - a re-read, no model runs - and that is legitimate only because the statement and
truth of every fact are checked identical to the ones the run recorded in `run.json`. One
difference and the re-score is refused: a tier from a reworded fact would be a tier for a fact
the reader never saw. The recorded run is never touched; the re-scored report goes to its own
file, and says at the top that its tiers were added afterwards.

    python -m bench.report bench/results/<run> --tiers-from bench/datasets
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

from bench import facts as F
from bench.metrics import Judged, group, score

RESCORED = Path(__file__).resolve().parent / "results" / "rescored"


class RescoreError(ValueError):
    pass


def load_judged(run_dir: Path) -> list[Judged]:
    path = run_dir / "judged.jsonl"
    if not path.exists():
        return []
    return [Judged(**json.loads(line)) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def fill_tiers(judged: list[Judged], run: dict, datasets: Path) -> list[Judged]:
    """Give every `unrated` row the tier its fact carries now. A row that already has a tier
    keeps it - that is what the run recorded. Refuses if any fact the run judged has changed."""
    tiers: dict[tuple[str, str], str] = {}
    changed: list[str] = []
    for conversation, statements in run["statements"].items():
        current = {f.id: f for f in F.load(datasets, conversation).facts}
        for fact_id, (statement, truth) in statements.items():
            fact = current.get(fact_id)
            if fact is None or fact.statement != statement or fact.truth != truth:
                changed.append(f"{conversation} {fact_id}")
            else:
                tiers[(conversation, fact_id)] = fact.importance
    if changed:
        raise RescoreError(
            f"{len(changed)} facts differ from what this run judged, so their tiers cannot be borrowed: "
            + ", ".join(changed[:10]) + (" ..." if len(changed) > 10 else "")
        )
    return [
        dataclasses.replace(j, importance=tiers[(j.conversation, j.fact_id)]) if j.importance == F.UNRATED else j
        for j in judged
    ]


def _label(method: str, budget: int) -> str:
    return method if method == "no_context" else f"{method} @ {budget}"


def write(run_dir: Path, *, tiers_from: Path | None = None, out: Path | None = None) -> Path:
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    judged = load_judged(run_dir)
    if tiers_from is not None:
        judged = fill_tiers(judged, run, tiers_from)
    contexts = [json.loads(line) for line in (run_dir / "contexts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    tokens = {c["conversation"]: c["conversation_tokens"] for c in contexts}

    def compression(method_key: str) -> str:
        rows = [c for c in contexts if c["key"] == method_key and c["tokens"]]
        if not rows:
            return "-"
        return f"{sum(tokens[c['conversation']] for c in rows) / sum(c['tokens'] for c in rows):.1f}x"

    def seconds(method_key: str) -> str:
        rows = [c for c in contexts if c["key"] == method_key]
        return f"{sum(c['build_seconds'] for c in rows) / len(rows):.0f} s" if rows else "-"

    lines = [
        f"# Benchmark run: {run['label']}",
        "",
        f"- Started {run['started']}, commit `{run['commit']}`",
        f"- Reader and summariser: `{run['model']}` (read prompt v{run['read_prompt']}, summarise prompt v{run['summarise_prompt']})",
        f"- herder extractor: `{run['extractor']}`; budgets: {', '.join(map(str, run['budgets']))} tokens",
        f"- {len(run['conversations'])} conversations, {run['facts']} facts ({run['false_facts']} false)",
    ]
    if tiers_from is not None:
        lines += [
            "",
            "**Re-scored.** This run was judged before facts were rated. Its verdicts are unchanged; the tiers",
            "were filled afterwards from the current fact lists, whose statements were checked identical to the",
            "ones this run judged. Only the tier table can differ from the run's own `report.md`.",
        ]
    lines += [
        "",
        "Every rate is shown with its count. Eight conversations is a small corpus: a difference of one or two",
        "facts is noise, and nothing here should be read more precisely than that.",
        "",
        "**Recall**: true facts the reader found true. **Hallucination**: false facts - turned-down ideas and",
        "reversed decisions - the reader found true. **Contradiction**: true facts the reader found false.",
        "`no_context` is the reader with nothing, so its recall is what guessing alone scores.",
        "",
        "## Combined",
        "",
        "| Method | Recall | Hallucination | Contradiction | Compression | Time to build | Reader errors |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    keys = sorted({(j.method, _budget_of(j)) for j in judged}, key=lambda k: (k[0] != "no_context", k[0], k[1]))
    by_method = group(judged, "method")
    for method_key, _ in keys:
        s = score(by_method[(method_key,)])
        lines.append(
            f"| {method_key} | {s.recall} | {s.hallucination} | {s.contradiction} | {compression(method_key)} | {seconds(method_key)} | {s.errors} |"
        )

    lines += ["", "## By archetype", "", "| Archetype | Method | Recall | Hallucination |", "| --- | --- | --- | --- |"]
    for (archetype, method_key), rows in sorted(group(judged, "archetype", "method").items()):
        s = score(rows)
        lines.append(f"| {archetype} | {method_key} | {s.recall} | {s.hallucination} |")

    lines += ["", "## Recall by kind of fact", "", "| Method | " + " | ".join(run["kinds"]) + " |", "| --- |" + " --- |" * len(run["kinds"])]
    for (method_key,), rows in sorted(by_method.items()):
        s = score(rows)
        lines.append(f"| {method_key} | " + " | ".join(str(s.by_kind[k]) if k in s.by_kind else "-" for k in run["kinds"]) + " |")

    tiers = [t for t in ("essential", "useful", "incidental") if any(j.importance == t for j in judged)]
    if tiers:
        lines += [
            "", "## Recall by how much the fact matters", "",
            "Under a budget no method can carry every fact, and none should try. A blended recall counts",
            "forgetting the database choice and forgetting which day flour arrives as the same miss.",
            "",
            "| Method | " + " | ".join(tiers) + " |", "| --- |" + " --- |" * len(tiers),
        ]
        for (method_key,), rows in sorted(by_method.items()):
            cells = []
            for tier in tiers:
                mine = [r for r in rows if r.importance == tier]
                cells.append(str(score(mine).recall) if mine else "-")
            lines.append(f"| {method_key} | " + " | ".join(cells) + " |")
        unrated = sum(1 for j in judged if j.importance == "unrated") // max(1, len({j.method for j in judged}))
        if unrated:
            lines += ["", f"{unrated} facts are not rated and are left out of this table only."]

    lines += ["", "## Every fact", "", "`T` true, `F` false, `-` not stated, `!` reader error. The first column is the ground truth."]
    methods = [k for k, _ in keys]
    for (conversation,), rows in sorted(group(judged, "conversation").items()):
        facts = run["statements"][conversation]
        lines += ["", f"### {conversation}", "", "| Fact | Truth | " + " | ".join(methods) + " |", "| --- | --- |" + " --- |" * len(methods)]
        verdicts = {(r.fact_id, r.method): r.verdict for r in rows}
        symbol = {"true": "T", "false": "F", "not_stated": "-", "error": "!"}
        for fact_id, (statement, truth) in facts.items():
            cells = [symbol.get(verdicts.get((fact_id, m), ""), " ") for m in methods]
            lines.append(f"| {fact_id} {statement} | {truth[0].upper()} | " + " | ".join(cells) + " |")

    path = out or run_dir / "report.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bench.report")
    parser.add_argument("run", help="a run folder under bench/results")
    parser.add_argument("--tiers-from", default=None, help="a datasets folder; fills tiers for a run judged before them")
    parser.add_argument("--out", default=None, help="where to write; a re-score defaults to bench/results/rescored/<run>.md")
    args = parser.parse_args(argv)

    run_dir = Path(args.run)
    tiers_from = Path(args.tiers_from) if args.tiers_from else None
    out = Path(args.out) if args.out else (RESCORED / f"{run_dir.name}.md" if tiers_from else None)
    if out is not None and out.resolve().parent == run_dir.resolve():
        # A re-score next to the run would read as part of what the run recorded.
        print("refusing to write a re-scored report inside the run folder", file=sys.stderr)
        return 2
    try:
        path = write(run_dir, tiers_from=tiers_from, out=out)
    except RescoreError as error:
        print(f"refused: {error}", file=sys.stderr)
        return 1
    print(f"Report: {path}")
    return 0


def _budget_of(row: Judged) -> int:
    # The method key already carries the budget ("herder @ 500"); sorting uses it.
    return int(row.method.rsplit("@", 1)[1]) if "@" in row.method else 0


if __name__ == "__main__":
    raise SystemExit(main())
