"""Turn a run's verdicts into `report.md`. Pure apart from reading and writing the run folder.

Three views, because one number hides the thing worth seeing:

1. Each method at each budget, combined - with counts beside every rate.
2. The same per archetype - a method that wins on coding and loses on planning is a finding,
   not an average.
3. **The per-fact detail**: every fact, and what each method's reader said about it. This is
   what makes the next change informed rather than a guess (plan, stage 10).
"""

from __future__ import annotations

import json
from pathlib import Path

from bench.metrics import Judged, group, score


def load_judged(run_dir: Path) -> list[Judged]:
    path = run_dir / "judged.jsonl"
    if not path.exists():
        return []
    return [Judged(**json.loads(line)) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _label(method: str, budget: int) -> str:
    return method if method == "no_context" else f"{method} @ {budget}"


def write(run_dir: Path) -> Path:
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    judged = load_judged(run_dir)
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

    path = run_dir / "report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return path


def _budget_of(row: Judged) -> int:
    # The method key already carries the budget ("herder @ 500"); sorting uses it.
    return int(row.method.rsplit("@", 1)[1]) if "@" in row.method else 0
