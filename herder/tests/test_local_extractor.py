"""The local extractor's HTTP behaviour, against a mocked transport.

No Ollama, no model, no database. The real model is never loaded in the suite - several
gigabytes of weights would make it a suite nobody runs.

This file exists because there was nothing here at all after stage 2 shipped. The
`keep_alive` fix in particular came out of a measurement (121 s of model loading against 5 s
of inference) and had no test guarding it, so removing it would have silently restored a 20x
regression with the suite still green. That is the worst kind of gap: a fix that works only
until somebody tidies up.
"""

from __future__ import annotations

import json

import httpx
import pytest

from herder.core.ids import uuid7
from herder.domain.chunking import Chunk, ChunkMessage
from herder.extractors.base import ExtractorUnavailable
from herder.extractors.local import LocalExtractor
from herder.schemas.extraction import CandidateList

MS = 1_000_000  # Ollama reports durations in nanoseconds


def a_chunk() -> Chunk:
    messages = (
        ChunkMessage(id=uuid7(), role="user", content="we are using Postgres", token_count=6),
        ChunkMessage(id=uuid7(), role="assistant", content="noted", token_count=2),
    )
    return Chunk(messages, 8)


def entries_payload(chunk: Chunk) -> str:
    first = sorted(str(i) for i in chunk.message_ids)[0]
    return json.dumps(
        {
            "entries": [
                {
                    "layer": "project",
                    "kind": "decision",
                    "title": "Postgres in production",
                    "text": "Production uses Postgres.",
                    "lineage": [first],
                    "confidence": 0.9,
                    "supersedes_title": None,
                }
            ]
        }
    )


def chat_response(content: str, **durations) -> httpx.Response:
    body = {
        "model": "qwen2.5:3b",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "load_duration": durations.get("load_ns", 121_000 * MS),
        "prompt_eval_count": durations.get("prompt_tokens", 1606),
        "prompt_eval_duration": durations.get("prompt_ns", 800 * MS),
        "eval_count": durations.get("output_tokens", 316),
        "eval_duration": durations.get("gen_ns", 4000 * MS),
    }
    return httpx.Response(200, json=body)


def tags_response(*names: str) -> httpx.Response:
    return httpx.Response(200, json={"models": [{"name": n} for n in names]})


def extractor_for(handler) -> LocalExtractor:
    return LocalExtractor(client=httpx.Client(transport=httpx.MockTransport(handler)))


# ------------------------------------------------------------------ readiness


def test_check_ready_passes_when_the_model_is_there() -> None:
    extractor = extractor_for(lambda request: tags_response("qwen2.5:3b", "llama3:8b"))
    extractor.check_ready()


def test_check_ready_names_the_fix_when_ollama_is_not_running() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(ExtractorUnavailable) as exc:
        extractor_for(refuse).check_ready()

    message = str(exc.value)
    assert "ollama.com" in message
    # The Docker case is the one that will actually bite, so it is in the message.
    assert "host.docker.internal" in message


def test_check_ready_names_the_pull_command_when_the_model_is_missing() -> None:
    extractor = extractor_for(lambda request: tags_response("llama3:8b"))

    with pytest.raises(ExtractorUnavailable) as exc:
        extractor.check_ready()

    message = str(exc.value)
    assert "ollama pull qwen2.5:3b" in message
    # And says what *is* available, so the fix does not need a second command to discover.
    assert "llama3:8b" in message


def test_check_ready_accepts_a_tag_suffix() -> None:
    """`ollama pull qwen2.5:3b` can land as `qwen2.5:3b-instruct-q4_K_M`."""
    extractor = extractor_for(lambda request: tags_response("qwen2.5:3b:latest"))
    extractor.check_ready()


# ------------------------------------------------------------------ the request


def sent_body(chunk: Chunk, titles: list[str] | None = None) -> dict:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return chat_response(entries_payload(chunk))

    extractor_for(handler).extract(chunk, titles or [])
    return captured


def test_keep_alive_is_sent() -> None:
    """Without this Ollama unloads after 5 minutes and the next derive pays ~2 minutes to
    reload a model that then works for 5 seconds. Measured, not theoretical."""
    assert sent_body(a_chunk())["keep_alive"] == "30m"


def test_the_json_schema_is_sent_as_the_decoding_format() -> None:
    """Valid JSON is a property of decoding, not something to hope for and repair."""
    body = sent_body(a_chunk())
    assert body["format"] == CandidateList.model_json_schema()


def test_temperature_is_zero_and_streaming_is_off() -> None:
    body = sent_body(a_chunk())
    assert body["options"]["temperature"] == 0
    assert body["stream"] is False


def test_the_prompt_carries_the_message_ids_lineage_is_checked_against() -> None:
    chunk = a_chunk()
    body = sent_body(chunk)
    user_turn = body["messages"][-1]["content"]
    for message_id in chunk.message_ids:
        assert str(message_id) in user_turn


def test_known_titles_are_sent_so_the_model_does_not_restate_them() -> None:
    body = sent_body(a_chunk(), titles=["Postgres in production"])
    assert "Postgres in production" in body["messages"][-1]["content"]


def test_the_versioned_system_prompt_is_sent() -> None:
    body = sent_body(a_chunk())
    system = body["messages"][0]
    assert system["role"] == "system"
    assert "only what the USER said" in system["content"]


# ------------------------------------------------------------------ the response


def test_a_good_response_becomes_candidates() -> None:
    chunk = a_chunk()
    outcome = extractor_for(lambda r: chat_response(entries_payload(chunk))).extract(chunk, [])

    assert outcome.failed is False
    assert len(outcome.candidates) == 1
    assert outcome.candidates[0].title == "Postgres in production"
    assert outcome.validated_first_try is True


def test_the_timing_split_is_parsed_from_nanoseconds() -> None:
    """The split is the measurement stage 2 exists for. A single total hid a 20x error."""
    chunk = a_chunk()
    outcome = extractor_for(lambda r: chat_response(entries_payload(chunk))).extract(chunk, [])

    assert outcome.load_ms == 121_000
    assert outcome.prompt_ms == 800
    assert outcome.generation_ms == 4000
    assert outcome.input_tokens == 1606
    assert outcome.output_tokens == 316


def test_a_warm_call_reports_no_load_time() -> None:
    chunk = a_chunk()
    outcome = extractor_for(
        lambda r: chat_response(entries_payload(chunk), load_ns=0)
    ).extract(chunk, [])
    assert outcome.load_ms == 0
    assert outcome.prompt_ms > 0


def test_an_empty_answer_is_a_valid_answer() -> None:
    """Much better than an invented one, and the prompt says so."""
    chunk = a_chunk()
    outcome = extractor_for(lambda r: chat_response('{"entries": []}')).extract(chunk, [])
    assert outcome.failed is False
    assert outcome.candidates == []


# ------------------------------------------------------------------ failures


def test_a_timeout_is_a_failed_outcome_not_an_exception() -> None:
    """A model-side failure comes back on the outcome so it can be counted and logged."""

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    outcome = extractor_for(slow).extract(a_chunk(), [])

    assert outcome.failed is True
    assert "timed out" in outcome.error
    assert outcome.validated_first_try is False


def test_an_http_error_is_a_failed_outcome() -> None:
    outcome = extractor_for(lambda r: httpx.Response(500, text="boom")).extract(a_chunk(), [])
    assert outcome.failed is True
    assert outcome.error


def test_output_that_does_not_validate_keeps_the_raw_text() -> None:
    """Unreachable if the grammar is right - which is exactly why the raw output is kept.

    A validation failure with the output thrown away is unfixable, and if this fires it means
    the schema and the grammar disagree, which is a bug here rather than a bad response.
    """
    outcome = extractor_for(lambda r: chat_response('{"entries": [{"layer": "nope"}]}')).extract(
        a_chunk(), []
    )

    assert outcome.failed is True
    assert outcome.raw_output == '{"entries": [{"layer": "nope"}]}'
    assert outcome.validated_first_try is False
    assert "did not validate" in outcome.error


def test_a_failed_outcome_still_reports_which_model_and_prompt() -> None:
    """Otherwise a failure cannot be attributed to anything and teaches nothing."""

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    outcome = extractor_for(refuse).extract(a_chunk(), [])
    assert outcome.model == "qwen2.5:3b"
    assert outcome.prompt_version == "1"
