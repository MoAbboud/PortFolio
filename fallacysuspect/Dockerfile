# fallacy_warn — logical-fallacy warning tool
#
# The image contains the code and the libraries to run the trained models. The models
# themselves are mounted at /app/models (several hundred MB each, never baked in), and
# text to analyze is mounted in or piped via stdin. There is no API key anywhere.

FROM python:3.14-slim

# Predictable, chatter-free Python in a container.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# torch from the CPU index before anything else asks for it. transformers depends on
# torch, and the PyPI build on Linux is the CUDA one - gigabytes of GPU libraries for a
# server that has no GPU. Installed first, the later requirement is already satisfied.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install deps first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Then the package.
COPY fallacy_warn/ ./fallacy_warn/

# Run as a non-root user. Give it a writable dir for the SQLite database;
# mount a volume at /data to persist evaluations across container runs.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data /app/models && chown appuser:appuser /data
USER appuser
ENV FALLACY_WARN_DB=/data/fallacy_warn.db
ENV FALLACY_BACKEND=local

# Web UI port (see `serve` below). Publish it with `docker run -p 8000:8000`.
EXPOSE 8000

# `docker run <image> check --file /data/argument.txt` appends to this.
# Web UI (development server):
#   docker run -p 8000:8000 -v ./models:/app/models:ro <image> serve --host 0.0.0.0
# In production deploy/docker-compose.prod.yml replaces this entrypoint with gunicorn.
ENTRYPOINT ["python", "-m", "fallacy_warn"]
CMD ["--help"]
