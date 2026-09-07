"""The shared secret, and where it applies.

Stage 6 put `mailman_api_key` in the configuration with a comment saying it was not enforced
yet, and then ended without enforcing it. The gap survived four more stages because nothing
ever failed: an unset secret and an unchecked secret look identical from outside, right up
until the link is public and `POST /documents` is an open upload box.

**Reads are open, writes need the secret.** That is the smallest rule that makes a public
link safe, and it happens to be exactly the "read-only demo" the plan lists as one of its
options for hosting: a visitor can open the queue, read a document, read the metrics, and
change nothing. Anything that writes - upload, correct, approve, reject, reprocess - needs
the secret.

**Two envelopes, one secret.** It arrives either as an `X-API-Key` header, which is what a
script sends, or as a cookie set by the unlock form, which is what a browser can send. A
browser cannot put a header on a form post and the review queue is a form post, so a
header-only check would have made the queue unusable the moment the secret was set - a
worse bug than the one being fixed. It is still one shared secret and one comparison. Only
the envelope differs, and `Multiple users, roles, or authentication beyond one shared
secret` stays where the plan put it, under explicitly not doing.

**When no secret is configured the writes are open**, which is what a local run wants and
what a public one must not have. Failing closed instead would mean every developer setting
an environment variable before the first upload, and the project's own instruction is that
every stage can be checked from PowerShell with nothing set up. The risk that buys - a
deploy where somebody forgot the variable - is answered by making the state visible instead
of silent: `/health` and `/metrics` both report whether the secret is enforced, so "is this
thing open?" is a question the system answers rather than one somebody has to test by
uploading to it.
"""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, status

from mailman.config import settings

# The header a script sends, and the cookie the browser form sets. Both names are part of
# the API's contract, so they live here rather than being spelled out at each use.
HEADER_NAME = "X-API-Key"
COOKIE_NAME = "mailman_key"


def configured_key() -> str | None:
    """The secret, or None when there is not one.

    Read at call time rather than captured at import, so a test can set one on `settings`
    and so a deployment cannot end up enforcing a value the process read before its
    environment was complete.
    """
    key = settings.mailman_api_key
    return key or None


def is_enforced() -> bool:
    """Whether writes currently require a secret."""
    return configured_key() is not None


def presented_key(request: Request) -> str | None:
    """The secret this request carries, from either envelope. The header wins."""
    header = request.headers.get(HEADER_NAME)
    if header:
        return header
    return request.cookies.get(COOKIE_NAME) or None


def key_matches(presented: str | None) -> bool:
    """Whether a presented secret is the configured one.

    `compare_digest` rather than `==`, because `==` on strings returns as soon as two bytes
    differ and that timing is a readable side channel. The secret here guards a portfolio
    demo rather than a bank, but a constant-time comparison is one import and the habit is
    the point.
    """
    expected = configured_key()
    if expected is None:
        return True
    if not presented:
        return False
    return hmac.compare_digest(presented, expected)


def require_api_key(request: Request) -> None:
    """Dependency for every endpoint that writes. Open when no secret is configured."""
    if not is_enforced():
        return
    if not key_matches(presented_key(request)):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=(
                f"this endpoint writes, so it needs the shared secret: send it as the "
                f"{HEADER_NAME} header, or unlock the browser session from the queue page"
            ),
            # A client is told how to authenticate rather than left to guess. The scheme is
            # named for the header it actually uses; there is no Bearer token here.
            headers={"WWW-Authenticate": HEADER_NAME},
        )
