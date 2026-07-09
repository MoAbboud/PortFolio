"""Confirm auth + config work before building anything else.

Usage:
    export GITHUB_TOKEN=ghp_...
    export GITHUB_REPO=owner/repo
    python scripts/check_auth.py

Calls the read-only list_open_issues() tool and prints what it finds. If this
works, your token, repo, and network path are all good and you can move on to
the agent loop (Phase 2).
"""

from __future__ import annotations

import sys

from triage.github_tools import list_open_issues


def main() -> int:
    try:
        issues = list_open_issues()
    except Exception as exc:  # surface the typed error clearly, then exit non-zero
        print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"OK - {len(issues)} open issue(s):")
    for issue in issues:
        print(f"  #{issue['id']}  {issue['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
