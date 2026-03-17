FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY thumbnail/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY thumbnail/ .
COPY shared/ ./shared/

ENV PORT=8080
CMD ["functions-framework", "--target=generate_thumbnail_and_metadata", "--port=8080"]
