FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# The API is the default. The worker runs the same image with a different command;
# see docker-compose.yml.
CMD ["uvicorn", "herder.main:app", "--host", "0.0.0.0", "--port", "8000"]
