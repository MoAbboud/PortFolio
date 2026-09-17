"""Run the benchmark.

    $env:HERDER_KEY = "hrd_..."
    python -m bench.run --label trial
    python -m bench.run --label baseline          # refuses unless every fact list is complete
    python -m bench.run --resume bench/results/<folder>

Needs the stack running (`docker compose up -d`) and Ollama with the model pulled. The herder
method goes through the API and the worker, so it uses whatever extractor the worker has; the
run records which.

**Resumable, because a full run is hours on a CPU.** Every context and every verdict is
appended to the run folder as it is produced, and `--resume` skips anything already there.
An interrupted run loses at most the call in flight.

**The baseline is recorded before anything is tuned** (plan, stage 10). `--label baseline`
refuses to start unless every conversation has a complete fact list, so a baseline cannot be
recorded against half an answer key and then quietly compared with a full one.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from bench import facts as F
from bench.generate import DATASETS
from bench.metrics import Judged
from bench.methods import HerderApi, MethodFailed, map_summaries, naive_summary, no_context, truncate_tail, user_turns
from bench.models import Reader, Summariser
from bench.report import write as write_report
from herder.core.tokens import count_tokens

RESULTS = Path(__file__).resolve().parent / "results"
DEFAULT_BUDGETS = (500, 3000)


def _commit() -> str:
    """The commit, marked `+uncommitted` when tracked files differ from it - a run made on
    changed code would otherwise name a commit that does not contain what was measured."""
    try:
        head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True, check=True
        ).stdout.strip()
        return f"{head}+uncommitted" if dirty else head
    except Exception:
        return "unknown"


def context_file(run_dir: Path, conversation: str, key: str) -> Path:
    """Where a context's text is kept - committed with the results, so a verdict can always be
    checked against exactly what the reader was shown."""
    safe = key.replace(" @ ", "_").replace("[", "_").replace("]", "")
    return run_dir / "contexts" / f"{conversation}__{safe}.txt"


def _append(path: Path, record: dict) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _done(path: Path, field: str) -> set:
    if not path.exists():
        return set()
    return {json.loads(line)[field] for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bench.run")
    parser.add_argument("--label", default="trial", help="'baseline' requires complete fact lists")
    parser.add_argument("--budgets", default=",".join(map(str, DEFAULT_BUDGETS)))
    parser.add_argument("--conversations", default="", help="comma-separated names; default is all with facts")
    parser.add_argument("--methods", default="", help="comma-separated: herder, naive_summary, truncate_tail, user_turns, no_context")
    parser.add_argument("--resume", default=None, help="an existing run folder to continue")
    parser.add_argument("--api", default="http://localhost:8000")
    # For checking the harness itself on a scratch copy, so placeholder facts never sit beside
    # the real, hand-written ones.
    parser.add_argument("--datasets", default=str(DATASETS))
    parser.add_argument("--results", default=str(RESULTS))
    args = parser.parse_args(argv)
    datasets, results = Path(args.datasets), Path(args.results)

    key = os.environ.get("HERDER_KEY")
    if not key:
        raise SystemExit("set HERDER_KEY first. Get a key with: python -m herder bootstrap --email owner@localhost")

    budgets = sorted({int(b) for b in args.budgets.split(",") if b.strip()})
    methods = {m.strip() for m in args.methods.split(",") if m.strip()} or {"herder", "naive_summary", "truncate_tail", "user_turns", "no_context"}
    wanted = {n.strip() for n in args.conversations.split(",") if n.strip()}
    conversations = []
    for folder in sorted(datasets.iterdir()):
        if not (folder / "meta.json").exists() or (wanted and folder.name not in wanted):
            continue
        facts = F.load(datasets, folder.name)
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        conversations.append((meta, (folder / "conversation.txt").read_text(encoding="utf-8"), facts))

    short = [(m["name"], len(f.facts)) for m, _, f in conversations if len(f.facts) < F.TARGET_FACTS]
    if args.label == "baseline" and short:
        raise SystemExit(
            "a baseline needs every fact list complete. Short: "
            + ", ".join(f"{n} ({c} of {F.TARGET_FACTS})" for n, c in short)
            + ". Use --label trial to run on what exists."
        )
    conversations = [c for c in conversations if c[2].facts]
    if not conversations:
        raise SystemExit("no conversation has any facts yet. Write some at http://localhost:8000/bench")

    api = HerderApi(args.api, key)
    health = api.health()
    reader, summariser = Reader(), Summariser()
    reader.check_ready()

    if args.resume:
        run_dir = Path(args.resume)
        run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    else:
        started = dt.datetime.now(dt.UTC)
        run_dir = results / f"{started:%Y-%m-%d_%H%M}-{args.label}"
        run_dir.mkdir(parents=True, exist_ok=False)
        run = {
            "label": args.label,
            "started": started.isoformat(timespec="seconds"),
            "commit": _commit(),
            "model": reader.model,
            "read_prompt": reader.prompt_version,
            "summarise_prompt": summariser.prompt_version,
            "extractor": health.get("extractor", "unknown"),
            "budgets": budgets,
            "methods": sorted(methods),
            "conversations": [m["name"] for m, _, _ in conversations],
            "facts": sum(len(f.facts) for _, _, f in conversations),
            "false_facts": sum(len(f.false_facts) for _, _, f in conversations),
            "kinds": list(F.KINDS),
            # The fact lists as they were when the run started, so a later edit to a facts file
            # cannot change what an old report means.
            "statements": {m["name"]: {f.id: (f.statement, f.truth) for f in fl.facts} for m, _, fl in conversations},
            "unrated_facts": sum(len(fl.unrated) for _, _, fl in conversations),
            "short_fact_lists": dict(short),
        }
        (run_dir / "run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    contexts_path, judged_path = run_dir / "contexts.jsonl", run_dir / "judged.jsonl"
    (run_dir / "contexts").mkdir(exist_ok=True)
    have_contexts = _done(contexts_path, "id")
    have_verdicts = {
        f"{r['conversation']}|{r['method']}|{r['fact_id']}"
        for r in (json.loads(line) for line in judged_path.read_text(encoding="utf-8").splitlines() if line.strip())
    } if judged_path.exists() else set()
    extractor = run["extractor"]
    if health.get("extractor") != extractor:
        raise SystemExit(
            f"this run was started with the {extractor!r} extractor and the worker now has {health.get('extractor')!r}. "
            "Mixing them in one run would make the herder numbers meaningless; start a new run instead."
        )
    started_at = time.perf_counter()

    for meta, conversation, fact_list in conversations:
        name = meta["name"]
        print(f"\n{name}  ({meta['tokens']:,} tokens, {len(fact_list.facts)} facts)")
        contexts = []

        def keep(ctx, key: str) -> None:
            record = {
                "id": f"{name}|{key}", "key": key, "conversation": name, "conversation_tokens": meta["tokens"],
                "method": ctx.method, "budget": ctx.budget, "tokens": ctx.tokens,
                "build_seconds": round(ctx.build_seconds, 2), "detail": ctx.detail,
            }
            context_file(run_dir, name, key).write_text(ctx.text, encoding="utf-8", newline="\n")
            _append(contexts_path, record)
            have_contexts.add(record["id"])

        def load_ctx(key: str) -> str:
            return context_file(run_dir, name, key).read_text(encoding="utf-8")

        # ---- build every context first, then read against each
        keys: list[str] = []
        if "no_context" in methods:
            keys.append("no_context")
            if f"{name}|no_context" not in have_contexts:
                keep(no_context(conversation, 0), "no_context")

        if "truncate_tail" in methods:
            for budget in budgets:
                key = f"truncate_tail @ {budget}"
                keys.append(key)
                if f"{name}|{key}" not in have_contexts:
                    keep(truncate_tail(conversation, budget), key)

        if "user_turns" in methods:
            for budget in budgets:
                key = f"user_turns @ {budget}"
                keys.append(key)
                if f"{name}|{key}" not in have_contexts:
                    keep(user_turns(conversation, budget), key)

        summary_keys = {b: f"naive_summary @ {b}" for b in budgets} if "naive_summary" in methods else {}
        if any(f"{name}|{k}" not in have_contexts for k in summary_keys.values()):
            try:
                parts, map_seconds = map_summaries(conversation, summariser, largest_budget=max(budgets))
                for budget, key in summary_keys.items():
                    if f"{name}|{key}" not in have_contexts:
                        keep(naive_summary(parts, map_seconds, budget, summariser), key)
            except MethodFailed as exc:
                print(f"  ! naive_summary failed: {exc}")
        keys += [k for k in summary_keys.values() if f"{name}|{k}" in have_contexts]

        herder_keys = {b: f"herder[{extractor}] @ {b}" for b in budgets} if "herder" in methods else {}
        if any(f"{name}|{k}" not in have_contexts for k in herder_keys.values()):
            try:
                project_name = f"bench-{run_dir.name}-{name}"[:120]
                project_id, derive_seconds, messages = api.derive(project_name, conversation)
                print(f"  herder derived {messages} messages in {derive_seconds:.0f}s")
                for budget, key in herder_keys.items():
                    if f"{name}|{key}" not in have_contexts:
                        keep(api.context(project_id, budget, derive_seconds, extractor), key)
            except MethodFailed as exc:
                print(f"  ! herder failed: {exc}")
        keys += [k for k in herder_keys.values() if f"{name}|{k}" in have_contexts]

        # ---- the reader, one verdict per fact per context
        for key in keys:
            text = load_ctx(key)
            fresh = 0
            for fact in fact_list.facts:
                marker = f"{name}|{key}|{fact.id}"
                if marker in have_verdicts:
                    continue
                verdict, call = reader.judge(text, fact.statement)
                _append(judged_path, {
                    "conversation": name, "archetype": meta["archetype"], "method": key, "fact_id": fact.id,
                    "kind": fact.kind, "truth": fact.truth, "verdict": verdict, "importance": fact.importance,
                })
                have_verdicts.add(marker)
                fresh += 1
            print(f"  {key:34s} {count_tokens(text):5d} tokens  {fresh} verdicts")

    report = write_report(run_dir)
    print(f"\ndone in {(time.perf_counter() - started_at) / 60:.0f} min. Report: {report}")
    return 0


# `Judged` is imported so a reader of this file can see the shape of every judged.jsonl line.
__all__ = ["Judged", "main"]

if __name__ == "__main__":
    sys.exit(main())
