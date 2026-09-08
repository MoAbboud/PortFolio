"""Recording every inference call.

The specification asked for every call to be logged so the benchmark is reproducible; this
is where that lives. Three things about it are deliberate:

- **Failures are recorded too.** A failed call with no row is time nobody can account for,
  and the failure rate of an extractor is part of how good it is.
- **`implementation` is recorded beside `model`.** Comparing three extractors is the entire
  point of having three, and a row that cannot say whether it came from `heuristic` or
  `local` proves nothing.
- **The raw output is kept.** It is the bulky column and the only one that matters when
  something breaks: a validation failure with the output thrown away is unfixable.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.ids import uuid7
from herder.models import ModelCall
from herder.schemas.extraction import ExtractionOutcome

# Postgres text has no practical limit, but a runaway response should not turn one row into
# a megabyte. Truncated with a marker so that "this was cut" is never mistaken for "this is
# what the model said".
RAW_LIMIT = 200_000


def _clip(raw: str | None) -> str | None:
    if raw is None or len(raw) <= RAW_LIMIT:
        return raw
    return raw[:RAW_LIMIT] + f"\n...[truncated, {len(raw)} chars total]"


async def record_extraction(
    session: AsyncSession, outcome: ExtractionOutcome, implementation: str
) -> None:
    session.add(
        ModelCall(
            id=uuid7(),
            purpose="extract",
            model=outcome.model or implementation,
            implementation=implementation,
            prompt_version=outcome.prompt_version,
            input_tokens=outcome.input_tokens,
            output_tokens=outcome.output_tokens,
            latency_ms=outcome.latency_ms,
            validated_first_try=outcome.validated_first_try,
            raw_output=_clip(outcome.raw_output),
            error=outcome.error,
        )
    )
