"""Running one job in a throwaway container.

The container is the wall between a submission and everything else on the server:

    --network none            no network at all
    --read-only               the root filesystem cannot be written
    --cap-drop ALL            no Linux capabilities
    --security-opt no-new-privileges
    --user 1000:1000          not root
    --pids-limit, --memory, --memory-swap, --cpus    a fork bomb, a memory bomb, a busy loop
    the app and the challenge mounted read-only, and nothing else mounted - no docker socket,
    no database: the container is not on any network the database is on

Inside, judge/entry.mjs keeps the app away from its own score (frozen intrinsics, locked globals,
Node's permission model, a nonce-marked result line). Out here: a wall-clock limit, a cap on how
much output is read, and the verdict.

A verdict is about the app - "ran", "timeout", "out_of_memory", "output_limit", "no_result" - and
the job is done. SandboxError is about the sandbox - Docker missing, the image missing - and the
job is retried.
"""

from __future__ import annotations

import json
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from codevscode.config import Settings, settings as default_settings

# Docker's own exit codes: it failed before or while starting the container.
DOCKER_FAILURES = {125: "docker could not start the container", 126: "the command could not run", 127: "the command was not found"}


class SandboxError(Exception):
    """The sandbox could not run the job. Not the app's fault; the job is retried."""


@dataclass
class Outcome:
    verdict: str
    results: list[dict[str, Any]] | None = None
    detail: str = ""
    seconds: float = 0.0
    exit_code: int | None = None
    output_bytes: int = 0
    stderr_tail: str = field(default="", repr=False)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def run(challenge_dir: Path, files: dict[str, str], kind: str = "judge", *, config: Settings | None = None) -> Outcome:
    """Run a challenge's tests (`kind` "judge": hidden tests; "house": the house's findings)
    against an app given as name -> text, in a fresh container."""
    config = config or default_settings
    if shutil.which("docker") is None:
        raise SandboxError("docker is not installed or not on PATH")
    work_root = config.judge_work_dir or None
    work = Path(tempfile.mkdtemp(prefix="cvc-job-", dir=work_root))
    name = f"cvc-judge-{secrets.token_hex(6)}"
    nonce = secrets.token_hex(16)
    try:
        app_dir = work / "app"
        app_dir.mkdir()
        for file_name, text in files.items():
            if "/" in file_name or "\\" in file_name or file_name.startswith("."):
                raise ValueError(f"not a plain file name: {file_name!r}")
            (app_dir / file_name).write_text(text, encoding="utf-8")
            (app_dir / file_name).chmod(0o644)
        # mkdtemp makes the folder readable by its owner only; the container runs as another user.
        work.chmod(0o755)
        app_dir.chmod(0o755)
        command = [
            "docker", "run", "--rm", "-i", "--name", name,
            "--network", "none",
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "1000:1000",
            "--pids-limit", str(config.judge_pids),
            "--memory", config.judge_memory,
            "--memory-swap", config.judge_memory,
            "--cpus", config.judge_cpus,
            "--ulimit", "nofile=256:256",
            "--mount", f"type=bind,src={Path(challenge_dir).resolve()},dst=/work/challenge,readonly",
            "--mount", f"type=bind,src={app_dir.resolve()},dst=/work/app,readonly",
            config.judge_image,
            "house" if kind == "house" else "hidden", "/work/challenge", "/work/app",
        ]
        return _execute(command, name, nonce, config)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _execute(command: list[str], name: str, nonce: str, config: Settings) -> Outcome:
    started = time.monotonic()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout = _Capped(process.stdout, config.judge_output_limit_bytes)
    stderr = _Capped(process.stderr, 20_000)
    stdout.start()
    stderr.start()
    try:
        process.stdin.write(f"{nonce}\n".encode())
        process.stdin.close()
    except OSError:
        pass  # The container already exited; its exit code says why.

    verdict = None
    deadline = started + config.judge_timeout_seconds
    while process.poll() is None:
        if stdout.over_limit:
            verdict = "output_limit"
            break
        if time.monotonic() > deadline:
            verdict = "timeout"
            break
        time.sleep(0.05)
    if verdict:
        _kill(name)
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    stdout.join(5)
    stderr.join(5)
    seconds = round(time.monotonic() - started, 2)
    code = process.returncode
    err = stderr.text()
    base = {"seconds": seconds, "exit_code": code, "output_bytes": stdout.total, "stderr_tail": err[-2000:]}

    if verdict == "timeout":
        return Outcome("timeout", detail=f"stopped after {config.judge_timeout_seconds:g} s", **base)
    if verdict == "output_limit":
        return Outcome("output_limit", detail=f"printed more than {config.judge_output_limit_bytes} bytes", **base)
    # Docker's own failures are told apart by what Docker prints, not the exit code alone: an app
    # can call process.exit(125) too, and that is the app's result, not a reason to retry.
    if code in DOCKER_FAILURES and _docker_complained(err):
        raise SandboxError(f"{DOCKER_FAILURES[code]} (exit {code}): {err.strip()[-500:]}")
    if "heap out of memory" in err or "Reached heap limit" in err or code == 137:
        return Outcome("out_of_memory", detail="ran out of memory", **base)

    line = _last_line_with(stdout.data(), nonce)
    if line is None:
        return Outcome("no_result", detail="the run ended without a result - the app may have stopped the process", **base)
    report = json.loads(line[len(nonce) + 1 :])
    if "error" in report:
        return Outcome("error", detail=f"the judge could not load the challenge or the app: {report['error']}", **base)
    return Outcome("ran", results=report["results"], **base)


def _docker_complained(stderr: str) -> bool:
    return any(sign in stderr for sign in ("docker: ", "Error response from daemon", "Unable to find image"))


def _last_line_with(data: bytes, nonce: str) -> str | None:
    marker = nonce.encode()
    found = None
    for raw in data.splitlines():
        if raw.startswith(marker + b" "):
            found = raw
    return found.decode("utf-8", errors="replace") if found is not None else None


def _kill(name: str) -> None:
    subprocess.run(["docker", "kill", name], capture_output=True, timeout=30, check=False)


class _Capped(threading.Thread):
    """Reads a stream to the end, keeping at most `limit` bytes; counts the rest."""

    def __init__(self, stream: Any, limit: int) -> None:
        super().__init__(daemon=True)
        self.stream = stream
        self.limit = limit
        self.chunks: list[bytes] = []
        self.kept = 0
        self.total = 0
        self.over_limit = False

    def run(self) -> None:
        while True:
            chunk = self.stream.read1(65536) if hasattr(self.stream, "read1") else self.stream.read(65536)
            if not chunk:
                break
            self.total += len(chunk)
            if self.kept < self.limit:
                keep = chunk[: self.limit - self.kept]
                self.chunks.append(keep)
                self.kept += len(keep)
            if self.total > self.limit:
                self.over_limit = True

    def data(self) -> bytes:
        return b"".join(self.chunks)

    def text(self) -> str:
        return self.data().decode("utf-8", errors="replace")
