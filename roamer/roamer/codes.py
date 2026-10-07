"""Short listing codes, for /l/{code} and the QR code on a printed flyer.

Six characters from an alphabet with nothing that can be misread on paper: no 0 or o, no 1,
l or i. Lower case only, and lookups lower-case what they are given, so a code typed from a
flyer in capitals still works. 31 ** 6 is about 887 million codes, so a collision is rare;
it is still handled, by trying again, because rare is not never.
"""

from __future__ import annotations

import secrets

ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
LENGTH = 6


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))


def normalise(code: str) -> str:
    return code.strip().lower()


def looks_valid(code: str) -> bool:
    return len(code) == LENGTH and all(c in ALPHABET for c in code)
