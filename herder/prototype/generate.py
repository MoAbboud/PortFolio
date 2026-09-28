"""Emit `rules.generated.js` from herder's own Python rules. Read-only against the app.

    python prototype/generate.py

**Why generate rather than hand-write.** The prototype runs the same extraction and render rules
in a browser, and two hand-maintained copies of a regex is the kind of drift this project is
careful about - `domain/sentences.py` exists precisely because two sentence splitters would have
made "what did extraction miss" meaningless. So the Python modules stay the single source of
truth: this script imports them, reads `pattern.pattern` off the compiled objects, and writes
them out as data. Nothing is retyped.

`prototype/tests/test_parity.py` fails if the checked-in file is stale, and separately if the
JavaScript pipeline disagrees with the Python one on the eight benchmark conversations. Rules
generated but algorithms hand-ported is a real risk, and that test is what covers it.

**What cannot be generated: the merge step.** Merge needs `all-minilm` embeddings and a DeBERTa
cross-encoder - gigabytes of weights - so the browser gets extraction, render and residue, which
are pure, and does not get merge. `herder.js` says so and the page says so. See
`prototype/README.md`.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from herder.core.config import Settings  # noqa: E402
from herder.domain import render as R  # noqa: E402
from herder.domain import residue as RES  # noqa: E402
from herder.domain import sentences as S  # noqa: E402
from herder.domain.merge import CHANGE_CUE  # noqa: E402
from herder.extractors import heuristic as H  # noqa: E402
from herder.schemas.extraction import TITLE_MAX  # noqa: E402

OUT = Path(__file__).resolve().parent / "rules.generated.js"

# Python flag -> JavaScript flag. Only the three this project's patterns use are mapped; anything
# else is refused rather than dropped, because a silently missing flag changes what matches.
FLAGS = [(re.IGNORECASE, "i"), (re.DOTALL, "s"), (re.MULTILINE, "m")]
KNOWN = re.IGNORECASE | re.DOTALL | re.MULTILINE | re.UNICODE


def js_flags(pattern: re.Pattern[str]) -> str:
    leftover = pattern.flags & ~KNOWN
    if leftover:
        raise SystemExit(f"unmapped regex flag {leftover} on /{pattern.pattern[:40]}/")
    return "".join(js for flag, js in FLAGS if pattern.flags & flag)


def rx(pattern: re.Pattern[str]) -> dict:
    return {"source": pattern.pattern, "flags": js_flags(pattern)}


def main() -> int:
    payload = {
        "generatedFrom": "herder/herder/{extractors/heuristic,domain/sentences,domain/render,domain/residue,domain/merge}.py",
        "sentenceSplit": rx(S.SENTENCE_SPLIT),
        "fence": rx(S.FENCE),
        "rules": [
            {"kind": kind, "layer": layer, "why": why, "confidence": confidence, "pattern": rx(pattern)}
            for kind, layer, why, confidence, pattern in H.RULES
        ],
        "prohibitionOpening": rx(H._PROHIBITION_OPENING),
        "anaphoricRejection": rx(H._ANAPHORIC_REJECTION),
        "refusalWithAnaphor": rx(H._REFUSAL_WITH_ANAPHOR),
        "emptyRather": rx(H._EMPTY_RATHER),
        "pathy": rx(H._PATHY),
        "changeCue": rx(CHANGE_CUE),
        "residueQuestion": rx(RES._QUESTION),
        "minSentenceChars": H.MIN_SENTENCE_CHARS,
        "minProhibitionChars": H.MIN_PROHIBITION_CHARS,
        "minResidueChars": RES.MIN_RESIDUE_CHARS,
        "titleMax": TITLE_MAX,
        "extractorModel": H.HeuristicExtractor.model,
        "priority": dict(R.PRIORITY),
        "kindOrder": list(R.KIND_ORDER),
        "layerOrder": list(R.LAYER_ORDER),
        "layerHeadings": dict(R.LAYER_HEADINGS),
        "tailReserve": R.TAIL_RESERVE,
        "residueKind": R.RESIDUE_KIND,
        "residueHeading": R.RESIDUE_HEADING,
        "codeStateConfidence": 0.50,
        "fullSystem": full_system(),
    }

    write_rules(payload)
    write_page()
    return 0


def full_system() -> dict:
    """The models the full pipeline loads, so the page can name what it is a preview of.

    Read from the `Settings` field defaults rather than `get_settings()`, which reads the
    environment: a shell with `HERDER_NLI_MODEL` pointing at a fine-tune would otherwise write a
    different file and make the staleness test depend on who ran it.
    """
    default = lambda name: Settings.model_fields[name].default  # noqa: E731
    return {
        "extractModel": default("llm_model"),
        "embedModel": default("embed_model_tag"),
        "nliModel": default("nli_model"),
    }


# Lines that only exist to wire the modules together. Stripped when the three files are
# concatenated into one scope for the page.
_DROP = re.compile(r"^\s*(?:import\s.*?;|export\s+default\s.*?;|export\s*\{[^}]*\}\s*;)\s*$", re.M)
_UNEXPORT = re.compile(r"^export\s+(const|let|var|function|class|async)\b", re.M)


def bundle(source: str) -> str:
    """One module's source, flattened into a plain script.

    Concatenating modules is only safe because they are three files written to be concatenated:
    no name collides, and nothing depends on module scope. `node --check` runs over the result
    below, so a mistake here is a build failure rather than a blank page.
    """
    return _UNEXPORT.sub(r"\1", _DROP.sub("", source)).strip()


def write_page() -> None:
    """`index.html`, self-contained: no imports, no fetches, opens from `file://`.

    **Why it is one file rather than three with `<script type="module">`.** A module is fetched,
    and a fetched script is refused unless it arrives as JavaScript. Python's `http.server` on
    Windows reads the MIME type out of the registry and hands `.js` back as `text/plain`, which
    browsers will not execute as a module - so the obvious way to look at this locally was the one
    way that silently did not work. `deploy/_headers` sets `nosniff` too, which closes the same
    door on a host that guesses wrong. Inlining removes the failure mode instead of documenting it,
    and it means the page also works from a USB stick, offline, with no server at all.
    """
    here = Path(__file__).resolve().parent
    parts = [bundle((here / name).read_text(encoding="utf-8")) for name in ("rules.generated.js", "herder.js", "ui.js")]
    script = "\n\n".join(parts)

    page = (here / "page.html").read_text(encoding="utf-8")
    if "/* BUNDLE */" not in page:
        raise SystemExit("page.html has lost its /* BUNDLE */ placeholder")
    out = here / "index.html"
    out.write_text(
        page.replace(
            "/* BUNDLE */",
            "// GENERATED - edit page.html, ui.js or herder.js, then: python prototype/generate.py\n" + script,
        ),
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {out.relative_to(ROOT)} - {len(script)} bytes of script inlined")


def write_rules(payload: dict) -> None:
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    OUT.write_text(
        "// GENERATED FILE - do not edit by hand.\n"
        "//\n"
        "// Written by prototype/generate.py from herder's Python rules, so the browser and the\n"
        "// real pipeline cannot drift apart. Regenerate after changing any extraction or render\n"
        "// rule; prototype/tests/test_parity.py fails while this file is stale.\n"
        "//\n"
        "// Patterns are {source, flags} and become RegExp objects in herder.js. They are the\n"
        f"// Python sources verbatim.\n\nexport const RULES = {body};\n\nexport default RULES;\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {OUT.relative_to(ROOT)} - {len(payload['rules'])} rules, {len(body)} bytes")


if __name__ == "__main__":
    raise SystemExit(main())
