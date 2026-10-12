"""The model harness, driven by fake models. A real model is plugged in the same way on Colab.

Needs Node and the npm packages. Skipped without them, except in CI (REQUIRE_NODE=1).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from codevscode.harness import PROJECT, check, load_challenge, measure, replay, score, summarise

SAMPLE = PROJECT / "challenges" / "sample"

if not (shutil.which("node") and (PROJECT / "node_modules" / "sql.js").exists()):
    if os.environ.get("REQUIRE_NODE") == "1":
        raise RuntimeError("REQUIRE_NODE=1 but node or the npm packages are missing")
    pytest.skip("node and `npm ci` are needed for the harness", allow_module_level=True)


def reference_reply() -> str:
    """What a perfect helper would answer: the reference app, in the asked-for format."""
    blocks = []
    for name, lang, marker in [
        ("app.js", "js", "// file: app.js"),
        ("schema.sql", "sql", "-- file: schema.sql"),
        ("index.html", "html", "<!-- file: index.html -->"),
    ]:
        text = (SAMPLE / "hidden/reference" / name).read_text(encoding="utf-8")
        blocks.append(f"```{lang}\n{marker}\n{text}```")
    return "Here is the app.\n\n" + "\n\n".join(blocks)


def test_a_perfect_helper_scores_everything() -> None:
    challenge = load_challenge(SAMPLE)

    rows = measure(challenge, lambda messages: reference_reply(), "perfect")

    assert [row["script"] for row in rows] == ["asks-everything", "asks-nothing"]
    for row in rows:
        assert row["passed"] == row["of"] == 42, row
        assert row["loads"] is True
        assert row["files_written"] == ["app.js", "index.html", "schema.sql"]


def test_a_helper_that_writes_no_code_leaves_the_starter() -> None:
    challenge = load_challenge(SAMPLE)

    played = replay(challenge, "asks-nothing", lambda messages: "I am not sure how to do that.")
    summary = summarise(score(challenge, played.files))

    assert played.files == challenge.starter
    # The scaffolded starter routes, so an unknown address already answers 404.
    assert summary["passed"] == 1
    assert summary["loads"] is True


def test_code_that_does_not_parse_is_reported_as_not_loading() -> None:
    challenge = load_challenge(SAMPLE)

    played = replay(challenge, "asks-nothing", lambda m: "```js\n// file: app.js\nexport async function handle( {\n```")
    summary = summarise(score(challenge, played.files))

    assert summary["loads"] is False
    assert summary["passed"] == 0


def test_the_helper_is_told_only_what_the_script_revealed_and_sees_condensed_history() -> None:
    challenge = load_challenge(SAMPLE)
    seen: list[list[dict[str, str]]] = []

    def spy(messages: list[dict[str, str]]) -> str:
        seen.append(messages)
        return "Done.\n```js\n// file: app.js\nexport async function handle() { return { status: 404 }; }\n```"

    replay(challenge, "asks-everything", spy, helper_name="Pixel")
    lockout = challenge.answers["lockout"]
    assert lockout in seen[0][0]["content"]
    assert seen[0][0]["content"].startswith("You are Pixel")
    # Turn two: the first exchange is in history, its code replaced by a note.
    assert [m["role"] for m in seen[1]] == ["system", "user", "assistant", "user"]
    assert seen[1][2]["content"] == "Done.\n[wrote app.js]"
    # And the file the helper wrote is what it now sees.
    assert "return { status: 404 }" in seen[1][0]["content"]

    nothing: list[list[dict[str, str]]] = []
    replay(challenge, "asks-nothing", lambda m: nothing.append(m) or "ok")
    assert lockout not in nothing[0][0]["content"]
    assert "Nothing yet." in nothing[0][0]["content"]


def test_the_sample_loads_with_its_answers_and_scripts() -> None:
    challenge = load_challenge(Path(SAMPLE))

    assert challenge.id == "sample"
    assert set(challenge.answers) == {"search", "paging", "limits", "newest-first", "email-case", "lockout"}
    assert set(challenge.scripts) == {"asks-everything", "asks-nothing"}


def app_block(source: str) -> str:
    return f"```js\n// file: app.js\n{source}\n```"


def test_repair_turns_pass_back_what_the_workspace_shows_until_the_app_runs() -> None:
    challenge = load_challenge(SAMPLE)
    handle = "export async function handle() { return { status: 404 }; }"
    broken = app_block(f"import crypto from 'crypto';\n{handle}")
    fixed = app_block(handle)
    seen: list[str] = []

    def model(messages: list[dict[str, str]]) -> str:
        seen.append(messages[-1]["content"])
        return fixed if "does not run" in messages[-1]["content"] else broken

    played = replay(challenge, "asks-nothing", model, repair_turns=2)

    assert [t.repair for t in played.turns] == [False, True]
    assert seen[1] == (
        "The app does not run. The workspace shows:\n"
        "- app.js does not load: app.js must not import anything.\n"
        "Fix it."
    )
    assert check(played.files) == []


def test_repair_turns_stop_at_the_limit_and_never_start_for_an_app_that_runs() -> None:
    challenge = load_challenge(SAMPLE)
    stubborn = app_block("import x from 'x';\nexport async function handle() {}")

    played = replay(challenge, "asks-nothing", lambda m: stubborn, repair_turns=2)
    assert [t.repair for t in played.turns] == [False, True, True]

    fine = replay(challenge, "asks-nothing", lambda m: "No changes needed.", repair_turns=2)
    assert [t.repair for t in fine.turns] == [False]


def test_the_scaffolded_starter_runs() -> None:
    assert check(load_challenge(SAMPLE).starter) == []


