"""Token counting.

`tiktoken` `cl100k_base`, documented everywhere as an estimator. It is not what any
particular vendor will charge, and it does not need to be: it is the ruler for budgets and
for compression ratios, where using one consistent ruler matters far more than being right
about a specific vendor's tokeniser. Deliberately not the local model's own tokeniser - the
budget describes a brief that some other vendor's model will read.

**It never silently falls back to an estimate.** A character-based approximation would keep
the system running and quietly change the ruler, which would corrupt every compression ratio
and every budget decision after it - the same class of failure as an extractor silently
downgrading itself. If the encoding is not available, this raises and says how to fix it.

`cl100k_base` is a static BPE file that tiktoken fetches once and caches. The Dockerfile
warms that cache at build time so the container never reaches the network at runtime.
"""

from __future__ import annotations

from functools import lru_cache

ENCODING = "cl100k_base"


class TokeniserUnavailable(RuntimeError):
    pass


@lru_cache
def get_encoder():
    try:
        import tiktoken
    except ImportError as exc:  # pragma: no cover - dependency is in requirements.txt
        raise TokeniserUnavailable("tiktoken is not installed; pip install -r requirements.txt") from exc

    try:
        return tiktoken.get_encoding(ENCODING)
    except Exception as exc:
        raise TokeniserUnavailable(
            f"the {ENCODING} encoding could not be loaded. It is a static file tiktoken "
            "downloads once and caches; set TIKTOKEN_CACHE_DIR to a warmed directory, or "
            "allow one download. herder does not estimate instead: a second ruler would "
            "silently corrupt every budget and compression ratio measured with the first."
        ) from exc


def count_tokens(text: str) -> int:
    return len(get_encoder().encode(text, disallowed_special=()))
