"""Web interface for fallacy_warn.

A small Flask app that serves a single-page UI and one JSON endpoint. The API
key stays server-side (read from the environment, same as the CLI) — the browser
never sees it. This is why the tool needs a backend rather than a static page.

    python -m fallacy_warn serve            # -> http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import os

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

from . import classifier
from .config import DEFAULT_MODEL
from .db import store_analysis
from .llm import LLMError, build_client
from .models import AnalysisResult, Flag
from .pipeline import analyze


def _use_local() -> bool:
    """Prefer the trained local models when available (FALLACY_BACKEND=auto|local|api)."""
    backend = os.environ.get("FALLACY_BACKEND", "auto").lower()
    if backend == "api":
        return False
    if backend == "local":
        return True
    return classifier.is_available()


def create_app(model: str = DEFAULT_MODEL) -> Flask:
    app = Flask(__name__)
    app.config["MODEL"] = model

    # Build one client lazily and reuse it. Kept out of import time so the
    # server can start (and show a friendly error) even with no key set.
    _client_cache: dict[str, object] = {}

    def get_client():
        if "client" not in _client_cache:
            _client_cache["client"] = build_client()
        return _client_cache["client"]

    @app.get("/")
    def index():
        return render_template("index.html", model=app.config["MODEL"])

    @app.post("/api/check")
    def check():
        data = request.get_json(silent=True) or {}
        text = data.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return jsonify({"error": "Please enter some text to analyze."}), 400

        if _use_local():
            # Trained local models — no API key, no per-call cost.
            result = classifier.analyze(text)
            backend = "local"
        else:
            try:
                client = get_client()  # raises LLMError if the key is missing
            except LLMError as exc:
                return jsonify({"error": str(exc)}), 503
            try:
                result = analyze(text, model=app.config["MODEL"], client=client)
            except LLMError as exc:
                return jsonify({"error": str(exc)}), 502
            backend = "api"

        # Always persist the evaluation (best-effort — never blocks the result).
        stored_id = store_analysis(result)

        payload = result.to_dict()
        payload["stored_id"] = stored_id
        payload["backend"] = backend
        return jsonify(payload)

    @app.post("/api/check/stream")
    def check_stream():
        """Same analysis, streamed sentence by sentence so the UI can show a
        live progress bar that colours itself as findings appear."""
        data = request.get_json(silent=True) or {}
        text = data.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return jsonify({"error": "Please enter some text to analyze."}), 400

        def sse(event: dict) -> str:
            return f"data: {json.dumps(event)}\n\n"

        def generate():
            if _use_local():
                try:
                    for event in classifier.analyze_stream(text):
                        if event["type"] == "done":
                            result = AnalysisResult(
                                text=text, flags=[Flag(**d) for d in event["flags"]]
                            )
                            event["stored_id"] = store_analysis(result)
                            event["text"] = text
                            event["backend"] = "local"
                        yield sse(event)
                except Exception as exc:  # surface as a stream event, never a 500
                    yield sse({"type": "error", "error": str(exc)})
                return

            # API backend: no per-sentence progress — one shot, then done.
            yield sse({"type": "start", "total": 0})
            try:
                result = analyze(text, model=app.config["MODEL"], client=get_client())
            except LLMError as exc:
                yield sse({"type": "error", "error": str(exc)})
                return
            yield sse({
                "type": "done",
                "flags": [f.to_dict() for f in result.flags],
                "text": text,
                "stored_id": store_analysis(result),
                "backend": "api",
            })

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


def serve(host: str = "127.0.0.1", port: int = 8000, model: str = DEFAULT_MODEL) -> None:
    """Run the development server. Blocks until interrupted."""
    create_app(model=model).run(host=host, port=port)
