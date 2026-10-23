"""The FastAPI application.

/health; the client - starting an attempt and asking questions (stage 3); and the workspace page
with the browser modules it loads (stage 4). Matches (stages 5 to 7) are added as routers here.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from codevscode import __version__
from codevscode.api import attempts, health
from codevscode.challenges import UnknownChallenge, challenge_path

PROJECT = Path(__file__).resolve().parents[1]

# Windows' registry can map .js to text/plain, and a browser refuses to run a module served that
# way (pedalsim found it with python -m http.server). Set the types the workspace needs.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")

app = FastAPI(
    title="codevscode",
    version=__version__,
    summary="Code vs Code: a coding duel judged on the questions you ask, the bugs you prove "
    "and how well you defend what your helper built.",
)

app.include_router(health.router)
app.include_router(attempts.router)

# The browser loads the same runner and helper modules the judge and the harness use.
app.mount("/static/runner", StaticFiles(directory=PROJECT / "runner"), name="runner")
app.mount("/static/helper", StaticFiles(directory=PROJECT / "helper"), name="helper")
app.mount("/static/web", StaticFiles(directory=PROJECT / "web"), name="web")


@app.get("/", include_in_schema=False)
def home() -> RedirectResponse:
    return RedirectResponse("/play/sample")


@app.get("/play/{slug}", include_in_schema=False)
def play(slug: str) -> FileResponse:
    """The workspace for one challenge. The page starts or resumes an attempt itself."""
    try:
        challenge_path(slug)
    except UnknownChallenge:
        raise HTTPException(404, "There is no challenge by that name.") from None
    return FileResponse(PROJECT / "web" / "workspace.html", media_type="text/html")
