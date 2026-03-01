FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

COPY . .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .
