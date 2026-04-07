FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Railway injects $PORT at runtime; default to 8100 for local use
EXPOSE 8100

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8100}
