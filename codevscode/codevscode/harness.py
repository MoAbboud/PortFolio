"""The model harness: replay a challenge's scripted conversations through a model, then score
the app it ends with against the hidden tests.

The model is any function from chat messages to reply text, so the same harness measures a
base model under transformers, a 4-bit build under MLC, the fine-tune, and the tiny
from-scratch model - and is tested here with fakes. The prompt and the reply parsing are the
game's own JavaScript (helper/), called through tools/helper.mjs, so a model is measured on
the prompt players will give it. Scoring is tools/run.mjs, the shared runner.

Needs Node with the project's npm packages installed (`npm ci` in codevscode/).
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PROJECT = Path(__file__).resolve().parents[1]

CATEGORIES = ("correctness", "security", "efficiency", "practicality")

# Messages in, reply text out.
Generate = Callable[[list[dict[str, str]]], str]


@dataclass
class Challenge:
    """The parts of a challenge the harness needs."""

    dir: Path
    id: str
    files: list[str]
    brief: str
    iface: str
    answers: dict[str, str]
    starter: dict[str, str]
    scripts: dict[str, dict[str, Any]]


def load_challenge(directory: Path | str) -> Challenge:
    root = Path(directory).resolve()
    meta = json.loads((root / "challenge.json").read_text(encoding="utf-8"))
    requirements = json.loads((root / "hidden/requirements.json").read_text(encoding="utf-8"))
    starter = {}
    for name in meta["files"]:
        path = root / "public/starter" / name
        starter[name] = path.read_text(encoding="utf-8") if path.exists() else ""
    scripts = {}
    for path in sorted((root / "hidden/scripts").glob("*.json")):
        script = json.loads(path.read_text(encoding="utf-8"))
        scripts[script["id"]] = script
    return Challenge(
        dir=root,
        id=meta["id"],
        files=list(meta["files"]),
        brief=(root / "public/brief.md").read_text(encoding="utf-8"),
        iface=(root / "public/interface.md").read_text(encoding="utf-8"),
        answers={r["id"]: r["answer"] for r in requirements},
        starter=starter,
        scripts=scripts,
    )


def _node(script: str, payload: Any = None, *args: str) -> Any:
    completed = subprocess.run(
        ["node", str(PROJECT / script), *args],
        input=None if payload is None else json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=PROJECT,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"node {script} failed: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def helper(op: str, **payload: Any) -> Any:
    """Call the game's helper code: "messages", "parse" or "condense"."""
    return _node("tools/helper.mjs", {"op": op, **payload})


@dataclass
class Turn:
    message: str
    reply: str
    wrote: list[str]
    skipped: list[str]
    seconds: float


@dataclass
class Replay:
    script: str
    files: dict[str, str]
    turns: list[Turn] = field(default_factory=list)


def replay(
    challenge: Challenge,
    script_id: str,
    generate: Generate,
    *,
    helper_name: str = "cvchelper",
    budget_tokens: int = 12000,
) -> Replay:
    """Play one scripted conversation: each player message, the model's reply, the files it
    wrote applied before the next message - exactly as the workspace will."""
    script = challenge.scripts[script_id]
    revealed = [challenge.answers[r] for r in script.get("revealed", [])]
    files = dict(challenge.starter)
    history: list[dict[str, str]] = []
    result = Replay(script=script_id, files=files)
    for message in script["messages"]:
        messages = helper(
            "messages",
            name=helper_name,
            brief=challenge.brief,
            iface=challenge.iface,
            revealed=revealed,
            files=files,
            history=history,
            message=message,
            budgetTokens=budget_tokens,
        )
        started = time.perf_counter()
        reply = generate(messages)
        seconds = time.perf_counter() - started
        parsed = helper("parse", text=reply, allowed=challenge.files)
        files.update(parsed["files"])
        history += [
            {"role": "user", "content": message},
            {"role": "assistant", "content": helper("condense", text=reply)},
        ]
        result.turns.append(
            Turn(message, reply, sorted(parsed["files"]), parsed["skipped"], seconds)
        )
    result.files = files
    return result


def score(challenge: Challenge, files: dict[str, str]) -> list[dict[str, Any]]:
    """Run the hidden tests against an app given as name -> text."""
    with tempfile.TemporaryDirectory(prefix="cvc-app-") as folder:
        for name, text in files.items():
            (Path(folder) / name).write_text(text, encoding="utf-8")
        return _node("tools/run.mjs", None, str(challenge.dir), folder, "--json")["results"]


def summarise(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Passes per category, the total, and whether the app even loaded."""
    summary: dict[str, Any] = {}
    for category in CATEGORIES:
        mine = [r for r in results if r["category"] == category]
        summary[category] = f"{sum(r['status'] == 'pass' for r in mine)}/{len(mine)}"
    summary["passed"] = sum(r["status"] == "pass" for r in results)
    summary["of"] = len(results)
    broken = ("app.js did not load", "schema.sql did not run", "app.js does not export")
    summary["loads"] = not any(r["message"].startswith(broken) for r in results)
    return summary


def measure(
    challenge: Challenge, generate: Generate, label: str, **replay_options: Any
) -> list[dict[str, Any]]:
    """Every scripted conversation of a challenge through one model: one row per script."""
    rows = []
    for script_id in challenge.scripts:
        played = replay(challenge, script_id, generate, **replay_options)
        rows.append(
            {
                "model": label,
                "challenge": challenge.id,
                "script": script_id,
                **summarise(score(challenge, played.files)),
                "seconds": round(sum(t.seconds for t in played.turns), 1),
                "files_written": sorted({f for t in played.turns for f in t.wrote}),
                "replay": played,
            }
        )
    return rows
