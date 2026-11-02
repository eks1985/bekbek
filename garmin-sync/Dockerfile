FROM python:3.12-slim
WORKDIR /app
COPY . /ctx
RUN echo "=== ls /ctx:" && ls -la /ctx | head -30 \
    && echo "=== .dockerignore:" && (cat /ctx/.dockerignore || echo "нет") \
    && echo "=== Dockerfile:" && head -12 /ctx/Dockerfile
