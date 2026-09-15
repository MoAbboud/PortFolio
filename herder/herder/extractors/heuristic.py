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

# Used twice: as a rule below, and to let its short sentences under the length floor.
_PROHIBITION_OPENING = re.compile(
    r"^(?:no|nothing|nobody|no one|none of|only)\s+"
    r"(?!thanks\b|problem\b|worries\b|idea\b|rush\b|need\b|pressure\b|way\b|doubt\b)[a-z]",
    re.I,
)

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
        # **First, above everything.** A reversal is the one thing a memory must not miss: it
        # is the only failure that makes the brief worse than no brief, because the stale
        # claim is served with confidence. Added at stage 10 after the baseline measured it -
        # every false claim herder carried forward was a reversal, and the cause was not the
        # merge step but this one: the sentences that announced the change matched no rule at
        # all, so nothing was ever extracted to contradict the entry it replaced.
        #
        #   "Scrap the rounding I mentioned earlier - keep stock exact to the gram"
        #   "Change of plan on who gets the reorder email: it goes to both"
        #   "Update the backup schedule I described earlier: the offsite drive is weekly now"
        #
        # None of those carries a modal verb or a decision cue. They carry a cue of their own,
        # and it is the cue rather than the claim that this pattern looks for.
        "decision",
        "project",
        "an explicit reversal of something said earlier",
        0.66,
        re.compile(
            r"\b(change of plan|changed my mind|change to|scrap (?:that|the|what)|"
            r"forget (?:that|the|what)|disregard|ignore what i said|correction|"
            r"i'm changing|i am changing|revis(?:e|ing|ed)|swap (?:one|that|the)|"
            r"no longer|after all|instead of what i said|from what i said|(?:from|than) (?:earlier|before)|"
            r"(?:said|gave|mentioned|described|told you) (?:you )?(?:earlier|before)|"
            r"(?:earlier|before) (?:is|was) (?:off|out|wrong)|is off\b)",
            re.I,
        ),
    ),
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
        # A prohibition carried by the determiner rather than a modal: "No database.", "Nothing
        # leaves the back-office network", "Nobody on the team is paid below the Living Wage",
        # "Only peer-reviewed sources count". Added at stage 10, attempt 3, after the missed
        # essential facts showed a dozen such sentences matching no rule. Ordinary English, not
        # any conversation generator's phrasing - `test_heuristic.py` checks that.
        #
        # "No," with a comma is an answer to a question, not a determiner, and is left alone;
        # so are the stock phrases where "no" carries no rule ("no thanks", "no problem").
        # These are the one kind allowed under the short-sentence floor: "No franchising." is
        # fifteen characters and a whole constraint.
        "constraint",
        "project",
        "a prohibition or limit stated by its determiner",
        0.60,
        _PROHIBITION_OPENING,
    ),
    (
        "constraint",
        "project",
        "modal obligation or prohibition",
        0.62,
        re.compile(
            r"\b(must not|must|never|always|cannot|can't|can not|do not|don't|has to|have to|"
            r"needs to|need to|required|mandatory|under no circumstances|only ever|no more than)\b"
            # A negated third-person or future verb is a rule only with its verb: "support
            # doesn't answer billing tickets" is one, "until the day it does not." is not.
            r"|\b(?:doesn't|does not|won't|will not|may not)\s+[a-z]",
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
    (
        # **Last, and the weakest signal.** A plain statement of how things are: "The thesis is
        # due in May." / "Duplicates are detected by a SHA-256 hash of the file contents." /
        # "I'm building the inventory service for a bakery chain." Added at stage 10, attempt
        # 3: the missed essential facts were overwhelmingly user sentences like these, carrying
        # no cue word at all, and every rule above is a cue word.
        #
        # It is a fact because nothing in the sentence says more than that, and a fact renders
        # after constraints and decisions - so if it is noise, it competes only with other
        # facts for the budget. Excluded: questions; requests to the assistant; sentences whose
        # subject is a bare pronoun pointing back at the assistant's turn ("that's fine");
        # sentences ending in a colon, which introduce pasted material rather than state
        # anything; and talk about the reply itself ("short answer is fine"), which is an
        # instruction for one message, not memory.
        "fact",
        "project",
        "a plain statement of how things are",
        0.45,
        re.compile(
            r"^(?!(?:can|could|would|should|do|does|did|what|why|how|when|where|which|who|please|"
            r"tell me|explain|give me|show me|help me|walk me|remind me|assume|let me|thanks|"
            r"thank you|ok|okay|yes|sure|great|hmm|that(?:'s| is| was)|it(?:'s| is| was)|"
            r"this(?:'s| is| was)|those|these|they(?:'re| are)|"
            # A request in the first person is still a request.
            r"i want (?:to (?:understand|know|see|learn)|you|your)|i'd like (?:to|you|your|help)|i would like)\b)"
            r"(?!.*[?:]\s*$)"
            r"(?!.*\b(?:answer|reply|response)\b)"
            # Musing is not a statement, whichever branch below it would otherwise match.
            r"(?!(?:i'm|i am|we're|we are)\s+(?:thinking|wondering|trying|hoping|looking|curious|asking|guessing|not sure)\b)"
            r"(?:(?:i'm|i am|we're|we are|i've been|we've been)\s+\w+ing\b"
            r"|(?=.*\b(?:is|are|will be|stays|goes|runs|lives|opens|uses)\b))",
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

# A refusal whose referent is a bare pronoun. Same principle as the rule above, found at
# stage 4 where thirteen entries like this reached real briefs:
#
#     "Not for item 69 - that is a service I would have to explain in an interview."
#
# The main clause's subject is "that", which points at the assistant turn this extractor
# deliberately never reads. A reader of the brief learns that something was refused and has
# no way to find out what.
#
# Deliberately narrow: it fires only when the sentence OPENS with a refusal and a bare
# demonstrative follows within the first clause. "It is never acceptable to use floats" is
# not a refusal opening and survives; "That approach must never be used" has a noun after
# the demonstrative and survives.
_REFUSAL_WITH_ANAPHOR = re.compile(
    r"^(?:no[.,!]?\s+)?not\b.{0,44}?\b(?:that|this|it)\s+(?:is|are|was|were|'s)\b",
    re.I,
)

# "I would rather not, thanks." matched the preference rule on "i would rather" and became a
# stated preference with nothing preferred in it. A preference has to say what is preferred,
# so "rather not" followed by punctuation or a politeness word is a refusal, not one.
# "I'd rather not use Redis" keeps its complement and survives.
_EMPTY_RATHER = re.compile(r"\b(?:i'd|i would)\s+rather\s+not\s*(?:[,.!;]|$|thanks|thank you)", re.I)

MIN_SENTENCE_CHARS = 20
# The floor for a sentence that opens with a prohibiting determiner ("No database.").
MIN_PROHIBITION_CHARS = 10


class HeuristicExtractor:
    """No weights, no GPU, no network. Runs in milliseconds."""

    name = NAME
    # rules-v2: stage 10 attempt 3 - prohibiting determiners, verb-anchored negation, plain
    # statements. The attempt 1 reversal rule shipped without a bump and is part of v1 runs.
    model = "rules-v2"

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
                if len(sentence) < MIN_SENTENCE_CHARS and not (
                    len(sentence) >= MIN_PROHIBITION_CHARS and _PROHIBITION_OPENING.search(sentence)
                ):
                    continue

                if (
                    _ANAPHORIC_REJECTION.match(sentence)
                    or _REFUSAL_WITH_ANAPHOR.match(sentence)
                    or _EMPTY_RATHER.search(sentence)
                ):
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
