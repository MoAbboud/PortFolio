"""The benchmark's model calls: the reader, and the summariser `naive_summary` uses.

Both are the same local model the product uses (`HERDER_LLM_MODEL`), at temperature 0, through
the same Ollama client. **Holding the reader constant is what makes the comparison mean
anything**: every method's context is judged by one model with one prompt, so a difference in
score is a difference in the context.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, ValidationError

from herder.core.verify_models import CallOutcome, _OllamaChat

PROMPTS = Path(__file__).resolve().parent / "prompts"


def load_prompt(name: str) -> tuple[str, str]:
    """(body, version), the same `# version:` header rule as herder's own prompts."""
    lines = (PROMPTS / name).read_text(encoding="utf-8").splitlines()
    if not lines or not lines[0].lower().startswith("# version:"):
        raise RuntimeError(f"bench/prompts/{name} has no '# version:' header")
    return "\n".join(lines[1:]).strip(), lines[0].split(":", 1)[1].strip()


def sections(body: str) -> dict[str, str]:
    marker = re.compile(r"^##\s*(\w+)\s*$", re.MULTILINE)
    found = list(marker.finditer(body))
    return {
        m.group(1): body[m.end() : found[i + 1].start() if i + 1 < len(found) else len(body)].strip()
        for i, m in enumerate(found)
    }


class Verdict(BaseModel):
    verdict: Literal["true", "false", "not_stated"]


class Reader:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self._chat = _OllamaChat(client)
        self.model = self._chat.model
        self._system, self.prompt_version = load_prompt("read.md")

    def check_ready(self) -> None:
        self._chat.check_ready()

    def judge(self, context: str, statement: str) -> tuple[str, CallOutcome]:
        """The verdict, or "error". The context comes first and the statement last, so Ollama's
        prompt cache reuses the context across every fact read against it."""
        messages = [
            {"role": "system", "content": self._system},
            {"role": "user", "content": f"Context:\n<<<\n{context or '(no context)'}\n>>>\n\nStatement: {statement}"},
        ]
        call = self._chat.chat(messages, self.prompt_version, schema=Verdict.model_json_schema())
        if call.failed:
            return "error", call
        try:
            return Verdict.model_validate_json(call.content).verdict, call
        except ValidationError as exc:
            call.failed, call.error = True, f"verdict did not validate: {exc}"
            return "error", call


class Summariser:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self._chat = _OllamaChat(client)
        self.model = self._chat.model
        body, self.prompt_version = load_prompt("summarise.md")
        parts = sections(body)
        self._map, self._reduce = parts["map"], parts["reduce"]

    def summarise_part(self, text: str, words: int) -> CallOutcome:
        system = self._map.replace("{words}", str(words))
        return self._chat.chat([{"role": "system", "content": system}, {"role": "user", "content": text}], self.prompt_version)

    def combine(self, summaries: list[str], words: int) -> CallOutcome:
        joined = "\n\n".join(f"Part {i + 1}:\n{s}" for i, s in enumerate(summaries))
        return self._chat.chat(
            [{"role": "system", "content": self._reduce.replace("{words}", str(words))}, {"role": "user", "content": joined}],
            self.prompt_version,
        )
