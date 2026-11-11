"""Matching a player's question to a hidden requirement.

Two matchers behind one protocol, so the report can say which one earns its place:

- `lexical`: TF-IDF over the requirement's phrasings and answer, with a light stemmer. No
  download, no model, a few milliseconds; ports to the browser for the static prototype.
- `embedding`: a small local sentence model (all-MiniLM-L6-v2 through fastembed, ONNX on the
  CPU), cosine similarity. Runs on the server; nothing is sent anywhere.

Either returns a score per requirement; `best` takes the strongest, and only if it clears the
threshold. One question reveals at most one requirement, so "tell me everything" gets one
answer at most - and with a strict threshold, none.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

STOPWORDS = frozenset(
    """a about after all am an and any are as at be been being but by can could did do does
    doing for from had has have how i if in into is it its me my no not of on or our should so
    some such than that the their them then there these they this those to too up us was we
    were what when where which while who will with would you your yours""".split()
)


@dataclass(frozen=True)
class Requirement:
    key: str
    category: str
    answer: str
    phrasings: tuple[str, ...]


def load_requirements(challenge_dir: Path | str) -> list[Requirement]:
    data = json.loads((Path(challenge_dir) / "hidden" / "requirements.json").read_text(encoding="utf-8"))
    return [Requirement(r["id"], r["category"], r["answer"], tuple(r["phrasings"])) for r in data]


class Matcher(Protocol):
    name: str

    def scores(self, question: str) -> dict[str, float]:
        """Requirement key -> similarity, higher is closer."""


def best(matcher: Matcher, question: str, threshold: float) -> tuple[str | None, float]:
    """The requirement the question reveals, and its score; (None, score) below the threshold."""
    scores = matcher.scores(question)
    if not scores:
        return None, 0.0
    key = max(scores, key=lambda k: scores[k])
    return (key if scores[key] >= threshold else None), scores[key]


# Lexical


def stem(word: str) -> str:
    for suffix in ("ations", "ation", "ings", "ing", "edly", "ed", "ies", "es", "ly", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


def tokens(text: str) -> list[str]:
    return [stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS]


class LexicalMatcher:
    name = "lexical"

    def __init__(self, requirements: list[Requirement], cache_dir: str | None = None) -> None:
        # Each phrasing and each answer is a document; a requirement scores its best document.
        self.documents: list[tuple[str, Counter[str]]] = []
        for requirement in requirements:
            for text in (*requirement.phrasings, requirement.answer):
                self.documents.append((requirement.key, Counter(tokens(text))))
        frequency: Counter[str] = Counter()
        for _, counts in self.documents:
            frequency.update(counts.keys())
        n = len(self.documents)
        self.idf = {term: math.log((1 + n) / (1 + df)) + 1 for term, df in frequency.items()}
        self.vectors = [(key, self._weigh(counts)) for key, counts in self.documents]

    def _weigh(self, counts: Counter[str]) -> dict[str, float]:
        vector = {t: c * self.idf.get(t, 0.0) for t, c in counts.items() if t in self.idf}
        norm = math.sqrt(sum(v * v for v in vector.values())) or 1.0
        return {t: v / norm for t, v in vector.items()}

    def scores(self, question: str) -> dict[str, float]:
        query = self._weigh(Counter(tokens(question)))
        result: dict[str, float] = {}
        for key, vector in self.vectors:
            similarity = sum(weight * vector.get(term, 0.0) for term, weight in query.items())
            result[key] = max(result.get(key, 0.0), similarity)
        return result


# Embedding


class EmbeddingMatcher:
    name = "embedding"
    model_name = "sentence-transformers/all-MiniLM-L6-v2"

    def __init__(self, requirements: list[Requirement], cache_dir: str | None = None) -> None:
        from fastembed import TextEmbedding  # imported here: only this matcher needs it

        self.model = TextEmbedding(self.model_name, cache_dir=cache_dir or None)
        texts, self.keys = [], []
        # The same documents as the lexical matcher, so the report compares like with like.
        for requirement in requirements:
            for text in (*requirement.phrasings, requirement.answer):
                texts.append(text)
                self.keys.append(requirement.key)
        self.vectors = [self._unit(v) for v in self.model.embed(texts)]

    @staticmethod
    def _unit(vector) -> list[float]:
        values = [float(x) for x in vector]
        norm = math.sqrt(sum(x * x for x in values)) or 1.0
        return [x / norm for x in values]

    def scores(self, question: str) -> dict[str, float]:
        query = self._unit(next(iter(self.model.embed([question]))))
        result: dict[str, float] = {}
        for key, vector in zip(self.keys, self.vectors):
            similarity = sum(a * b for a, b in zip(query, vector))
            result[key] = max(result.get(key, -1.0), similarity)
        return result


MATCHERS = {"lexical": LexicalMatcher, "embedding": EmbeddingMatcher}
