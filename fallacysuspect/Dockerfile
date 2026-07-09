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

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser
USER appuser

# `docker run <image> check --file /data/argument.txt` appends to this.
ENTRYPOINT ["python", "-m", "fallacy_warn"]
CMD ["--help"]
