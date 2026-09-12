"""Generate the stage 4 transcripts.

Ten varied conversations, four archetypes, every turn unique. **Not** the stage 9 benchmark
corpus - that one ships hand-written ground-truth fact lists and measures recall. These exist
to break the pipeline and produce the written failure list.

Two rules learned the hard way and enforced here:

- **Every turn must be unique.** An earlier timing transcript drew turns randomly from a pool
  of fifteen lines, and 217 of 240 were rejected at ingest as duplicates by the content hash.
  Ingest was working perfectly and the benchmark was quietly measuring a conversation a tenth
  of the size it believed. Uniqueness is asserted before anything is written.
- **The generator emits a manifest beside the documents**, naming where each hard case was
  planted. Borrowed from `mailman`, where ground truth by construction is what made a corpus
  built after the pipeline trustworthy. This is not ground truth - it is a list of things to
  go and check, which is what a failure list is made of.

The planted cases map onto what stage 4 is told to look for:

    reversal          a decision taken and then explicitly reversed later
    rejection         the assistant proposes, the user declines - must NOT be extracted
    restatement       the same claim in different words - SHOULD merge
    empty_rejection   "I don't want that either" - no content, must not become an entry
    code_block        fenced code with colons and YAML-ish lines - must not be shredded
    long_turn         a single turn over the chunk target - becomes an oversized chunk
    constraint        a hard rule, to check it outranks facts in the render ordering
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 20260912


@dataclass
class Planted:
    kind: str
    turn: int
    note: str


@dataclass
class Transcript:
    name: str
    archetype: str
    turns: list[tuple[str, str]] = field(default_factory=list)
    planted: list[Planted] = field(default_factory=list)

    def say(self, role: str, text: str) -> None:
        self.turns.append((role, text.strip()))

    def plant(self, kind: str, note: str) -> None:
        self.planted.append(Planted(kind, len(self.turns) - 1, note))

    def render(self) -> str:
        return "\n".join(f"{'User' if r == 'user' else 'Assistant'}: {t}" for r, t in self.turns)


# --------------------------------------------------------------------------- material

SUBSYSTEMS = [
    "the ingest door", "the derive cursor", "brief rendering", "probe generation",
    "the NLI floor", "chunk sizing", "the review queue", "corpus labelling",
    "the hosted demo", "worker retries", "lineage panels", "token budgets",
    "the adjuster", "checkpoint scoring", "the vendor adapters",
]

ASSISTANT_PROPOSALS = [
    "introduce a Redis queue in front of the worker so retries survive a restart",
    "add a materialised view so the dashboard query stops scanning the whole table",
    "shard the database by workspace before the row count gets uncomfortable",
    "cache the rendered brief in memory so a repeated serve does not re-render",
    "move the parser into its own service with its own deploy",
    "store a denormalised summary column on the conversation for cheap reads",
    "switch the job table for a proper broker with dead-letter support",
    "add a second embedding model and average the two vectors",
    "keep a rolling window of the last fifty messages in memory",
    "write the brief to object storage and serve it from a CDN",
]

CODE_SNIPPETS = [
    (
        "the derive cursor",
        "```python\n"
        "def advance(cursor: dict[str, int], conversation: str, seq: int) -> dict[str, int]:\n"
        '    """Only ever forward. A cursor that goes backwards re-reads material."""\n'
        "    out = dict(cursor)\n"
        "    out[conversation] = max(out.get(conversation, 0), seq)\n"
        "    return out\n"
        "```",
    ),
    (
        "the compose file",
        "```yaml\n"
        "services:\n"
        "  db:\n"
        "    image: pgvector/pgvector:pg16\n"
        "    environment:\n"
        "      a: 1\n"
        "      q: 2\n"
        "      POSTGRES_DB: herder\n"
        "    healthcheck:\n"
        '      test: ["CMD-SHELL", "pg_isready -U herder"]\n'
        "```",
    ),
    (
        "the render ordering",
        "```python\n"
        "KIND_ORDER = (\n"
        '    "constraint", "decision", "open_thread", "code_state",\n'
        '    "preference", "identity", "glossary", "fact", "artifact_ref",\n'
        ")\n"
        "```",
    ),
    (
        "a failing query",
        "```sql\n"
        "select p.name, count(*) filter (where e.embedding is null)\n"
        "  from entries e join projects p on p.id = e.project_id\n"
        " where e.kind <> 'tail'\n"
        " group by 1;\n"
        "```",
    ),
]

DECISIONS = [
    ("Postgres for production", "SQLite", "the worker and the API write concurrently"),
    ("server-rendered templates", "a React front end", "there is no Node build step to maintain"),
    ("a database-backed queue", "Redis", "retry does not yet need to survive a restart"),
    ("pgvector in the same database", "a separate vector store", "the vectors and the rows they describe belong together"),
    ("tiktoken as the token ruler", "each vendor's own tokeniser", "one consistent ruler beats being right about one vendor"),
    ("UUIDv7 keys generated in the application", "database-side defaults", "the id has to exist before the insert"),
    ("append-only messages", "editing in place", "the raw log is the evidence behind every entry"),
    ("hand-written migrations", "autogenerate", "the constraints carry the design and should be visible"),
]

CONSTRAINTS = [
    "amounts are never floats anywhere in this system, including across the JSON boundary",
    "a failure is recorded and counted, never defaulted into a plausible value",
    "nothing is ever auto-promoted to the stable layer without a person confirming it",
    "injected text lands in the composer and stops there, it is never sent automatically",
    "capture is per-site opt-in and never silent",
    "a removed entry never comes back, however many times the conversation repeats it",
    "no employer or client material enters this repository at any point",
    "every stage has to be checkable from a PowerShell terminal",
]

PREFERENCES = [
    "short answers with no preamble, just the change and why it matters",
    "a loud failure over a fallback that quietly changes the answer",
    "the reasoning written down beside the decision rather than in a commit message",
    "numbers reported with the count behind them",
]

# Deliberately content-free: no noun, nothing a later reader could resolve. The point is
# that they must NOT become entries, so they must not accidentally carry meaning.
EMPTY_REJECTIONS = [
    "I do not want that either.",
    "No, not that one either.",
    "That is a no from me as well.",
    "I would rather not, thanks.",
    "Not that either, no.",
    "No thanks, same answer.",
    "That one is also out.",
    "No. Same reason as before.",
]

IDENTITY = [
    "I work on a Windows machine and test everything from PowerShell",
    "I am one person, so anything needing two people to operate is out of scope",
    "I am building this for a portfolio, so it has to be explainable in an interview",
]


# --------------------------------------------------------------------------- builders


def _beat_decision(t: Transcript, rng: random.Random, i: int) -> None:
    chosen, rejected, because = DECISIONS[i % len(DECISIONS)]
    topic = SUBSYSTEMS[rng.randrange(len(SUBSYSTEMS))]
    t.say("user", f"On {topic}, point {i}. I looked at {rejected} but we are going with {chosen}, because {because}.")
    t.say("assistant", f"Understood - {chosen} it is for {topic}. That also simplifies how step {i} reads back later.")


def _beat_restatement(t: Transcript, rng: random.Random, i: int) -> None:
    chosen, _, _ = DECISIONS[i % len(DECISIONS)]
    t.say("user", f"Just restating item {i} so it is on the record: production runs on {chosen} and that is settled.")
    t.plant("restatement", f"restates the {chosen} decision in different words - should merge, not duplicate")
    t.say("assistant", f"Recorded. Nothing about step {i} changes.")


def _beat_rejection(t: Transcript, rng: random.Random, i: int) -> None:
    proposal = ASSISTANT_PROPOSALS[i % len(ASSISTANT_PROPOSALS)]
    t.say("assistant", f"For step {i} you could {proposal}. It would buy you some headroom later on.")
    t.plant("rejection", f"assistant proposes: {proposal} - must NOT be extracted as a decision")
    t.say("user", f"No. Not for item {i} - that is a service I would have to explain in an interview for no gain.")


def _beat_empty_rejection(t: Transcript, rng: random.Random, i: int) -> None:
    proposal = ASSISTANT_PROPOSALS[(i + 3) % len(ASSISTANT_PROPOSALS)]
    t.say("assistant", f"Another option at step {i} would be to {proposal}.")
    # Indexed by how many have already been planted, not by `i`. Indexing by `i` collided:
    # the beat fires every twenty steps and there are eight variants, so i % 8 repeated
    # within a single transcript and the turn was dropped at ingest.
    used = sum(1 for p in t.planted if p.kind == "empty_rejection")
    t.say("user", EMPTY_REJECTIONS[used % len(EMPTY_REJECTIONS)])
    t.plant("empty_rejection", "a rejection with no content in it - must not become an entry")
    t.say("assistant", f"Fair enough, leaving step {i} as it stands.")


def _beat_reversal(t: Transcript, rng: random.Random, i: int) -> None:
    chosen, rejected, _ = DECISIONS[i % len(DECISIONS)]
    t.say("user", f"Change of plan on item {i} - we are switching away from {chosen} to {rejected} after all.")
    t.plant("reversal", f"reverses the {chosen} decision - must supersede it, not sit beside it")
    t.say("assistant", f"Noted for step {i}, that reverses what was agreed earlier about {chosen}.")


def _beat_code(t: Transcript, rng: random.Random, i: int) -> None:
    label, snippet = CODE_SNIPPETS[i % len(CODE_SNIPPETS)]
    t.say("user", f"Here is {label} as it stands at revision {i}:\n{snippet}\nThat is the shape it keeps.")
    t.plant("code_block", f"fenced code with colons and YAML-ish keys at line start ({label})")
    t.say("assistant", f"That reads cleanly. The only thing I would watch at step {i} is the boundary case.")


def _beat_constraint(t: Transcript, rng: random.Random, i: int) -> None:
    rule = CONSTRAINTS[i % len(CONSTRAINTS)]
    t.say("user", f"A rule for item {i}, and it is not negotiable: {rule}.")
    t.plant("constraint", f"hard rule - should outrank facts in the render ordering: {rule[:48]}")
    t.say("assistant", f"Understood. I will treat that as binding from step {i} onward.")


def _beat_long(t: Transcript, rng: random.Random, i: int) -> None:
    body = "\n".join(
        f"    line {n} of the pasted log for step {i}: worker={n % 7} status=queued "
        f"latency_ms={n * 13 % 900} note=the run continued without incident"
        for n in range(220)
    )
    t.say("user", f"I am pasting the whole log for run {i}, it is long but I want it on the record:\n{body}\nThat is all of it.")
    t.plant("long_turn", "a single turn larger than the chunk target - becomes an oversized chunk")
    t.say("assistant", f"That is a lot of output for step {i}. Nothing in it looks alarming.")


def _beat_discussion(t: Transcript, rng: random.Random, i: int) -> None:
    topic = SUBSYSTEMS[(i * 5) % len(SUBSYSTEMS)]
    t.say(
        "user",
        f"Explain how {topic} behaves when the input is larger than expected, case {i}. "
        f"I want to understand the boundary rather than just be told it is handled, because "
        f"this is the kind of thing that looks fine until the day it does not.",
    )
    t.say(
        "assistant",
        f"For {topic} at case {i}, the boundary is handled by refusing rather than truncating."
        "\n\n"
        f"The reasoning is that a silent truncation looks identical to a small input, and those "
        f"two need telling apart. If the system quietly dropped the overflow, a later reader "
        f"would see a short result and have no way to know whether the input was short or the "
        f"processing was. Refusing produces an error somebody can act on."
        "\n\n"
        f"In practice roughly {i * 17 % 400} rows are affected in the worst case, which is well "
        f"inside what a single process handles. The cost is paid once per request rather than "
        f"once per row, so it does not grow with the size of the corpus."
        "\n\n"
        f"There is a second-order effect worth knowing about: because {topic} runs before the "
        f"budget is applied, an oversized input still consumes the work of being read even when "
        f"it is ultimately refused. That is deliberate - checking the size without reading it "
        f"would mean trusting a header, and a header is not evidence. Expect around "
        f"{i * 31 % 250} milliseconds on the path, most of it in the read rather than the check.",
    )


def _beat_preference(t: Transcript, rng: random.Random, i: int) -> None:
    pref = PREFERENCES[i % len(PREFERENCES)]
    t.say("user", f"While we are on item {i}: I prefer {pref}.")
    t.say("assistant", f"Noted for step {i}.")


def _beat_identity(t: Transcript, rng: random.Random, i: int) -> None:
    fact = IDENTITY[i % len(IDENTITY)]
    t.say("user", f"Context for item {i} - {fact}, so bear that in mind.")
    t.say("assistant", f"Understood, I will keep that in view from step {i}.")


BEATS = [
    _beat_decision, _beat_discussion, _beat_rejection, _beat_constraint,
    _beat_discussion, _beat_code, _beat_restatement, _beat_discussion,
    _beat_preference, _beat_rejection, _beat_discussion, _beat_reversal,
    _beat_identity, _beat_discussion, _beat_empty_rejection, _beat_constraint,
    _beat_discussion, _beat_decision, _beat_code, _beat_discussion,
]

ARCHETYPES = {
    "coding": "a coding session",
    "research": "research and writing",
    "planning": "business planning",
    "handover": "a support handover",
}


def build(name: str, archetype: str, beats: int, rng: random.Random, with_long: bool) -> Transcript:
    t = Transcript(name=name, archetype=archetype)
    t.say("user", f"Starting {ARCHETYPES[archetype]} on herder, file {name}. I want the decisions recorded as we go.")
    t.say("assistant", f"Ready. I will keep track of what is settled during {name}, which is {ARCHETYPES[archetype]}.")

    for i in range(beats):
        BEATS[i % len(BEATS)](t, rng, i)
        if with_long and i == beats // 2:
            _beat_long(t, rng, i)

    t.say("user", f"That is everything for {name}. Summarise nothing, I just want it on the record.")
    t.say("assistant", f"Recorded for {name}. Nothing further from me.")
    return t


def main() -> None:
    rng = random.Random(SEED)
    plan = [
        ("01-coding-session", "coding", 80, False),
        ("02-coding-debug", "coding", 60, True),
        ("03-research-notes", "research", 70, False),
        ("04-research-review", "research", 72, False),
        ("05-planning-roadmap", "planning", 95, False),
        ("06-planning-budget", "planning", 50, True),
        ("07-handover-support", "handover", 65, False),
        ("08-handover-oncall", "handover", 64, False),
        ("09-coding-refactor", "coding", 110, False),
        ("10-planning-hosting", "planning", 40, True),
    ]

    manifest = {}

    for name, archetype, beats, with_long in plan:
        t = build(name, archetype, beats, rng, with_long)
        text = t.render()

        # Uniqueness is the rule this generator exists to enforce, and it is scoped the way
        # the database scopes it: `unique (conversation_id, content_hash)`. A turn repeated
        # WITHIN a transcript is silently dropped at ingest, and the corpus then measures
        # something smaller than it claims to. The same sentence in two different
        # conversations is fine and realistic - people do repeat themselves across chats, and
        # that is a case worth having in the corpus rather than engineering away.
        seen_turns: set[str] = set()
        for role, body in t.turns:
            key = f"{role}:{body}"
            if key in seen_turns:
                raise SystemExit(f"{name}: duplicate turn would be dropped at ingest:\n{body[:90]}")
            seen_turns.add(key)

        (HERE / f"{name}.txt").write_text(text, encoding="utf-8")
        manifest[name] = {
            "archetype": archetype,
            "turns": len(t.turns),
            "chars": len(text),
            "planted": [{"kind": p.kind, "turn": p.turn, "note": p.note} for p in t.planted],
        }
        print(f"{name:22s} {archetype:9s} {len(t.turns):4d} turns  {len(text):7d} chars  {len(t.planted):3d} planted")

    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(m["chars"] for m in manifest.values())
    planted = sum(len(m["planted"]) for m in manifest.values())
    print(f"\n{len(manifest)} transcripts, {total} chars, {planted} planted cases, all turns unique")


if __name__ == "__main__":
    main()
