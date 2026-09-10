"""The heuristic extractor: rules over turns, no model, no weights, no network.

This is not a strawman. It is the floor every other extractor has to beat, and it is
probably **what a public link will actually serve**, because a quantised model is gigabytes
and fits no free hosting tier. If the local model cannot beat this, that is the finding, and
it is one worth reporting rather than hiding.

Its governing rule is the first rule of the extraction prompt, applied literally: **only what
the user said.** A conversation with a chatbot is mostly the chatbot talking, and an
extractor that treats assistant output as fact fills the memory with suggestions the user
read and rejected. Assistant turns are not scanned at all.

The known limitation, recorded rather than papered over: agreement expressed as a bare "yes,
do that" attributes nothing, because the content being agreed to lives in the assistant turn
before it. Stage 4 will measure how much that costs on real transcripts, and the fix - if it
earns one - belongs there rather than in a guess made now.
"""

from __future__ import annotations

import re
import time

from herder.domain.chunking import Chunk
from herder.domain.hashing import normalise
from herder.extractors.base import make_title
from herder.schemas.extraction import Candidate, ExtractionOutcome

NAME = "heuristic"

# Fenced code is pulled out before sentence splitting - a code block is not prose and
# splitting it on full stops produces nonsense - but its presence is a signal in itself.
_FENCE = re.compile(r"```.*?```", re.DOTALL)
_PATHY = re.compile(r"[\w./-]+\.(py|ts|tsx|js|sql|md|json|yml|yaml|toml|cfg|html|css|sh|ps1)\b")

# Sentence boundaries: terminal punctuation followed by space, or a line break. Deliberately
# crude - this is a baseline, and a sentence splitter is not the interesting part.
_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")

# Order is priority order: the first pattern that matches a sentence wins, and the order runs
# from most specific signal to least.
#
#   explicit incompleteness > identity > preference > constraint > decision > weak hints
#
# Two of those placements were mistakes found by reading real output rather than by
# reasoning, and both are the same mistake: a generic marker sitting above a specific one.
# "We still need to pick X" was a constraint because of "need to", and "I work on Windows
# ... so every stage has to be checkable" was a constraint because of "has to". Constraints
# still outrank decisions, because "we must never use X" is a constraint wearing a
# decision's clothes and the constraint is the more useful half.
RULES: list[tuple[str, str, str, float, re.Pattern[str]]] = [
    (
        # First, and above `constraint`, because "we still need to pick X" is an unfinished
        # task wearing an obligation's clothes. Only the unambiguous markers of
        # incompleteness live here; the weaker ones are further down, below constraints.
        "open_thread",
        "session",
        "explicitly unfinished",
        0.58,
        re.compile(
            r"\b(still need|still have to|still to|not yet|todo|to do|open question|"
            r"haven't|have not|yet to|remains to be|come back to)\b",
            re.I,
        ),
    ),
    (
        # Identity and preference sit above `constraint` because a first-person
        # self-description is a far more specific signal than a modal verb, and a specific
        # signal should outrank a generic one. "I work on a Windows machine and test
        # everything from PowerShell, so every stage has to be checkable there" is one
        # sentence carrying both, and the durable half is the identity - the obligation is
        # only true because of it. A sentence-level extractor has to pick one, and picking
        # the modal put a fact about the user into the project layer, where it expires.
        "identity",
        "stable",
        "something durable about the user",
        0.55,
        re.compile(r"\b(i am a|i'm a|my name is|i work (?:at|as|on)|our team|my role|i'm the)\b", re.I),
    ),
    (
        "preference",
        "stable",
        "a stated preference about how to work",
        0.55,
        re.compile(
            r"\b(i prefer|i'd rather|i would rather|i like|i don't like|i dislike|i hate|"
            r"please always|please never|my preference)\b",
            re.I,
        ),
    ),
    (
        "constraint",
        "project",
        "modal obligation or prohibition",
        0.62,
        re.compile(
            r"\b(must not|must|never|always|cannot|can't|can not|do not|don't|has to|have to|"
            r"needs to|need to|required|mandatory|under no circumstances|only ever)\b",
            re.I,
        ),
    ),
    (
        "decision",
        "project",
        "a choice stated as settled",
        0.60,
        re.compile(
            r"\b(we(?:'| a)?re going to|we will|we'll|we use|we're using|we are using|let's|lets|"
            r"decided|decision is|going with|switch(?:ing)? to|stick with|stay(?:ing)? on|"
            r"i chose|we chose|we picked|instead of)\b",
            re.I,
        ),
    ),
    (
        "open_thread",
        "session",
        "something left unfinished",
        0.50,
        re.compile(
            r"\b(todo|to do|next step|still need|still have to|remaining|open question|"
            r"not yet|we should|haven't|have not|later on|come back to)\b",
            re.I,
        ),
    ),
]

# A rejection whose object is a bare pronoun carries no content. "I don't want that either"
# tells a later reader nothing at all, because "that" refers to something in the assistant
# turn - which this extractor deliberately never reads, so the reference is unresolvable by
# construction rather than merely inconvenient. Suppressed rather than recorded.
#
# Deliberately narrow: it catches the common forms and no more. The general problem is
# anaphora and stage 4 is where its real cost gets measured.
_ANAPHORIC_REJECTION = re.compile(
    r"^(?:i|we)\s+(?:do\s+not|don't|dont|did\s+not|didn't|will\s+not|won't|cannot|can't)\s+"
    r"(?:want|like|need|think|accept)\s+"
    r"(?:that|this|it|those|these|them|either|any\s+of\s+(?:that|this|it|those|these|them))\b",
    re.I,
)

MIN_SENTENCE_CHARS = 20


class HeuristicExtractor:
    """No weights, no GPU, no network. Runs in milliseconds."""

    name = NAME
    model = "rules-v1"

    def check_ready(self) -> None:
        return None

    def extract(self, chunk: Chunk, existing_titles: list[str]) -> ExtractionOutcome:
        started = time.perf_counter()
        known = {normalise(t).lower() for t in existing_titles}
        seen: set[str] = set()
        candidates: list[Candidate] = []

        for message in chunk.messages:
            if message.role != "user":
                continue

            body = _FENCE.sub(" ", message.content)
            has_code = body != message.content or bool(_PATHY.search(message.content))

            for raw in _SPLIT.split(body):
                sentence = raw.strip()
                if len(sentence) < MIN_SENTENCE_CHARS:
                    continue

                if _ANAPHORIC_REJECTION.match(sentence):
                    continue

                match = self._classify(sentence, has_code)
                if match is None:
                    continue
                kind, layer, confidence = match

                key = normalise(sentence).lower()
                if key in seen or key in known:
                    continue
                seen.add(key)

                candidates.append(
                    Candidate(
                        layer=layer,
                        kind=kind,
                        title=make_title(sentence),
                        text=sentence,
                        lineage=[str(message.id)],
                        confidence=confidence,
                    )
                )

        elapsed = int((time.perf_counter() - started) * 1000)
        return ExtractionOutcome(
            candidates=candidates,
            model=self.model,
            prompt_version=self.model,
            input_tokens=chunk.token_count,
            output_tokens=0,
            latency_ms=elapsed,
        )

    def _classify(self, sentence: str, has_code: bool) -> tuple[str, str, float] | None:
        for kind, layer, _why, confidence, pattern in RULES:
            if pattern.search(sentence):
                return kind, layer, confidence
        if has_code and _PATHY.search(sentence):
            return "code_state", "project", 0.50
        return None
