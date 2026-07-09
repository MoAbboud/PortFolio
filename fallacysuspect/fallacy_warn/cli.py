"""Command-line interface.

    python -m fallacy_warn check --file argument.txt
    python -m fallacy_warn check --text "some argument"
    python -m fallacy_warn check --file argument.txt --json
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import DEFAULT_MODEL
from .display import print_report
from .llm import LLMError
from .pipeline import analyze


def _read_input(args: argparse.Namespace) -> str:
    if args.text is not None:
        return args.text
    if args.file == "-":
        return sys.stdin.read()
    try:
        with open(args.file, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError as exc:
        raise SystemExit(f"error: could not read {args.file!r}: {exc}")


def _cmd_check(args: argparse.Namespace) -> int:
    text = _read_input(args)
    try:
        result = analyze(text, model=args.model)
    except LLMError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        print_report(result)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fallacy_warn",
        description=(
            "Flag POSSIBLE logical fallacies in text as warnings with confidence "
            "scores. Not a judge — never decides who is right."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="analyze a piece of text")
    src = check.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", help="path to a text file, or '-' for stdin")
    src.add_argument("--text", help="analyze this literal string")
    check.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Anthropic model id (default: {DEFAULT_MODEL})",
    )
    check.add_argument(
        "--json",
        action="store_true",
        help="emit machine-readable JSON instead of the human report",
    )
    check.set_defaults(func=_cmd_check)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
