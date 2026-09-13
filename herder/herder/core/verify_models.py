"""The two generative calls a checkpoint makes: writing a probe, and answering one.

Both go to the same local model through Ollama as the local extractor does, at temperature 0.
Grading is not here - it is NLI, in `core/nli.py`, and deliberately not a generative model.

**This is the weaker half of the instrument, and it should be said plainly.** A local model
writes the question and its expected answer, a local model answers it, and a model grades the
answer. That is one system agreeing with itself, and the in-product integrity score inherits
that weakness. What breaks the circle is stage 9's hand-written ground truth, and that is the
number the README quotes - never this one.

## Truncation is checked before sending, not after

The extractor compares what it sent with Ollama's `prompt_eval_count`. That cannot work here:
a checkpoint sends the same pack six times, Ollama caches the shared prefix, and the count
then reports only the tokens it did not have cached - which would read as truncation on every
call after the first. The cause of truncation is known (Ollama gives the prompt half of
`num_ctx`), so the check is made on that instead, before any time is spent.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from herder.core.config import get_settings
from herder.core.tokens import count_tokens
from herder.prompts import load_prompt
from herder.schemas.probes import EntryProbeSpec, ProbeSpec

IMPLEMENTATION = "local"
MESSAGE_LABEL = "message"


class ModelUnavailable(RuntimeError):
    """Ollama or the model is missing. Raised with the fix in the message."""


@dataclass
class CallOutcome:
    """One call's result and everything `model_calls` records about it."""

    model: str
    prompt_version: str
    content: str = ""
    failed: bool = False
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    load_ms: int = 0
    prompt_ms: int = 0
    generation_ms: int = 0


@dataclass
class ProbeOutcome:
    call: CallOutcome
    spec: ProbeSpec | None = None


class _OllamaChat:
    def __init__(self, client: httpx.Client | None = None) -> None:
        settings = get_settings()
        self.model = settings.llm_model
        self._url = settings.ollama_url.rstrip("/")
        self._timeout = settings.llm_timeout_seconds
        self._num_ctx = settings.llm_num_ctx
        self._keep_alive = settings.llm_keep_alive
        self._client = client or httpx.Client()

    def check_ready(self) -> None:
        try:
            response = self._client.get(f"{self._url}/api/tags", timeout=5)
            response.raise_for_status()
        except Exception as exc:
            raise ModelUnavailable(
                f"a checkpoint needs Ollama and there is none at {self._url}. Start it with "
                "`ollama serve`. From inside Docker the host is http://host.docker.internal:11434."
            ) from exc
        available = [m.get("name", "") for m in response.json().get("models", [])]
        if not any(name == self.model or name.startswith(f"{self.model}:") for name in available):
            raise ModelUnavailable(f"the model {self.model!r} is not pulled. Run: ollama pull {self.model}")

    def chat(self, messages: list[dict], prompt_version: str, schema: dict | None = None) -> CallOutcome:
        outcome = CallOutcome(model=self.model, prompt_version=prompt_version)

        sent = sum(count_tokens(m["content"]) for m in messages)
        usable = self._num_ctx // 2
        if sent > usable * 0.9:
            outcome.failed = True
            outcome.error = (
                f"the prompt is about {sent} tokens and Ollama gives a prompt only half of "
                f"num_ctx ({usable}). Raise HERDER_LLM_NUM_CTX to at least {2 * sent}."
            )
            return outcome

        body: dict = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "keep_alive": self._keep_alive,
            "options": {"temperature": 0, "num_ctx": self._num_ctx},
        }
        if schema is not None:
            body["format"] = schema

        started = time.perf_counter()
        try:
            response = self._client.post(f"{self._url}/api/chat", json=body, timeout=self._timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException:
            outcome.failed, outcome.error = True, f"inference timed out after {self._timeout}s"
            payload = {}
        except Exception as exc:
            outcome.failed, outcome.error = True, f"{type(exc).__name__}: {exc}"
            payload = {}

        outcome.latency_ms = int((time.perf_counter() - started) * 1000)
        outcome.content = ((payload.get("message") or {}).get("content") or "").strip()
        outcome.input_tokens = int(payload.get("prompt_eval_count", 0))
        outcome.output_tokens = int(payload.get("eval_count", 0))
        outcome.load_ms = int(payload.get("load_duration", 0) / 1_000_000)
        outcome.prompt_ms = int(payload.get("prompt_eval_duration", 0) / 1_000_000)
        outcome.generation_ms = int(payload.get("eval_duration", 0) / 1_000_000)
        return outcome


class LocalProbeGenerator:
    name = IMPLEMENTATION

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._chat = _OllamaChat(client)
        self.model = self._chat.model
        self._system, self.prompt_version = load_prompt("probe_gen.md")

    def check_ready(self) -> None:
        self._chat.check_ready()

    def generate(self, label: str, content: str) -> ProbeOutcome:
        """`label` is the entry kind, or `message` for raw material.

        An entry decodes under a grammar with no way to say "no fact" - see `schemas/probes.py`
        for what happened when it had one.
        """
        is_message = label == MESSAGE_LABEL
        messages = [
            {"role": "system", "content": self._system},
            {"role": "user", "content": f"Content: [{label}] {content}"},
        ]
        schema = (ProbeSpec if is_message else EntryProbeSpec).model_json_schema()
        call = self._chat.chat(messages, self.prompt_version, schema=schema)
        if call.failed:
            return ProbeOutcome(call)
        try:
            if is_message:
                return ProbeOutcome(call, ProbeSpec.model_validate_json(call.content))
            parsed = EntryProbeSpec.model_validate_json(call.content)
            return ProbeOutcome(call, ProbeSpec(has_fact=True, **parsed.model_dump()))
        except ValidationError as exc:
            # Should be unreachable under schema-constrained decoding; if it fires the schema
            # and the grammar disagree, which is a bug and not a bad response.
            call.failed, call.error = True, f"schema-constrained output did not validate: {exc}"
            return ProbeOutcome(call)


class LocalAnswerer:
    name = IMPLEMENTATION

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._chat = _OllamaChat(client)
        self.model = self._chat.model
        body, self.prompt_version = load_prompt("answer.md")
        sections = _sections(body)
        self._reply, self._ask = sections["assistant"], sections["user"]

    def check_ready(self) -> None:
        self._chat.check_ready()

    def answer(self, pack: str, question: str) -> CallOutcome:
        """The conversation a person has by hand: the pack pasted alone, a reply, the question.

        The pack is its own turn, verbatim. Only the question turn is templated, and with
        `str.replace` rather than `format`, because a question is model-written text.
        """
        messages = [
            {"role": "user", "content": pack},
            {"role": "assistant", "content": self._reply},
            {"role": "user", "content": self._ask.replace("{question}", question)},
        ]
        return self._chat.chat(messages, self.prompt_version)


def _sections(body: str) -> dict[str, str]:
    """`## turn: <role>` sections of a prompt file, as preamble.md does for vendors."""
    import re

    marker = re.compile(r"^##\s*turn:\s*(\w+)\s*$", re.MULTILINE)
    found = list(marker.finditer(body))
    return {
        m.group(1).lower(): body[m.end() : found[i + 1].start() if i + 1 < len(found) else len(body)].strip()
        for i, m in enumerate(found)
    }
