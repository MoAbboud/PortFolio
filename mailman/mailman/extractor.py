"""Calling the model, and the four ways that can go wrong.

The four failures are kept apart rather than caught as one exception, because they mean
different things and the harness needs to count them separately:

  malformed         the response was not the shape that was asked for
  missing_fields    valid shape, but a field a record cannot be filed without is absent
  refused           the model declined the request
  unavailable       timeout, transport error, or the provider giving up after retries
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from mailman import prompts
from mailman.invoice import InvoiceFields, InvoiceRead


class ExtractionError(Exception):
    """An attempt that produced no usable extraction.

    `kind` is one of the four above. `raw` is whatever came back, when anything did - it is
    stored on the row, because a failure with no evidence cannot be investigated.
    """

    def __init__(self, kind: str, message: str, *, raw: Any = None, attempts: int = 1) -> None:
        super().__init__(message)
        self.kind = kind
        self.raw = raw
        self.attempts = attempts


@dataclass
class ExtractionResult:
    """A successful attempt, and what it cost."""

    fields: InvoiceFields
    raw_response: dict[str, Any]
    model_name: str
    prompt_version: str
    latency_ms: int
    token_count: int
    attempts: int = 1
    usage: dict[str, Any] = field(default_factory=dict)


class Extractor(Protocol):
    """What the pipeline needs. One method, so a fake is trivial and a swap is cheap."""

    model_name: str
    prompt_version: str

    def extract(self, document_text: str) -> ExtractionResult: ...


class AnthropicExtractor:
    """Extraction through the Claude API, using structured outputs.

    The provider client is imported lazily and constructed per call, so every other module
    in this package stays importable and testable with no SDK installed and no key present.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str = "claude-opus-5",
        max_tokens: int = 16000,
        timeout_seconds: float = 120.0,
        max_retries: int = 3,
    ) -> None:
        self.api_key = api_key
        self.model_name = model_name
        self.prompt_version = prompts.PROMPT_VERSION
        self.max_tokens = max_tokens
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    def _client(self):
        import anthropic

        # Retries live here and nowhere else. The SDK's own backoff honours Retry-After,
        # which hand-rolled backoff usually gets wrong, so it is used rather than replaced.
        return anthropic.Anthropic(
            api_key=self.api_key,
            timeout=self.timeout_seconds,
            max_retries=self.max_retries,
        )

    def extract(self, document_text: str) -> ExtractionResult:
        import anthropic

        if not self.api_key:
            # Caught here rather than left to the SDK, which raises a TypeError about
            # resolving an authentication method - true, but it reads like a bug in this
            # code rather than a missing environment variable.
            raise ExtractionError(
                "unavailable",
                "no ANTHROPIC_API_KEY is configured, so no extraction can be attempted",
            )

        started = time.monotonic()
        try:
            response = self._client().messages.parse(
                model=self.model_name,
                max_tokens=self.max_tokens,
                system=prompts.SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompts.user_prompt(document_text)}],
                output_format=InvoiceRead,
            )
        except anthropic.APITimeoutError as exc:
            raise ExtractionError(
                "unavailable",
                f"the provider did not answer within {self.timeout_seconds}s",
                attempts=self.max_retries + 1,
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ExtractionError(
                "unavailable", f"could not reach the provider: {exc}", attempts=self.max_retries + 1
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ExtractionError(
                "unavailable",
                "rate limited, and still rate limited after the retries",
                attempts=self.max_retries + 1,
            ) from exc
        except anthropic.APIStatusError as exc:
            raise ExtractionError(
                "unavailable", f"provider returned {exc.status_code}: {exc.message}"
            ) from exc

        latency_ms = int((time.monotonic() - started) * 1000)
        raw = response.to_dict()

        # Checked before the content is touched. A refusal is a 200 with no answer in it,
        # and reading content first turns it into a confusing parse failure.
        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None)
            raise ExtractionError(
                "refused", f"the model declined this document (category: {category})", raw=raw
            )

        if response.stop_reason == "max_tokens":
            raise ExtractionError(
                "malformed",
                f"the response was cut off at max_tokens ({self.max_tokens})",
                raw=raw,
            )

        parsed = getattr(response, "parsed_output", None)
        if parsed is None:
            raise ExtractionError(
                "malformed", "the response did not parse into the invoice shape", raw=raw
            )

        fields = InvoiceFields(parsed)
        usage = raw.get("usage") or {}

        if fields.missing_required:
            # Structurally valid and materially useless. Kept apart from `malformed`
            # because the fix is a prompt or a better document, not a parser.
            raise ExtractionError(
                "missing_fields",
                "required field(s) came back empty: " + ", ".join(fields.missing_required),
                raw=raw,
            )

        return ExtractionResult(
            fields=fields,
            raw_response=raw,
            model_name=response.model or self.model_name,
            prompt_version=self.prompt_version,
            latency_ms=latency_ms,
            token_count=(usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0),
            usage=usage,
        )
