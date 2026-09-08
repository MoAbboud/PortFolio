"""Prompt loading, with versions.

Every prompt file carries a `# version:` header on its first line, and that version is
written to the `model_calls` row on every call that uses it. A prompt change with no version
bump makes every earlier measurement unattributable, which is the quiet way a harness stops
meaning anything - so the loader refuses a file without one rather than defaulting.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

PROMPTS = Path(__file__).resolve().parent


class PromptError(RuntimeError):
    pass


@lru_cache
def load_prompt(name: str) -> tuple[str, str]:
    """Return (body, version) for a prompt file."""
    path = PROMPTS / name
    if not path.exists():
        raise PromptError(f"no prompt file at {path}")

    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or not lines[0].lower().startswith("# version:"):
        raise PromptError(
            f"{name} has no '# version:' header on its first line. Without one, a result "
            "produced by this prompt cannot be attributed to a version of it."
        )

    version = lines[0].split(":", 1)[1].strip()
    if not version:
        raise PromptError(f"{name} has an empty version header")

    return "\n".join(lines[1:]).strip(), version
