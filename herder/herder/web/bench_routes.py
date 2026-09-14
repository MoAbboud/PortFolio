"""The fact-list authoring pages: where the benchmark's ground truth is written by a person.

This is why the web UI came before the corpus in the plan - reading a 10,000-token conversation
and writing thirty facts against it is miserable in a text editor and bearable here.

**It shows the conversation and nothing herder derived from it.** No entries, no brief, no
lineage: the facts are written from reading, never from an extraction, and a page that put
herder's own entries beside the form would make copying them the path of least resistance.

Writes `bench/datasets/<name>/facts.json`. Local authoring only - `HERDER_BENCH_AUTHORING`
turns these routes off, and a hosted deployment must set it false.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse

from bench import facts as F
from herder.core.config import get_settings
from herder.domain.transcript import parse_transcript
from herder.models import ApiKey
from herder.web.routes import page, redirect
from herder.web.support import form, web_key, with_notice

DATASETS = Path(__file__).resolve().parents[2] / "bench" / "datasets"
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")

router = APIRouter(include_in_schema=False)


def _enabled() -> None:
    if not get_settings().bench_authoring:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


def _dataset(name: str) -> tuple[dict, list]:
    # The name becomes a path, so it is checked against a strict pattern and an existing
    # folder before it is used - no "../" can reach anything outside the datasets.
    if not _NAME.match(name) or not (DATASETS / name / "conversation.txt").is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such conversation")
    meta = json.loads((DATASETS / name / "meta.json").read_text(encoding="utf-8"))
    turns = parse_transcript((DATASETS / name / "conversation.txt").read_text(encoding="utf-8")).turns
    return meta, turns


@router.get("/bench", response_class=HTMLResponse)
async def bench_list(request: Request, key: ApiKey = Depends(web_key)):
    _enabled()
    rows = []
    for folder in sorted(DATASETS.iterdir()) if DATASETS.is_dir() else []:
        if not (folder / "meta.json").is_file():
            continue
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        facts = F.load(DATASETS, folder.name)
        rows.append({
            "meta": meta, "total": len(facts.facts), "false": len(facts.false_facts),
            "unrated": len(facts.unrated),
        })
    written = sum(r["total"] for r in rows)
    return page(
        request, "bench_list.html", rows=rows, target=F.TARGET_FACTS, written=written,
        unrated=sum(r["unrated"] for r in rows),
    )


@router.get("/bench/{name}", response_class=HTMLResponse)
async def bench_author(request: Request, name: str, key: ApiKey = Depends(web_key)):
    _enabled()
    meta, turns = _dataset(name)
    facts = F.load(DATASETS, name)
    editing = next((f for f in facts.facts if f.id == request.query_params.get("edit")), None)
    counts = {kind: sum(f.kind == kind for f in facts.facts) for kind in F.KINDS}
    tiers = {tier: sum(f.importance == tier for f in facts.facts) for tier in (*F.IMPORTANCE, F.UNRATED)}
    return page(
        request, "bench_author.html",
        meta=meta, turns=turns, facts=facts, editing=editing, kinds=F.KINDS, counts=counts, target=F.TARGET_FACTS,
        importances=F.IMPORTANCE, unrated=F.UNRATED, tiers=tiers,
    )


@router.post("/bench/{name}/facts")
async def bench_save_fact(request: Request, name: str, key: ApiKey = Depends(web_key)):
    _enabled()
    _, turns = _dataset(name)
    fields = await form(request)
    facts = F.load(DATASETS, name)
    here = f"/bench/{name}"
    try:
        fact = F.Fact(
            id=fields.get("fact_id") or F.next_id(facts),
            statement=" ".join(fields.get("statement", "").split()),
            kind=fields.get("kind", ""),
            truth=fields.get("truth", ""),
            turns=F.parse_turns(fields.get("turns", "")),
            note=fields.get("note", "").strip(),
            importance=fields.get("importance", F.UNRATED),
        )
        F.validate(fact, turn_count=len(turns))
    except F.FactError as exc:
        return redirect(with_notice(here, f"Not saved: {exc}"))

    existing = [i for i, f in enumerate(facts.facts) if f.id == fact.id]
    if existing:
        facts.facts[existing[0]] = fact
    else:
        facts.facts.append(fact)
    F.save(DATASETS, facts)
    return redirect(with_notice(here, f"Saved {fact.id}. {len(facts.facts)} facts so far.") + "#form")


@router.post("/bench/{name}/facts/{fact_id}/importance")
async def bench_rate_fact(request: Request, name: str, fact_id: str, key: ApiKey = Depends(web_key)):
    """One click per fact. Rating 261 of them through the edit form would not get done."""
    _enabled()
    _dataset(name)
    fields = await form(request)
    tier = fields.get("importance", "")
    if tier not in F.IMPORTANCE:
        return redirect(with_notice(f"/bench/{name}", f"unknown importance {tier!r}"))
    facts = F.load(DATASETS, name)
    for fact in facts.facts:
        if fact.id == fact_id:
            fact.importance = tier
            F.save(DATASETS, facts)
            break
    remaining = len(F.load(DATASETS, name).unrated)
    return redirect(with_notice(f"/bench/{name}", f"{fact_id} is {tier}. {remaining} left to rate.") + f"#{fact_id}")


@router.post("/bench/{name}/facts/{fact_id}/delete")
async def bench_delete_fact(request: Request, name: str, fact_id: str, key: ApiKey = Depends(web_key)):
    _enabled()
    _dataset(name)
    facts = F.load(DATASETS, name)
    before = len(facts.facts)
    facts.facts = [f for f in facts.facts if f.id != fact_id]
    if len(facts.facts) != before:
        F.save(DATASETS, facts)
    return redirect(with_notice(f"/bench/{name}", f"Deleted {fact_id}.") + "#facts")
