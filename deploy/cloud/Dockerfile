# Build reproduzível do frontend + backend; credenciais jamais entram na imagem.
FROM node:22-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY ops /app/ops
COPY --from=frontend /src/dist /app/dist
RUN useradd --create-home --shell /usr/sbin/nologin estq \
    && mkdir -p /app/backend/uploads "/home/estq/Documents/INDEX ERP DATA" \
    && chown -R estq:estq /app/backend/uploads "/home/estq/Documents/INDEX ERP DATA" /app
USER estq
WORKDIR /app/backend
EXPOSE 8000
CMD ["python", "run_production.py"]
