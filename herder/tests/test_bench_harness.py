"""The harness around the model calls: methods, the API client, and the report. No model, no database."""

from __future__ import annotations

import json

import httpx
import pytest

from bench import methods as M
from bench.report import write as write_report
from herder.core.tokens import count_tokens

CONVERSATION = "\n\n".join(
    f"{'User' if i % 2 == 0 else 'Assistant'}: turn number {i} says something about the plan in some detail."
    for i in range(60)
)


def test_truncate_tail_keeps_the_end_within_budget() -> None:
    ctx = M.truncate_tail(CONVERSATION, budget=100)
    assert ctx.tokens <= 100
    assert "turn number 59" in ctx.text
    assert "turn number 0 " not in ctx.text


def test_truncate_tail_cuts_inside_a_turn_when_one_turn_is_bigger_than_the_budget() -> None:
    ctx = M.truncate_tail("User: " + "word " * 500, budget=50)
    assert 0 < ctx.tokens <= 50


def test_summary_parts_cover_every_turn_and_stay_under_the_part_size(monkeypatch) -> None:
    monkeypatch.setattr(M, "SUMMARY_PART_TOKENS", 200)
    parts = M.summary_parts(CONVERSATION)
    assert len(parts) > 1
    assert all(count_tokens(p) <= 200 for p in parts)
    assert "\n\n".join(parts) == CONVERSATION


class FakeSummariser:
    def __init__(self, combined: str = "combined", part: str = "part summary") -> None:
        self.combined, self.part = combined, part
        self.asked_for: list[int] = []

    def summarise_part(self, text, words):
        from herder.core.verify_models import CallOutcome

        self.asked_for.append(words)
        return CallOutcome(model="fake", prompt_version="1", content=self.part)

    def combine(self, summaries, words):
        from herder.core.verify_models import CallOutcome

        self.asked_for.append(words)
        return CallOutcome(model="fake", prompt_version="1", content=self.combined)


def test_a_summary_over_budget_is_reduced_then_cut_and_says_so() -> None:
    """It is never given more room than the methods it is compared against."""
    ctx = M.naive_summary(["part " * 100], 1.0, budget=20, summariser=FakeSummariser(combined="long " * 200))
    assert ctx.tokens <= 20
    assert (ctx.detail["reduced"], ctx.detail["cut_to_budget"]) == (True, True)


def test_part_summaries_that_already_fit_are_used_whole() -> None:
    """A reduce step that is not needed only loses detail."""
    summariser = FakeSummariser()
    ctx = M.naive_summary(["one fact", "another fact"], 1.0, budget=500, summariser=summariser)
    assert ctx.detail["reduced"] is False
    assert "one fact" in ctx.text and "another fact" in ctx.text
    assert summariser.asked_for == []


def test_the_map_step_asks_for_the_budget_it_will_be_judged_at() -> None:
    """Version 1 asked for no length and wrote 107 to 319 tokens whatever the budget."""
    summariser = FakeSummariser()
    parts, _ = M.map_summaries(CONVERSATION, summariser, largest_budget=3000)
    assert summariser.asked_for and all(w >= 40 for w in summariser.asked_for)
    assert sum(summariser.asked_for) <= int(3000 * M.WORDS_PER_TOKEN)


def test_the_herder_client_waits_for_a_brief_that_covers_every_message() -> None:
    """A brief that exists is not enough: a render from before the derive finished would be
    measured as if it were the result."""
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects":
            return httpx.Response(201, json={"id": "p1", "name": "x", "brief_budget_tokens": 3000})
        if path == "/v1/ingest/paste":
            return httpx.Response(201, json={"accepted": 10})
        if path.endswith("/derive"):
            return httpx.Response(202, json={})
        if path.endswith("/brief"):
            polls["n"] += 1
            covered = 4 if polls["n"] < 3 else 10
            return httpx.Response(200, json={"source_message_count": covered})
        return httpx.Response(404)

    api = M.HerderApi("http://test", "k", client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test"))
    project_id, _, messages = api.derive("x", "User: hi", poll_seconds=0)
    assert (project_id, messages) == ("p1", 10)
    assert polls["n"] == 3


def test_the_report_shows_counts_every_fact_and_each_archetype(tmp_path) -> None:
    run = {
        "label": "trial", "started": "2026-09-13T00:00:00+00:00", "commit": "abc", "model": "m", "read_prompt": "1",
        "summarise_prompt": "1", "extractor": "heuristic", "budgets": [500], "conversations": ["c1"], "facts": 2,
        "false_facts": 1, "kinds": ["decision"], "statements": {"c1": {"f001": ["Uses SQLite.", "true"], "f002": ["Uses Redis.", "false"]}},
    }
    (tmp_path / "run.json").write_text(json.dumps(run))
    (tmp_path / "contexts.jsonl").write_text(
        json.dumps({"key": "truncate_tail @ 500", "conversation": "c1", "conversation_tokens": 5000, "tokens": 500, "build_seconds": 0.1}) + "\n"
    )
    rows = [
        {"conversation": "c1", "archetype": "coding", "method": "truncate_tail @ 500", "fact_id": "f001", "kind": "decision", "truth": "true", "verdict": "true"},
        {"conversation": "c1", "archetype": "coding", "method": "truncate_tail @ 500", "fact_id": "f002", "kind": "decision", "truth": "false", "verdict": "true"},
    ]
    (tmp_path / "judged.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    report = write_report(tmp_path).read_text(encoding="utf-8")

    assert "1.00 (1 of 1)" in report  # recall with its count
    assert "| coding | truncate_tail @ 500 |" in report
    assert "10.0x" in report
    assert "f002 Uses Redis." in report
