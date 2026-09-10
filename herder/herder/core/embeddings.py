"""Embeddings, for the similarity half of the merge step.

Served by **Ollama**, not by `sentence-transformers` in-process, which was the original plan.
`ollama pull all-minilm` is the same all-MiniLM-L6-v2 model at the same 384 dimensions the
DDL fixes, so nothing about the design changes - but it reuses a runtime that is already
installed and proven for the extractor instead of loading a second inference stack into the
worker. One less thing to install, one less thing to keep warm.

384 dimensions is fixed in the migration. Changing the model to one with a different width
is a migration that invalidates every vector already stored, which is the honest place for
that decision to live rather than in a config file.
"""

from __future__ import annotations

import time

import httpx

from herder.core.config import get_settings
from herder.core.constants import EMBED_DIM


class EmbedderUnavailable(RuntimeError):
    """The embedder cannot run. Raised with the fix in the message, never swallowed."""


class DimensionMismatch(RuntimeError):
    """The model returned vectors of the wrong width.

    Its own error rather than a generic one, because it is the failure that would otherwise
    be discovered as a database error halfway through a derive - and because the fix is a
    migration, not a retry.
    """


class OllamaEmbedder:
    name = "ollama"

    def __init__(self, client: httpx.Client | None = None) -> None:
        settings = get_settings()
        self.model = settings.embed_model_tag
        self.dimensions = EMBED_DIM
        self._url = settings.ollama_url.rstrip("/")
        self._keep_alive = settings.llm_keep_alive
        self._client = client or httpx.Client()
        self.last_latency_ms = 0

    def check_ready(self) -> None:
        try:
            response = self._client.get(f"{self._url}/api/tags", timeout=5)
            response.raise_for_status()
        except Exception as exc:
            raise EmbedderUnavailable(
                f"no Ollama at {self._url}. Install it from https://ollama.com, then "
                "`ollama serve`. From inside Docker the host is "
                "http://host.docker.internal:11434 - set HERDER_OLLAMA_URL."
            ) from exc

        available = [m.get("name", "") for m in response.json().get("models", [])]
        if not any(n == self.model or n.startswith(f"{self.model}:") for n in available):
            raise EmbedderUnavailable(
                f"the embedding model {self.model!r} is not pulled. Run:\n"
                f"    ollama pull {self.model}\n"
                f"Available: {', '.join(available) or 'none'}"
            )

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch. Batched because a derive embeds every surviving candidate."""
        if not texts:
            return []

        started = time.perf_counter()
        try:
            response = self._client.post(
                f"{self._url}/api/embed",
                json={"model": self.model, "input": texts, "keep_alive": self._keep_alive},
                timeout=get_settings().llm_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            raise EmbedderUnavailable(f"embedding failed: {type(exc).__name__}: {exc}") from exc

        self.last_latency_ms = int((time.perf_counter() - started) * 1000)
        vectors = payload.get("embeddings") or []

        if len(vectors) != len(texts):
            raise EmbedderUnavailable(
                f"asked for {len(texts)} embeddings and got {len(vectors)}"
            )
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise DimensionMismatch(
                    f"{self.model!r} returned {len(vector)} dimensions and the schema is "
                    f"fixed at {self.dimensions}. Changing the embedding model is a "
                    "migration that invalidates every stored vector, not a setting."
                )
        return vectors

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


def embedding_text(title: str, text: str) -> str:
    """What actually gets embedded.

    Title and text together, because a title alone is too short to place reliably in the
    vector space and the text alone loses the normalised phrasing the title carries.
    """
    title, text = title.strip(), text.strip()
    return title if text == title else f"{title}\n\n{text}"
