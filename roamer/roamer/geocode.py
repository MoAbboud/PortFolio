"""Address search, through the server, for the finder who types where they are.

OpenStreetMap's Nominatim, under its usage policy: at most one request a second, an
identifying User-Agent, no search-as-you-type, and results cached. Calling it from the
server rather than the browser is what makes those rules enforceable - every visitor shares
one cache and one rate limit, instead of each browser counting against the policy alone.

The cache is in memory: one web process, a demo's worth of searches, nothing worth keeping
across restarts. If the site ever runs several processes, a table is the next step.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Protocol

import httpx

from roamer.config import settings


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lng: float


class GeocodeUnavailable(RuntimeError):
    """The geocoder could not be reached or answered badly. Shown as "try again"."""


class Geocoder(Protocol):
    def search(self, query: str) -> list[Place]: ...


class RateLimiter:
    """At most one call per `interval` seconds, across every thread in the process."""

    def __init__(
        self,
        interval: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self._lock = threading.Lock()
        self._last = float("-inf")

    def wait(self) -> None:
        with self._lock:
            gap = self.clock() - self._last
            if gap < self.interval:
                self.sleep(self.interval - gap)
            self._last = self.clock()


class NominatimGeocoder:
    def __init__(self, limiter: RateLimiter | None = None) -> None:
        self.limiter = limiter or RateLimiter(1.0)

    def search(self, query: str) -> list[Place]:
        self.limiter.wait()
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": "5",
            # Prefer, but do not insist on, places near where the map opens.
            "viewbox": _viewbox(),
            "bounded": "0",
        }
        try:
            response = httpx.get(
                f"{settings.nominatim_url.rstrip('/')}/search",
                params=params,
                headers={"User-Agent": settings.nominatim_user_agent},
                timeout=8.0,
            )
            response.raise_for_status()
            rows = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GeocodeUnavailable(type(exc).__name__) from exc
        return [
            Place(label=row["display_name"], lat=float(row["lat"]), lng=float(row["lon"]))
            for row in rows
        ]


def _viewbox() -> str:
    # About 50 km either side of the map's default centre: west,north,east,south.
    lat, lng, d = settings.map_center_lat, settings.map_center_lng, 0.5
    return f"{lng - d},{lat + d},{lng + d},{lat - d}"


class CachedGeocoder:
    """Wraps a geocoder with a small least-recently-used cache, keyed on the query as typed
    once trimmed and lower-cased. Failures are not cached."""

    def __init__(self, inner: Geocoder, size: int = 500) -> None:
        self.inner = inner
        self.size = size
        self._cache: OrderedDict[str, list[Place]] = OrderedDict()
        self._lock = threading.Lock()

    def search(self, query: str) -> list[Place]:
        key = " ".join(query.lower().split())
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        places = self.inner.search(query)
        with self._lock:
            self._cache[key] = places
            self._cache.move_to_end(key)
            while len(self._cache) > self.size:
                self._cache.popitem(last=False)
        return places


_default: CachedGeocoder | None = None


def default_geocoder() -> Geocoder:
    global _default
    if _default is None:
        _default = CachedGeocoder(NominatimGeocoder())
    return _default
