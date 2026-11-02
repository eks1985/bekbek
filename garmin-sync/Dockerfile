FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY garmin-sync/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY garmin-sync/app/ app/
COPY garmin-sync/scripts/ scripts/

# Контейнер работает от root: /data — bind mount с хоста (/opt/garmin-sync/data),
# созданный шагом 1 тоже от root, а токены Garmin библиотека перезаписывает сама.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
