"""The tables.

Empty at stage 0: the first migration only creates the extensions. Stage 1 adds `owners`,
`listings` and `listing_events` here. The module exists now because migrations/env.py and
the test fixtures import it for its side effect of registering tables on Base.metadata, and
an import that is added later is an import somebody forgets.
"""

from __future__ import annotations

from roamer.db import Base  # noqa: F401
