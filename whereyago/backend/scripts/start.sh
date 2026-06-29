#!/usr/bin/env sh
# Container entrypoint: apply migrations, then serve the API.
# Access logging is handled by our correlation-id middleware, so uvicorn's is off.
set -eu

echo "Running database migrations..."
alembic upgrade head

echo "Starting API..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
