FROM python:3.12-slim

# Only libheif-dev needed — ffmpeg/ffprobe come via imageio-ffmpeg pip package
# (static binary, avoids the large apt-get install ffmpeg which OOMs on Docker Desktop)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY thumbnail/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY thumbnail/ .
COPY shared/ ./shared/

ENV PORT=8080
CMD ["functions-framework", "--target=generate_thumbnail_and_metadata", "--port=8080"]
