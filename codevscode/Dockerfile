FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The client's sentence model, downloaded at build time so the first question does not wait for
# it. A public Hugging Face repo; no key. Outside /app, so compose's source mount does not hide it.
ENV CLIENT_MODEL_CACHE=/models
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/models')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "codevscode.main:app", "--host", "0.0.0.0", "--port", "8000"]
