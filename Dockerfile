# Альфи: API, агент и фронтенд в одном контейнере
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/server/.venv/bin:$PATH"

WORKDIR /app/server
# Сначала только зависимости: слой кэшируется, пока не меняется uv.lock
COPY server/pyproject.toml server/uv.lock server/.python-version ./
# dev-зависимости нужны для OCR pdf при первом запуске
RUN uv sync --locked --no-install-project

COPY server/app ./app
COPY server/scripts ./scripts
COPY web /app/web

# Данные кейса и база монтируются томом в /app/server/data (см. docker-compose.yml)
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
CMD ["sh", "-c", "python -m scripts.bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
