# fallacy_warn — logical-fallacy warning tool
#
# The image contains only the code + deps. The API key is supplied at RUN time
# (never baked in), and text to analyze is mounted in or piped via stdin.

FROM python:3.12-slim

# Predictable, chatter-free Python in a container.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install deps first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Then the package.
COPY fallacy_warn/ ./fallacy_warn/

# Run as a non-root user. Give it a writable dir for the SQLite database;
# mount a volume at /data to persist evaluations across container runs.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data && chown appuser:appuser /data
USER appuser
ENV FALLACY_WARN_DB=/data/fallacy_warn.db

# Web UI port (see `serve` below). Publish it with `docker run -p 8000:8000`.
EXPOSE 8000

# `docker run <image> check --file /data/argument.txt` appends to this.
# Web UI:  docker run -p 8000:8000 -e ANTHROPIC_API_KEY <image> serve --host 0.0.0.0
ENTRYPOINT ["python", "-m", "fallacy_warn"]
CMD ["--help"]
