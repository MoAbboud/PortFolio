"""Stage 7: the review queue, server-rendered.

**This is the demo**, and it is also the tool for looking at extractions while stage 8's
corpus is assembled - which is the reason it arrives before the measurement rather than after.
Doing that work against jsonb in a database client is miserable, and miserable work gets cut
short.

**Server-rendered templates, no build step.** It has to run from PowerShell with nothing
installed beyond what is already here, and deploy as one process. A queue, a viewer and a form
do not need a framework, and the API exists either way if one is ever wanted.

**It stays bare.** The plan gates it: no styling pass, no second screen, until stage 8's
baseline is recorded. A project that spends its remaining time on the interface arrives with a
demo and no numbers, and the numbers are the part that makes this worth showing.

One thing worth knowing before opening it: **on the corpus this queue is empty**, because every
corpus document passes every error rule and scores at or above the threshold. That is the
correct behaviour and it looks like a broken page, so the empty state says so and says how to
put something in it.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from mailman.api import security
from mailman.api.security import require_api_key
from mailman.config import settings
from mailman.db import get_session
from mailman.models import Document, Extraction, ValidationResult
from mailman.status import NEEDS_REVIEW

router = APIRouter(tags=["review"], include_in_schema=False)
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))

# Two globals rather than two more keys in every context dict. Whether writes need a secret,
# and whether this browser has presented one, are true of every page and neither depends on
# what the page is showing - passing them through each render by hand is how one template
# ends up rendering a stale answer because somebody added a route and forgot.
templates.env.globals["api_key_enforced"] = security.is_enforced
templates.env.globals["browser_unlocked"] = lambda request: security.key_matches(
    security.presented_key(request)
)

# Which fields a failed rule implicates, so the form can mark them. Derived from the rule
# names rather than parsed out of the messages: a message is for a person to read and its
# wording will change, and highlighting that silently stopped working would be worse than
# not highlighting at all.
IMPLICATES: dict[str, tuple[str, ...]] = {
    "required_fields_present": ("invoice_number", "vendor_name", "total", "currency"),
    "amounts_parsed": ("subtotal", "tax", "total"),
    "currency_is_known": ("currency",),
    "line_items_sum_to_subtotal": ("subtotal",),
    "subtotal_plus_tax_equals_total": ("subtotal", "tax", "total"),
    "line_arithmetic": (),
    "issue_date_is_plausible": ("issue_date",),
    "dates_are_ordered": ("issue_date", "due_date"),
    "dates_are_unambiguous": ("issue_date", "due_date"),
    "invoice_number_is_plausible": ("invoice_number",),
    "vendor_is_known": ("vendor_name",),
    "invoice_number_is_not_a_duplicate": ("invoice_number", "vendor_name"),
}

SCALARS = (
    "invoice_number", "vendor_name", "buyer_name", "issue_date", "due_date",
    "currency", "subtotal", "tax", "total",
)


def _latest_extraction(session: Session, document_id: uuid.UUID) -> Extraction | None:
    return (
        session.query(Extraction)
        .filter(Extraction.document_id == document_id, Extraction.error.is_(None))
        .order_by(Extraction.created_at.desc())
        .first()
    )


def _latest_results(session: Session, extraction: Extraction) -> list[ValidationResult]:
    """The newest verdict for each rule. Re-validation appends rather than updating, so
    without this the page shows every verdict the document has ever had, stacked.

    **This used to group by an identical `checked_at` and it silently stopped working.** The
    ten rows of one validation run were written in one transaction, and Postgres `now()` is
    transaction time, so they genuinely did share a timestamp to the microsecond. Migration
    0002 then moved this column to `clock_timestamp()` to fix a different bug - "the latest
    extraction" being decided arbitrarily when two shared a timestamp - and `clock_timestamp()`
    advances within a transaction. The property one fix depended on is the one the other fix
    removed.

    What it looked like: `newest` matched exactly one row, so the review page showed one rule
    out of ten - always `vendor_is_known`, because the database rules are appended last. A
    reviewer looking at a document held back by a failed arithmetic rule saw a table that did
    not mention it, and the fields that rule implicates were never highlighted. The queue's
    "why it is here" column reads the same function, so it fell through to "below the
    confidence threshold" for documents that had a failed error rule to name.

    Grouping by rule name instead of by timestamp does not depend on how the clock behaves,
    which is the property that was missing. One verdict per rule is also what the page is
    actually asking for.
    """
    rows = (
        session.query(ValidationResult)
        .filter(ValidationResult.extraction_id == extraction.id)
        .order_by(ValidationResult.checked_at.desc())
        .all()
    )

    newest_per_rule: dict[str, ValidationResult] = {}
    for row in rows:                      # newest first, so the first of each name wins
        newest_per_rule.setdefault(row.rule_name, row)

    return sorted(
        newest_per_rule.values(),
        key=lambda r: (r.passed, r.severity != "error", r.rule_name),
    )


@router.get("/", response_class=HTMLResponse)
def queue(request: Request, session: Session = Depends(get_session)) -> HTMLResponse:
    """The front door. Oldest first - newest-first leaves the hardest document at the bottom."""
    from sqlalchemy import func

    documents = (
        session.query(Document)
        .filter(Document.status == NEEDS_REVIEW)
        .order_by(Document.uploaded_at)
        .limit(100)
        .all()
    )

    entries = []
    for document in documents:
        extraction = _latest_extraction(session, document.id)
        failed = []
        if extraction is not None:
            failed = [r for r in _latest_results(session, extraction) if not r.passed]
        entries.append({"document": document, "failed": failed})

    counts = (
        session.query(Document.status, func.count(Document.id))
        .group_by(Document.status)
        .order_by(Document.status)
        .all()
    )

    return templates.TemplateResponse(
        request,
        "queue.html",
        {"documents": entries, "counts": counts, "threshold": settings.confidence_threshold},
    )


def _review_context(request: Request, session: Session, document_id: uuid.UUID, **extra) -> dict:
    from mailman.confidence import score
    from mailman.invoice import InvoiceFields, InvoiceRead
    from mailman.pipeline import _read_from
    from mailman.promotion import database_rules
    from mailman.storage import LocalDocumentStore, text_key_for
    from mailman.validation import validate

    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")
    extraction = _latest_extraction(session, document_id)
    if extraction is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="nothing extracted to review")

    fields = InvoiceFields(InvoiceRead(**_read_from(extraction.extracted_data)))
    results = _latest_results(session, extraction)
    outcomes = validate(fields) + database_rules(session, fields, document_id)

    implicated: set[str] = set()
    for result in results:
        if not result.passed:
            implicated.update(IMPLICATES.get(result.rule_name, ()))

    try:
        store = LocalDocumentStore(settings.storage_root)
        document_text = store.get(text_key_for(document.storage_path)).decode("utf-8")
    except Exception:                              # noqa: BLE001 - the page must still render
        document_text = "(the stored text layer could not be read)"

    return {
        "document": document,
        "extraction": extraction,
        "results": results,
        "confidence": score(fields, outcomes),
        "threshold": settings.confidence_threshold,
        "scalars": [(name, getattr(fields, name)) for name in SCALARS],
        "line_items": fields.line_items,
        "implicated": implicated,
        "document_text": document_text,
        "reviewer": "",
        "message": None,
        "message_class": "muted",
        **extra,
    }


@router.get("/review/{document_id}", response_class=HTMLResponse)
def review(
    request: Request, document_id: uuid.UUID, session: Session = Depends(get_session)
) -> HTMLResponse:
    """The document beside its fields, on one screen."""
    return templates.TemplateResponse(
        request, "review.html", _review_context(request, session, document_id)
    )


# response_model=None because this returns either a rendered page or a redirect, and
# FastAPI otherwise tries to build a response model out of that union and fails.
@router.post(
    "/review/{document_id}",
    response_class=HTMLResponse,
    response_model=None,
    # The one browser route that writes, so it takes the same secret every writing endpoint
    # takes. The cookie envelope in `security` exists for this route: a form post cannot
    # carry a header, and a queue that stopped working the moment the secret was set would
    # be a worse bug than the open one it replaced.
    dependencies=[Depends(require_api_key)],
)
async def submit_review(
    request: Request,
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> HTMLResponse | RedirectResponse:
    """Correct, then save or approve or reject, in one pass.

    The form is read manually rather than through typed parameters because the field names are
    dotted paths built from the document - `line_items[2].amount` - and how many there are
    depends on the invoice.
    """
    from mailman.promotion import NotPromotable, apply_corrections, promote, reject

    form = await request.form()
    action = form.get("action", "save")
    reviewed_by = (form.get("reviewed_by") or "").strip() or None

    changes = {
        key[2:]: (value.strip() or None)
        for key, value in form.items()
        if key.startswith("f:") and isinstance(value, str)
    }

    message, message_class = None, "muted"
    try:
        if action == "reject":
            reject(session, document_id, reason=form.get("reason", ""), actor=reviewed_by or "reviewer")
            return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

        logged = apply_corrections(session, document_id, changes, reviewed_by=reviewed_by)

        if action == "approve":
            invoice = promote(session, document_id, actor=reviewed_by or "reviewer")
            return RedirectResponse(
                url=f"/?approved={invoice.invoice_number}", status_code=status.HTTP_303_SEE_OTHER
            )

        message = (
            f"{len(logged)} correction(s) saved and the rules re-run."
            if logged
            else "Nothing changed, so nothing was logged. The rules were re-run anyway."
        )
        message_class = "pass"
    except NotPromotable as exc:
        session.rollback()
        message, message_class = str(exc), "error"

    return templates.TemplateResponse(
        request,
        "review.html",
        _review_context(
            request, session, document_id,
            message=message, message_class=message_class, reviewer=reviewed_by or "",
        ),
    )


# The browser's way of presenting the same secret a script sends as a header. Two routes and
# a cookie, and no session store: the cookie IS the secret, so there is nothing to keep
# server-side and nothing that can drift out of step with the configuration.
@router.post("/unlock", response_model=None)
async def unlock(request: Request) -> RedirectResponse:
    """Take the secret from a form and put it in a cookie, so this browser can write."""
    form = await request.form()
    key = (form.get("key") or "").strip()

    # The wrong secret is rejected here rather than stored and failing later on whatever the
    # reviewer tried to do next, which would look like the approve button being broken.
    if not security.key_matches(key):
        return RedirectResponse(url="/?unlocked=no", status_code=status.HTTP_303_SEE_OTHER)

    response = RedirectResponse(url="/?unlocked=yes", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        security.COOKIE_NAME,
        key,
        # HttpOnly because no script on these pages has any reason to read it, and SameSite
        # because a form post from another origin should not arrive already authenticated.
        httponly=True,
        samesite="lax",
        # `secure` follows the request rather than being hardcoded: hardcoding it on breaks
        # every local run over http, and hardcoding it off ships the secret in clear text
        # from the hosted link. The request knows which one it is.
        secure=request.url.scheme == "https",
        max_age=60 * 60 * 12,
    )
    return response


@router.post("/lock", response_model=None)
def lock() -> RedirectResponse:
    """Forget the secret in this browser."""
    response = RedirectResponse(url="/?unlocked=cleared", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(security.COOKIE_NAME)
    return response
