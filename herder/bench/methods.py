"""The methods being compared. Each turns a conversation into a context of at most `budget` tokens.

    herder          the real pipeline, through the API: paste, derive, resume at the budget
    naive_summary   what a reasonable person builds in an afternoon: summarise the conversation
    truncate_tail   what people actually do: keep the last `budget` tokens
    no_context      a control, not a method: the reader with nothing. It shows how much of the
                    score a model gets by guessing, so no method is credited for that

**Why the herder context is the brief, not the pack.** The pack is the brief plus a short
vendor instruction, which carries no memory. The other methods get no instruction either, so
the comparison is memory against memory at the same budget.

**Why naive_summary is map-reduce.** A 10,000-token conversation does not fit the local
model's usable context with room for instructions, so it is summarised in parts and the part
summaries combined. That is still the plain approach - no structure, no entries - and it is
what the afternoon build would have to do with this model. If the final summary is over
budget it is cut at the budget and the result says so, rather than being allowed more room
than the method it is compared against.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx

from herder.core.tokens import count_tokens, get_encoder

SUMMARY_PART_TOKENS = 6_000


class MethodFailed(RuntimeError):
    pass


@dataclass
class Context:
    method: str
    budget: int
    text: str
    tokens: int
    build_seconds: float
    detail: dict = field(default_factory=dict)


def _turns(conversation: str) -> list[str]:
    return [t for t in conversation.split("\n\n") if t.strip()]


def _cut_to(text: str, budget: int, *, keep: str) -> str:
    encoder = get_encoder()
    ids = encoder.encode(text)
    if len(ids) <= budget:
        return text
    return encoder.decode(ids[-budget:] if keep == "end" else ids[:budget])


# ------------------------------------------------------------------------ truncate_tail


def truncate_tail(conversation: str, budget: int) -> Context:
    started = time.perf_counter()
    kept: list[str] = []
    for turn in reversed(_turns(conversation)):
        if count_tokens("\n\n".join([turn, *kept])) > budget:
            break
        kept.insert(0, turn)
    text = "\n\n".join(kept) if kept else _cut_to(conversation, budget, keep="end")
    return Context("truncate_tail", budget, text, count_tokens(text), time.perf_counter() - started, {"turns_kept": len(kept)})


# ------------------------------------------------------------------------ no_context


def no_context(conversation: str, budget: int) -> Context:
    return Context("no_context", budget, "", 0, 0.0)


# ------------------------------------------------------------------------ naive_summary


def summary_parts(conversation: str) -> list[str]:
    parts: list[list[str]] = [[]]
    for turn in _turns(conversation):
        if parts[-1] and count_tokens("\n\n".join([*parts[-1], turn])) > SUMMARY_PART_TOKENS:
            parts.append([])
        parts[-1].append(turn)
    return ["\n\n".join(p) for p in parts if p]


def map_summaries(conversation: str, summariser) -> tuple[list[str], float]:
    """The part summaries, shared by every budget: the map step does not depend on the budget."""
    started = time.perf_counter()
    out = []
    for part in summary_parts(conversation):
        call = summariser.summarise_part(part)
        if call.failed or not call.content:
            raise MethodFailed(f"summarising a part failed: {call.error or 'empty output'}")
        out.append(call.content)
    return out, time.perf_counter() - started


def naive_summary(part_summaries: list[str], map_seconds: float, budget: int, summariser) -> Context:
    started = time.perf_counter()
    # Words, because a model follows a word count far better than a token count; cl100k runs at
    # roughly 0.75 words a token for English prose.
    call = summariser.combine(part_summaries, words=max(20, int(budget * 0.75)))
    if call.failed or not call.content:
        raise MethodFailed(f"combining the summaries failed: {call.error or 'empty output'}")
    text = call.content.strip()
    over = count_tokens(text) > budget
    text = _cut_to(text, budget, keep="start")
    return Context(
        "naive_summary", budget, text, count_tokens(text), map_seconds + time.perf_counter() - started,
        {"parts": len(part_summaries), "cut_to_budget": over},
    )


# ------------------------------------------------------------------------ herder, through the API


class HerderApi:
    def __init__(self, base_url: str, key: str, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(base_url=base_url, headers={"X-API-Key": key}, timeout=60)

    def health(self) -> dict:
        response = self._client.get("/health")
        response.raise_for_status()
        return response.json()

    def derive(self, project_name: str, conversation: str, *, poll_seconds: float = 3.0, timeout: float = 3_600) -> tuple[str, float, int]:
        """Paste into a new project and wait for the worker's derive. (project id, seconds, messages)."""
        started = time.perf_counter()
        created = self._client.post("/v1/projects", json={"name": project_name})
        if created.status_code != 201:
            raise MethodFailed(f"could not create {project_name}: {created.status_code} {created.text}")
        project_id = created.json()["id"]

        pasted = self._client.post("/v1/ingest/paste", json={"text": conversation, "vendor": "manual", "project_id": project_id})
        if pasted.status_code != 201:
            raise MethodFailed(f"paste refused: {pasted.status_code} {pasted.text}")
        messages = pasted.json()["accepted"]
        self._client.post(f"/v1/projects/{project_id}/derive")

        # Done when a brief covers every pasted message - not merely when a brief exists, which
        # could be a render from before the derive reached the end.
        while time.perf_counter() - started < timeout:
            brief = self._client.get(f"/v1/projects/{project_id}/brief")
            if brief.status_code == 200 and brief.json()["source_message_count"] >= messages:
                return project_id, time.perf_counter() - started, messages
            time.sleep(poll_seconds)
        raise MethodFailed(f"no complete brief for {project_name} after {timeout:.0f}s - is the worker running?")

    def context(self, project_id: str, budget: int, derive_seconds: float, extractor: str) -> Context:
        started = time.perf_counter()
        pack = self._client.get(f"/v1/projects/{project_id}/resume", params={"budget": budget, "vendor": "default", "door": "rest"})
        if pack.status_code != 200:
            raise MethodFailed(f"resume failed: {pack.status_code} {pack.text}")
        version = pack.json()["version"]
        brief = self._client.get(f"/v1/projects/{project_id}/brief", params={"version": version})
        brief.raise_for_status()
        body = brief.json()
        return Context(
            "herder", budget, body["rendered_text"], body["token_count"], derive_seconds + time.perf_counter() - started,
            {"extractor": extractor, "version": version, "included": body["included"], "excluded": body["excluded"],
             "resume_seconds": round(time.perf_counter() - started, 2)},
        )
