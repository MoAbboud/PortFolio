FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY requirements.txt .
# torch from the CPU index before anything else asks for it. sentence-transformers depends on
# torch, and the PyPI build on Linux is the CUDA one - gigabytes of GPU libraries in an image
# for a project that decided at the start it has no GPU. Installed first, the later
# requirement is already satisfied and pip does not replace it.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# The API is the default. The worker runs the same image with a different command;
# see docker-compose.yml.
CMD ["uvicorn", "herder.main:app", "--host", "0.0.0.0", "--port", "8000"]
