"""Command-line entry point: `python -m harness run --cases cases.jsonl`.

Phase 1 wiring: load cases -> run each through the model -> persist the raw
responses under a new run_id. Scoring is intentionally a no-op here; once you
add scorers in Phase 2, register them in `_load_scorers()` and the run loop
will score every response and persist the results.
"""

from __future__ import annotations

import argparse
import sys

from .cases import load_cases
from .runner import AnthropicRunner, Runner
from .scorer import Scorer
from .storage import ResultsStore, new_run_id


def _load_scorers() -> list[Scorer]:
    """Return the scorers to apply. Empty in Phase 1 — populate in Phase 2."""
    return []


def _cmd_run(args: argparse.Namespace) -> int:
    cases = load_cases(args.cases)
    if not cases:
        print(f"no cases found in {args.cases}", file=sys.stderr)
        return 1

    runner: Runner = AnthropicRunner(model=args.model)
    scorers = _load_scorers()
    run_id = new_run_id()

    print(f"run_id={run_id}  model={args.model}  cases={len(cases)}")

    with ResultsStore(args.db) as store:
        store.start_run(run_id, model=args.model, notes=args.notes)
        for case in cases:
            response = runner.run(case)
            store.save_response(run_id, response)
            for scorer in scorers:
                result = scorer.score(case, response)
                store.save_score(run_id, case.id, result)
            marker = "ok" if response.raw_text.strip() else "EMPTY"
            print(f"  [{marker}] {case.id}  ({response.meta.get('output_tokens')} out tok)")

        summary = store.run_summary(run_id)

    if summary:
        print("\nscores (mean per scorer):")
        for row in summary:
            print(f"  {row['scorer_name']}: {row['mean_score']:.3f}  (n={row['n']})")
    else:
        print("\nno scorers registered yet - responses saved, nothing scored.")
    print(f"\ndone. run_id={run_id}  db={args.db}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="harness", description="LLM eval harness")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run cases through the model")
    run.add_argument("--cases", required=True, help="path to cases JSONL file")
    run.add_argument("--db", default="results.db", help="SQLite results file")
    run.add_argument("--model", default="claude-opus-4-8", help="model id")
    run.add_argument("--notes", default=None, help="free-text note for this run")
    run.set_defaults(func=_cmd_run)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
