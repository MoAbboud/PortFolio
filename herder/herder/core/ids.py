"""UUIDv7 generation.

Every primary key in this schema is a UUIDv7 generated here rather than by the database.
Two reasons, and both of them are load-bearing:

1. **Time ordered.** The first 48 bits are a millisecond timestamp, so ids sort by creation
   and a b-tree index on a primary key stops fragmenting the way it does with UUIDv4. On a
   table like `messages`, which is append-only and only ever read in order, that matters.
2. **Known before the insert.** `entry_lineage` rows reference an entry that does not exist
   yet, and a derive builds a whole graph of entries, revisions and lineage in memory before
   writing any of it. Waiting for the database to hand back an id would mean writing that
   graph one round trip at a time.

Python 3.13 has no `uuid.uuid7`, so this is a small implementation of RFC 9562 section 5.7
rather than a dependency.
"""

from __future__ import annotations

import os
import threading
import time
import uuid

_LOCK = threading.Lock()
_last_ms = -1
_last_seq = 0

_MAX_SEQ = 0xFFF  # rand_a is 12 bits, and that is where the counter lives


def uuid7() -> uuid.UUID:
    """Return a time-ordered UUIDv7.

    Monotonic within a process: ids generated in the same millisecond still sort in the
    order they were created, because the 12-bit `rand_a` field is used as a counter rather
    than as randomness. Without that, a loop creating a hundred entries in one millisecond
    would produce ids that sort arbitrarily, and "sorted by id" would silently stop meaning
    "in the order it happened" - which is exactly what several queries in this system rely
    on.
    """
    global _last_ms, _last_seq

    with _LOCK:
        ms = time.time_ns() // 1_000_000

        if ms > _last_ms:
            _last_ms, _last_seq = ms, 0
        else:
            # Same millisecond, or a clock that went backwards - NTP does that, and a
            # laptop resuming from sleep does it enthusiastically. Either way, never go
            # backwards: keep the last timestamp and advance the counter.
            _last_seq += 1
            if _last_seq > _MAX_SEQ:
                # More than 4096 ids in one millisecond. Borrow from the next one rather
                # than emit a duplicate.
                _last_ms += 1
                _last_seq = 0
            ms = _last_ms

        seq = _last_seq

    b = bytearray(16)
    b[0:6] = ms.to_bytes(6, "big")
    b[6] = 0x70 | ((seq >> 8) & 0x0F)  # version 7 in the high nibble, counter high bits
    b[7] = seq & 0xFF  # counter low bits
    b[8:16] = os.urandom(8)
    b[8] = (b[8] & 0x3F) | 0x80  # RFC 9562 variant

    return uuid.UUID(bytes=bytes(b))


def timestamp_ms(value: uuid.UUID) -> int:
    """The millisecond timestamp embedded in a UUIDv7. Useful in tests and in debugging."""
    return int.from_bytes(value.bytes[0:6], "big")
