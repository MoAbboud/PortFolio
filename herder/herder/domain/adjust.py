"""What a person may do to an entry, and from which state. Pure.

The status flow is the one in `requirements/04-data-model.md`:

    active   -> pinned      pin
    pinned   -> active      unpin
    active   -> removed     remove      (and from pinned, and from archived)
    removed  -> active      restore     only a person can do this
    archived -> active      restore
    active   -> archived    archive
    project  -> stable      promote     a layer change, not a status change

Three things are refused whatever the action, each for its own reason:

- **A superseded entry.** Terminal: it stays so that a checkpoint run before the reversal is
  still readable, and editing it would rewrite history.
- **The session tail.** It is replaced wholesale by every derive; an edit to it would last
  until the next one and then vanish, which is worse than refusing.
- **A refused move is an error, never a silent no-op.** Pinning an entry that is already
  pinned is harmless, but pinning a removed one means the person thinks it is active, and
  saying nothing would leave them believing it is in the brief.
"""

from __future__ import annotations

from dataclasses import dataclass

LAYERS = ("stable", "project", "session")
KINDS = (
    "constraint",
    "decision",
    "open_thread",
    "code_state",
    "preference",
    "identity",
    "glossary",
    "fact",
    "artifact_ref",
)

STATUS_ACTIONS: dict[str, tuple[frozenset[str], str]] = {
    "pin": (frozenset({"active"}), "pinned"),
    "unpin": (frozenset({"pinned"}), "active"),
    "remove": (frozenset({"active", "pinned", "archived"}), "removed"),
    "restore": (frozenset({"removed", "archived"}), "active"),
    "archive": (frozenset({"active"}), "archived"),
}
ACTIONS = (*STATUS_ACTIONS, "promote")

# Statuses whose text and layer a person may still change. Editing a removed entry is refused
# rather than allowed: the edit would be invisible, and restoring it later would surface text
# the person wrote at a time they believed it was gone.
EDITABLE = frozenset({"active", "pinned", "archived"})


class Refused(ValueError):
    """The action does not apply to the entry as it stands. The message says why."""


@dataclass(frozen=True)
class Change:
    status: str
    layer: str


def _guard(kind: str, status: str) -> None:
    if kind == "tail":
        raise Refused("the session tail is rewritten by every derive; it cannot be adjusted by hand")
    if status == "superseded":
        raise Refused("a superseded entry is history - a later claim replaced it - and cannot be changed")


def apply(action: str, *, status: str, layer: str, kind: str) -> Change:
    """The entry's status and layer after `action`, or `Refused` with the reason."""
    _guard(kind, status)

    if action == "promote":
        if status not in EDITABLE:
            raise Refused(f"a {status} entry cannot be promoted; restore it first")
        if layer == "stable":
            raise Refused("already in Stable")
        if layer != "project":
            # Session entries are about the current thread. Straight to Stable skips the
            # judgement that it is about the work at all; relayer to Project first.
            raise Refused("only a Project entry can be promoted to Stable; move it to Project first")
        return Change(status=status, layer="stable")

    if action not in STATUS_ACTIONS:
        raise Refused(f"unknown action {action!r}; expected one of {', '.join(ACTIONS)}")

    allowed_from, to = STATUS_ACTIONS[action]
    if status not in allowed_from:
        raise Refused(f"cannot {action} an entry that is {status} (only one that is {' or '.join(sorted(allowed_from))})")
    return Change(status=to, layer=layer)


def check_edit(*, status: str, kind: str, layer: str | None) -> None:
    _guard(kind, status)
    if status not in EDITABLE:
        raise Refused(f"a {status} entry cannot be edited; restore it first")
    if layer is not None and layer not in LAYERS:
        raise Refused(f"unknown layer {layer!r}; expected one of {', '.join(LAYERS)}")
