"""The probe generator and the answerer, against a fake Ollama. No model, no database."""

from __future__ import annotations

import json

import httpx
import pytest

from herder.core.verify_models import LocalAnswerer, LocalProbeGenerator, ModelUnavailable


def ollama(reply: str, seen: list[dict] | None = None, tags: list[str] | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": n} for n in (tags or ["qwen2.5:3b"])]})
        body = json.loads(request.content)
        if seen is not None:
            seen.append(body)
        return httpx.Response(
            200,
            json={
                "message": {"content": reply},
                "prompt_eval_count": 50,
                "eval_count": 10,
                "prompt_eval_duration": 2_000_000,
                "eval_duration": 3_000_000,
                "load_duration": 1_000_000,
            },
        )

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://ollama")


def test_the_answer_is_asked_the_way_a_person_asks_it() -> None:
    """The pack pasted alone, a reply, then the question - the by-hand test's shape. Version 1
    put it all in one message with a "Not stated" escape hatch, and qwen2.5:3b took the hatch
    on every question, including ones the pack answered word for word."""
    seen: list[dict] = []
    pack = "<herder-context>PACK</herder-context>"
    answer = LocalAnswerer(ollama("MySQL.", seen)).answer(pack, "What database?")

    assert answer.content == "MySQL."
    first, reply, ask = seen[0]["messages"]
    assert (first["role"], first["content"]) == ("user", pack)
    assert reply["role"] == "assistant"
    assert ask["role"] == "user" and ask["content"].startswith("What database?")
    assert "not stated" not in ask["content"].lower()
    assert seen[0]["options"]["temperature"] == 0


def test_the_pack_is_sent_verbatim_even_with_braces_in_it() -> None:
    seen: list[dict] = []
    LocalAnswerer(ollama("ok", seen)).answer("user said {question} literally", "What was said?")
    assert seen[0]["messages"][0]["content"] == "user said {question} literally"


def test_a_pack_too_big_for_the_context_is_refused_before_sending() -> None:
    """Ollama gives the prompt half of num_ctx and truncates the rest silently. Checked up
    front, because the extractor's after-the-fact check reads prefix caching as truncation."""
    seen: list[dict] = []
    answerer = LocalAnswerer(ollama("ok", seen))
    outcome = answerer.answer("word " * 40_000, "What?")

    assert outcome.failed
    assert "num_ctx" in outcome.error
    assert seen == []


def test_the_timing_split_is_kept() -> None:
    outcome = LocalAnswerer(ollama("ok")).answer("pack", "q")
    assert (outcome.load_ms, outcome.prompt_ms, outcome.generation_ms) == (1, 2, 3)


def test_an_entry_decodes_under_a_grammar_with_no_way_to_decline() -> None:
    """Offered `has_fact`, the model declined three of six real entries."""
    seen: list[dict] = []
    reply = json.dumps({"question": "What database?", "expected_answer": "Production runs on MySQL."})
    outcome = LocalProbeGenerator(ollama(reply, seen)).generate("decision", "We switched to MySQL.")

    assert outcome.spec.has_fact is True
    assert outcome.spec.question == "What database?"
    assert "has_fact" not in json.dumps(seen[0]["format"])
    assert seen[0]["messages"][1]["content"] == "Content: [decision] We switched to MySQL."


def test_a_raw_message_may_say_it_holds_no_fact() -> None:
    seen: list[dict] = []
    reply = json.dumps({"has_fact": False, "question": "", "expected_answer": ""})
    outcome = LocalProbeGenerator(ollama(reply, seen)).generate("message", "thanks, go on")

    assert outcome.spec.has_fact is False
    assert "has_fact" in json.dumps(seen[0]["format"])


def test_output_that_does_not_validate_is_a_failure_not_a_probe() -> None:
    outcome = LocalProbeGenerator(ollama("not json")).generate("fact", "x")
    assert outcome.call.failed
    assert outcome.spec is None


def test_a_missing_model_says_how_to_fix_it() -> None:
    with pytest.raises(ModelUnavailable, match="ollama pull"):
        LocalAnswerer(ollama("ok", tags=["all-minilm:latest"])).check_ready()
