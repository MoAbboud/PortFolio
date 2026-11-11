"""The sandbox, against real containers: the reference passes, each planted bug fails exactly its
tests, and each kind of hostile submission is contained.

Needs Docker and the judge image (docker build -t codevscode-judge -f judge/Dockerfile .).
Skipped without them, except in CI (REQUIRE_DOCKER=1).
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from codevscode.config import Settings
from codevscode.judge import sandbox
from codevscode.judge.sandbox import SandboxError

PROJECT = Path(__file__).resolve().parents[1]
SAMPLE = PROJECT / "challenges" / "sample"
TINY = PROJECT / "test" / "fixtures" / "tiny"
CONFIG = Settings(judge_timeout_seconds=20, judge_output_limit_bytes=200_000)


def _judge_image_ready() -> bool:
    try:
        return subprocess.run(["docker", "image", "inspect", CONFIG.judge_image], capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


if not _judge_image_ready():
    if os.environ.get("REQUIRE_DOCKER") == "1":
        raise RuntimeError("REQUIRE_DOCKER=1 but Docker or the codevscode-judge image is missing")
    pytest.skip("Docker and the codevscode-judge image are needed for the sandbox tests", allow_module_level=True)


def reference(challenge: Path) -> dict[str, str]:
    return {name: (challenge / "hidden/reference" / name).read_text(encoding="utf-8") for name in ("app.js", "schema.sql")}


def tiny_app(source: str) -> dict[str, str]:
    return {"app.js": source, "schema.sql": (TINY / "hidden/reference/schema.sql").read_text(encoding="utf-8")}


def passed(outcome: sandbox.Outcome) -> list[str]:
    return [r["id"] for r in outcome.results if r["status"] == "pass"]


def test_the_reference_passes_every_hidden_test() -> None:
    outcome = sandbox.run(SAMPLE, reference(SAMPLE), config=CONFIG)

    assert outcome.verdict == "ran", outcome
    assert len(outcome.results) == 42
    assert len(passed(outcome)) == 42


def test_each_planted_bug_fails_exactly_its_tests_in_the_sandbox() -> None:
    files = reference(SAMPLE)
    for bug in json.loads((SAMPLE / "hidden/bugs.json").read_text(encoding="utf-8")):
        planted = dict(files)
        for edit in bug["edits"]:
            assert planted[edit["file"]].count(edit["find"]) == 1
            planted[edit["file"]] = planted[edit["file"]].replace(edit["find"], edit["replace"])
        outcome = sandbox.run(SAMPLE, planted, config=CONFIG)
        failed = sorted(r["id"] for r in outcome.results if r["status"] == "fail")
        assert failed == sorted(bug["fails"]), bug["id"]


def test_the_house_findings_run_as_their_own_kind_of_job() -> None:
    outcome = sandbox.run(SAMPLE, reference(SAMPLE), "house", config=CONFIG)

    assert outcome.verdict == "ran"
    assert [r["id"] for r in outcome.results] == ["house/blank-title", "house/half-update", "house/delete-twice"]
    assert len(passed(outcome)) == 3


# Hostile submissions. Each must end in a verdict about the app, inside the limits, with the
# server untouched.


def test_an_endless_loop_is_stopped_at_the_time_limit() -> None:
    outcome = sandbox.run(TINY, tiny_app("export async function handle() { for (;;) {} }"), config=CONFIG)

    assert outcome.verdict == "timeout"
    assert outcome.seconds < CONFIG.judge_timeout_seconds + 15


def test_a_memory_bomb_runs_out_of_memory() -> None:
    app = "const hog = [];\nexport async function handle() { for (;;) hog.push(new Array(1e6).fill(7)); }"
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "out_of_memory", outcome


def test_spawning_processes_is_refused() -> None:
    app = """export async function handle() {
      const cp = process.getBuiltinModule("child_process");
      for (let i = 0; i < 500; i++) cp.spawn("sh", ["-c", "sleep 60"]);
      return { status: 200, body: {} };
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    # The permission model refuses the spawn, so handle() throws: every test sees a crash.
    assert outcome.verdict == "ran"
    assert passed(outcome) == []


def test_there_is_no_network() -> None:
    app = """export async function handle() {
      await fetch("http://1.1.1.1/");
      return { status: 201, body: { word: "x" } };
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "ran"
    assert passed(outcome) == []  # every request threw: the fetch never got out


def test_writing_files_is_refused() -> None:
    app = """export async function handle() {
      process.getBuiltinModule("fs").writeFileSync("/work/app/planted.txt", "x");
      return { status: 201, body: { word: "x" } };
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "ran"
    assert passed(outcome) == []


def test_flooding_the_output_is_cut_off() -> None:
    # writeSync, because process.stdout.write into a pipe buffers in memory and the app runs out
    # of memory first (also contained - see the memory bomb).
    app = """export async function handle() {
      const fs = process.getBuiltinModule("fs");
      const s = "x".repeat(1 << 16);
      for (;;) fs.writeSync(1, s);
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "output_limit", outcome
    assert outcome.output_bytes > CONFIG.judge_output_limit_bytes


def test_stopping_the_process_gives_no_result_rather_than_a_score() -> None:
    outcome = sandbox.run(TINY, tiny_app("export async function handle() { process.exit(0); }"), config=CONFIG)

    assert outcome.verdict == "no_result"


def test_an_app_exit_code_is_never_mistaken_for_docker_failing() -> None:
    outcome = sandbox.run(TINY, tiny_app("export async function handle() { process.exit(125); }"), config=CONFIG)

    assert outcome.verdict == "no_result"


def test_a_forged_result_line_is_ignored() -> None:
    app = """export async function handle() {
      process.stdout.write("\\n" + "a".repeat(32) + ' {"results":[{"id":"x","status":"pass"}]}\\n');
      return { status: 500, body: { error: "no" } };
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "ran"
    assert [r["id"] for r in outcome.results] == ["correctness/add-and-list", "security/no-injection", "efficiency/capped", "practicality/bad-json"]
    assert "x" not in passed(outcome)


def test_tampering_with_built_ins_cannot_make_tests_pass() -> None:
    app = """export async function handle() {
      try { Object.is = () => true; } catch {}
      try { globalThis.JSON = { stringify: () => "{}", parse: () => ({}) }; } catch {}
      try { String.prototype.includes = () => true; } catch {}
      return { status: 500, body: { error: "no" } };
    }"""
    outcome = sandbox.run(TINY, tiny_app(app), config=CONFIG)

    assert outcome.verdict == "ran"
    assert passed(outcome) == []


def test_a_missing_image_is_the_sandbox_failing_not_the_app() -> None:
    with pytest.raises(SandboxError):
        sandbox.run(TINY, reference(TINY), config=Settings(judge_image="codevscode-judge-does-not-exist"))


def test_file_names_cannot_reach_outside_the_job_folder() -> None:
    with pytest.raises(ValueError):
        sandbox.run(TINY, {"../escape.js": "x"}, config=CONFIG)
