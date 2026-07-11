"""Command-line interface.

    python -m fallacy_warn check --file argument.txt
    python -m fallacy_warn check --text "some argument"
    python -m fallacy_warn check --file argument.txt --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import classifier
from .config import DEFAULT_MODEL
from .db import recent, store_analysis
from .display import print_report
from .llm import LLMError
from .pipeline import analyze


def _use_local() -> bool:
    """Prefer the trained local models when available (FALLACY_BACKEND=auto|local|api)."""
    backend = os.environ.get("FALLACY_BACKEND", "auto").lower()
    if backend == "api":
        return False
    if backend == "local":
        return True
    return classifier.is_available()


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
    if _use_local():
        result = classifier.analyze(text)
    else:
        try:
            result = analyze(text, model=args.model)
        except LLMError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    # Always persist the evaluation (best-effort — never blocks output).
    stored_id = store_analysis(result)

    if args.json:
        payload = result.to_dict()
        payload["stored_id"] = stored_id
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print_report(result)
        if stored_id is not None:
            print(f"(saved to database as #{stored_id})", file=sys.stderr)
    return 0


def _cmd_history(args: argparse.Namespace) -> int:
    rows = recent(limit=args.limit)
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0
    if not rows:
        print("No evaluations stored yet.")
        return 0
    for row in rows:
        preview = " ".join(row["text"].split())
        if len(preview) > 70:
            preview = preview[:67] + "..."
        print(f"#{row['id']:<4} {row['created_at']}  "
              f"{row['warning_count']} warning(s)  {preview!r}")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    # Imported lazily so the CLI 'check' path doesn't require Flask.
    try:
        from .web import serve
    except ImportError:
        print(
            "error: the web interface needs Flask. Install it with:\n"
            "  pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 2
    print(
        f"fallacy_warn UI running at http://{args.host}:{args.port}  (Ctrl+C to stop)",
        file=sys.stderr,
    )
    serve(host=args.host, port=args.port, model=args.model)
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

    serve = sub.add_parser("serve", help="run the web interface")
    serve.add_argument(
        "--host",
        default="127.0.0.1",
        help="bind address (use 0.0.0.0 inside Docker; default: 127.0.0.1)",
    )
    serve.add_argument("--port", type=int, default=8000, help="port (default: 8000)")
    serve.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Anthropic model id (default: {DEFAULT_MODEL})",
    )
    serve.set_defaults(func=_cmd_serve)

    history = sub.add_parser("history", help="show recently stored evaluations")
    history.add_argument(
        "--limit", type=int, default=20, help="max rows to show (default: 20)"
    )
    history.add_argument(
        "--json", action="store_true", help="emit JSON instead of a table"
    )
    history.set_defaults(func=_cmd_history)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
