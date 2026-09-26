"""The browser prototype must agree with the real pipeline, and its rules must be current.

    python -m pytest prototype

Not under `tests/`, so the app's own suite is untouched. Run it alongside, or in CI.

Two failures are possible and they are different problems. A **stale** `rules.generated.js` means
a rule changed in Python and the prototype is still serving the old one - regenerate. A **parity**
failure means the hand-ported algorithm in `herder.js` disagrees with `heuristic.py` on real
conversations, which is the risk that generating the patterns does not cover.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
PROTOTYPE = ROOT / "prototype"
DATASETS = ROOT / "bench" / "datasets"

sys.path.insert(0, str(ROOT))

from herder.domain.chunking import Chunk, ChunkMessage  # noqa: E402
from herder.domain.residue import ResidueSentence, uncovered  # noqa: E402
from herder.domain.sentences import split_sentences, strip_fences  # noqa: E402
from herder.extractors.heuristic import HeuristicExtractor  # noqa: E402

node = shutil.which("node")
needs_node = pytest.mark.skipif(node is None, reason="node is not installed")


def conversations() -> list[Path]:
    return sorted(p for p in DATASETS.iterdir() if (p / "conversation.txt").exists())


def python_turns(text: str) -> list[tuple[str, str]]:
    """The benchmark transcripts, split the way the harness stores them: blank-line separated
    turns, each labelled. Kept simple on purpose - the point is to feed both implementations the
    same messages, not to re-test the paste parser."""
    turns = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        block = block.strip()
        if not block:
            continue
        lowered = block.lower()
        if lowered.startswith("user:"):
            turns.append(("user", block[5:].strip()))
        elif lowered.startswith("assistant:"):
            turns.append(("assistant", block[10:].strip()))
    return turns


@pytest.fixture(scope="module")
def ported() -> dict:
    result = subprocess.run(
        [node, str(PROTOTYPE / "parity.mjs")], capture_output=True, text=True, encoding="utf-8", cwd=ROOT
    )
    assert result.returncode == 0, f"parity.mjs failed:\n{result.stderr}"
    return json.loads(result.stdout)


@pytest.mark.parametrize("name", ["rules.generated.js", "index.html"])
def test_the_generated_files_are_current(name: str) -> None:
    """Regenerating must not change a checked-in generated file.

    `rules.generated.js` stale means a rule moved in Python and the prototype is serving the old
    one. `index.html` stale means `page.html`, `ui.js` or `herder.js` changed and the page a
    visitor loads - which has them inlined - was not rebuilt.
    """
    generated = PROTOTYPE / name
    before = generated.read_text(encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(PROTOTYPE / "generate.py")], capture_output=True, text=True, cwd=ROOT
    )
    assert result.returncode == 0, result.stderr
    assert generated.read_text(encoding="utf-8") == before, (
        f"{name} is stale - run: python prototype/generate.py"
    )


@needs_node
def test_the_page_renders_a_brief_from_its_own_sample() -> None:
    """Runs the generated page's script against a stub DOM. The parity tests cover the pipeline;
    this covers the page around it, where a mistake shows up as a blank panel and no error."""
    result = subprocess.run(
        [node, str(PROTOTYPE / "smoke.mjs")], capture_output=True, text=True, encoding="utf-8", cwd=ROOT
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"


@needs_node
def test_the_published_page_needs_no_other_file() -> None:
    """`deploy/build-static.mjs` publishes `index.html` alone, so anything it still reaches for at
    runtime would 404 on the live site."""
    page = (PROTOTYPE / "index.html").read_text(encoding="utf-8")
    for forbidden in ("herder.js", "rules.generated.js", "ui.js"):
        assert f'"./{forbidden}"' not in page and f"'./{forbidden}'" not in page, (
            f"index.html still loads {forbidden} at runtime"
        )


@needs_node
@pytest.mark.parametrize("folder", conversations(), ids=lambda p: p.name)
def test_extraction_matches_the_python_extractor(folder: Path, ported: dict) -> None:
    text = (folder / "conversation.txt").read_text(encoding="utf-8")
    turns = python_turns(text)

    messages = tuple(
        ChunkMessage(id=uuid.uuid4(), role=role, content=content, token_count=0)
        for role, content in turns
    )
    outcome = HeuristicExtractor().extract(Chunk(messages=messages, token_count=0), [])
    expected = [(c.kind, c.layer, c.text) for c in outcome.candidates]

    got = [(c["kind"], c["layer"], c["text"]) for c in ported[folder.name]["candidates"]]
    assert got == expected


@needs_node
@pytest.mark.parametrize("folder", conversations(), ids=lambda p: p.name)
def test_residue_matches_the_python_residue(folder: Path, ported: dict) -> None:
    text = (folder / "conversation.txt").read_text(encoding="utf-8")
    turns = python_turns(text)

    messages = tuple(
        ChunkMessage(id=uuid.uuid4(), role=role, content=content, token_count=0)
        for role, content in turns
    )
    outcome = HeuristicExtractor().extract(Chunk(messages=messages, token_count=0), [])

    sentences = []
    for role, content in turns:
        if role != "user":
            continue
        body, _ = strip_fences(content)
        sentences.extend(ResidueSentence(text=s) for s in split_sentences(body))
    expected = [s.text for s in uncovered(sentences, [c.text for c in outcome.candidates])]

    assert ported[folder.name]["residue"] == expected


@needs_node
def test_only_the_users_turns_are_ever_read(ported: dict) -> None:
    """The rule that outranks every other rule, asserted against the port as well: nothing an
    assistant said may appear as a candidate."""
    for folder in conversations():
        text = (folder / "conversation.txt").read_text(encoding="utf-8")
        assistant = {c for role, c in python_turns(text) if role == "assistant"}
        for candidate in ported[folder.name]["candidates"]:
            assert not any(candidate["text"] in turn for turn in assistant), candidate["text"]
