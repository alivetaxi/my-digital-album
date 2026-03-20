"""Thumbnail generation Cloud Function (Storage trigger via Eventarc)."""
from __future__ import annotations

import io
import json
import logging
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone

import functions_framework
from cloudevents.http import CloudEvent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GCS_PATH_RE = re.compile(
    r"^media/(?P<uid>[^/]+)/(?P<album_id>[^/]+)/(?P<media_id>[^/]+)/original\.[^/]+$"
)

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
VIDEO_TYPES = {"video/mp4", "video/quicktime"}
THUMBNAIL_WIDTH = 400


class InvalidFileFormatError(Exception):
    pass


class CorruptedFileError(Exception):
    pass


@functions_framework.cloud_event
def generate_thumbnail_and_metadata(event: CloudEvent) -> None:
    """Triggered when a file is finalized in GCS."""
    data = event.data
    bucket_name: str = data["bucket"]
    object_name: str = data["name"]
    content_type: str = data.get("contentType", "")

    match = GCS_PATH_RE.match(object_name)
    if not match:
        logger.info("Ignoring non-media path: %s", object_name)
        return

    uid = match.group("uid")
    album_id = match.group("album_id")
    media_id = match.group("media_id")

    try:
        _process(bucket_name, object_name, uid, album_id, media_id, content_type)
    except (InvalidFileFormatError, CorruptedFileError) as exc:
        logger.error("Unrecoverable error for %s: %s", object_name, exc)
        _update_media(
            album_id,
            media_id,
            {"thumbnailStatus": "failed", "updatedAt": datetime.now(timezone.utc)},
        )
    except Exception:
        # Recoverable — re-raise to trigger Eventarc retry
        raise


def _process(
    bucket_name: str,
    object_name: str,
    uid: str,
    album_id: str,
    media_id: str,
    content_type: str,
) -> None:
    from google.cloud import storage as gcs

    client = gcs.Client(project=os.environ.get("GCP_PROJECT_ID"))
    file_bytes = client.bucket(bucket_name).blob(object_name).download_as_bytes()

    duration: float | None = None
    if content_type in IMAGE_TYPES or content_type.startswith("image/"):
        thumbnail_bytes, width, height, metadata = _process_image(file_bytes, content_type)
    elif content_type in VIDEO_TYPES or content_type.startswith("video/"):
        thumbnail_bytes, width, height, duration, metadata = _process_video(file_bytes)
    else:
        raise InvalidFileFormatError(f"Unsupported content type: {content_type}")

    # Upload thumbnail
    thumb_bucket_name = os.environ.get("THUMBNAILS_BUCKET", bucket_name)
    thumb_path = f"media/{uid}/{album_id}/{media_id}/thumbnail.jpg"
    thumb_client = gcs.Client(project=os.environ.get("GCP_PROJECT_ID"))
    thumb_client.bucket(thumb_bucket_name).blob(thumb_path).upload_from_string(
        thumbnail_bytes, content_type="image/jpeg"
    )

    updates: dict = {
        "thumbnailPath": thumb_path,
        "thumbnailStatus": "ready",
        "width": width,
        "height": height,
        "duration": duration,
        "updatedAt": datetime.now(timezone.utc),
    }
    if metadata.get("takenAt"):
        updates["takenAt"] = metadata["takenAt"]
    if metadata.get("takenPlace") is not None:
        updates["takenPlace"] = metadata["takenPlace"]

    _update_media(album_id, media_id, updates)
    _increment_media_count(album_id)


def _process_image(
    file_bytes: bytes, content_type: str
) -> tuple[bytes, int, int, dict]:
    """Resize image to THUMBNAIL_WIDTH and extract EXIF. Returns (jpeg_bytes, width, height, metadata)."""
    try:
        if content_type in ("image/heic", "image/heif"):
            import pillow_heif

            pillow_heif.register_heif_opener()

        from PIL import Image

        img = Image.open(io.BytesIO(file_bytes))
        orig_width, orig_height = img.size
        metadata = _extract_exif(img)

        img = img.convert("RGB")
        new_height = int(orig_height * THUMBNAIL_WIDTH / orig_width)
        thumbnail = img.resize((THUMBNAIL_WIDTH, new_height), Image.LANCZOS)

        buf = io.BytesIO()
        thumbnail.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), orig_width, orig_height, metadata

    except (InvalidFileFormatError, CorruptedFileError):
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "cannot identify image file" in msg or "decompression" in msg:
            raise CorruptedFileError(str(exc)) from exc
        raise


def _process_video(file_bytes: bytes) -> tuple[bytes, int, int, float | None, dict]:
    """Extract thumbnail frame and metadata from video via ffmpeg/ffprobe.

    Returns (jpeg_bytes, width, height, duration_seconds, metadata).
    """
    # Write to a temp file — ffmpeg/ffprobe require a seekable file path
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    try:
        tmp.write(file_bytes)
        tmp.flush()
        tmp.close()
        video_path = tmp.name

        # --- metadata via ffprobe ---
        probe = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_streams", "-show_format",
                video_path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        probe_data = json.loads(probe.stdout) if probe.returncode == 0 else {}
        if probe.returncode != 0:
            logger.warning("ffprobe failed: %s", probe.stderr)

        width, height, duration, metadata = _extract_video_metadata(probe_data)

        # --- thumbnail frame via ffmpeg ---
        # Try 1 second in; fall back to very first frame for short clips
        frame_bytes: bytes | None = None
        for seek in ("00:00:01", "00:00:00"):
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-ss", seek, "-i", video_path,
                    "-vframes", "1",
                    "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
                ],
                capture_output=True, timeout=60,
            )
            if result.returncode == 0 and result.stdout:
                frame_bytes = result.stdout
                break

        if not frame_bytes:
            raise CorruptedFileError("Could not extract frame from video")

        # Resize frame to THUMBNAIL_WIDTH (keep aspect ratio)
        from PIL import Image

        img = Image.open(io.BytesIO(frame_bytes))
        orig_w, orig_h = img.size
        if orig_w == 0:
            raise CorruptedFileError("Video frame has zero width")
        # Use probe dimensions if PIL reports 0
        if width == 0:
            width = orig_w
        if height == 0:
            height = orig_h
        new_h = int(orig_h * THUMBNAIL_WIDTH / orig_w)
        thumbnail = img.convert("RGB").resize((THUMBNAIL_WIDTH, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        thumbnail.save(buf, format="JPEG", quality=85)

        return buf.getvalue(), width, height, duration, metadata

    except (InvalidFileFormatError, CorruptedFileError):
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "cannot identify image file" in msg:
            raise CorruptedFileError(str(exc)) from exc
        raise
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def _extract_video_metadata(probe_data: dict) -> tuple[int, int, float | None, dict]:
    """Parse ffprobe JSON into (width, height, duration, metadata-dict)."""
    try:
        width = height = 0
        duration: float | None = None
        metadata: dict = {}

        streams = probe_data.get("streams", [])
        fmt = probe_data.get("format", {})

        for stream in streams:
            if stream.get("codec_type") == "video":
                width = stream.get("width", 0)
                height = stream.get("height", 0)
                raw_dur = stream.get("duration") or fmt.get("duration")
                if raw_dur:
                    try:
                        duration = float(raw_dur)
                    except (ValueError, TypeError):
                        pass
                break

        # takenAt from format tags
        tags = fmt.get("tags", {})
        for key in ("creation_time", "com.apple.quicktime.creationdate"):
            creation_time = tags.get(key)
            if creation_time:
                try:
                    # ISO 8601: "2023-06-15T10:30:00.000000Z" or without Z
                    clean = creation_time.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(clean)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    metadata["takenAt"] = dt
                    logger.info("Video creation_time: %s", creation_time)
                except Exception as exc:
                    logger.warning("Video creation_time parse failed: %s", exc)
                break

        # takenPlace from ISO 6709 location tag
        location = tags.get("location") or tags.get("com.apple.quicktime.location.ISO6709")
        if location:
            lat, lng = _parse_iso6709(location)
            if lat is not None and lng is not None:
                logger.info("Video GPS lat=%s lng=%s", lat, lng)
                place_name = _reverse_geocode(lat, lng)
                metadata["takenPlace"] = {"lat": lat, "lng": lng, "placeName": place_name}

        return width, height, duration, metadata
    except Exception as exc:
        logger.warning("Video metadata extraction failed: %s", exc)
        return 0, 0, None, {}


def _parse_iso6709(location: str) -> tuple[float | None, float | None]:
    """Parse ISO 6709 location string (e.g. '+35.6894+139.6917+40/') to (lat, lng)."""
    try:
        m = re.match(r"^([+-]\d+\.?\d*)([+-]\d+\.?\d*)", location)
        if m:
            return round(float(m.group(1)), 7), round(float(m.group(2)), 7)
    except Exception as exc:
        logger.warning("ISO 6709 parse failed: %s", exc)
    return None, None


def _extract_exif(img) -> dict:
    """Extract takenAt and takenPlace from EXIF. Returns {} on any failure."""
    try:
        import piexif

        raw = img.info.get("exif")
        if not raw:
            logger.info("EXIF: no exif bytes in image info")
            return {}

        exif = piexif.load(raw)
        result: dict = {}

        # takenAt
        dt_bytes = exif.get("Exif", {}).get(piexif.ExifIFD.DateTimeOriginal)
        if dt_bytes:
            dt_str = dt_bytes.decode("utf-8", errors="ignore").rstrip("\x00")
            logger.info("EXIF: DateTimeOriginal = %s", dt_str)
            result["takenAt"] = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )

        # takenPlace — GPS IFD
        gps = exif.get("GPS", {})
        lat = _gps_to_decimal(
            gps.get(piexif.GPSIFD.GPSLatitude),
            gps.get(piexif.GPSIFD.GPSLatitudeRef),
        )
        lng = _gps_to_decimal(
            gps.get(piexif.GPSIFD.GPSLongitude),
            gps.get(piexif.GPSIFD.GPSLongitudeRef),
        )
        if lat is not None and lng is not None:
            logger.info("EXIF: GPS lat=%s lng=%s", lat, lng)
            place_name = _reverse_geocode(lat, lng)
            result["takenPlace"] = {"lat": lat, "lng": lng, "placeName": place_name}
        else:
            logger.info("EXIF: no GPS data")

        return result
    except Exception as exc:
        logger.warning("EXIF extraction failed: %s", exc)
        return {}


def _gps_to_decimal(dms, ref) -> float | None:
    """Convert EXIF GPS DMS rational tuple + ref byte to a signed decimal degree."""
    if not dms or not ref:
        return None
    try:
        def r(rational):
            return rational[0] / rational[1]
        degrees = r(dms[0]) + r(dms[1]) / 60 + r(dms[2]) / 3600
        if ref in (b"S", b"W"):
            degrees = -degrees
        return round(degrees, 7)
    except Exception as exc:
        logger.warning("GPS DMS conversion failed: %s", exc)
        return None


def _reverse_geocode(lat: float, lng: float) -> str | None:
    """Call Google Maps Geocoding API; returns a human-readable place name or None."""
    import urllib.request
    import urllib.parse

    api_key = os.environ.get("GEOCODING_API_KEY", "")
    if not api_key:
        logger.info("GEOCODING_API_KEY not set — skipping reverse geocode")
        return None

    params = urllib.parse.urlencode({"latlng": f"{lat},{lng}", "key": api_key})
    url = f"https://maps.googleapis.com/maps/api/geocode/json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
        if data.get("status") != "OK" or not data.get("results"):
            logger.warning("Geocoding returned status=%s", data.get("status"))
            return None
        place_name = data["results"][0].get("formatted_address")
        logger.info("Geocoding result: %s", place_name)
        return place_name
    except Exception as exc:
        logger.warning("Reverse geocoding failed: %s", exc)
        return None


def _col(name: str) -> str:
    env = os.environ.get("ENVIRONMENT", "dev")
    return f"{name}-{env}"


def _get_db():
    from google.cloud import firestore

    return firestore.Client(project=os.environ.get("GCP_PROJECT_ID"))


def _update_media(album_id: str, media_id: str, fields: dict) -> None:
    db = _get_db()
    (
        db.collection(_col("albums"))
        .document(album_id)
        .collection("media")
        .document(media_id)
        .update(fields)
    )


def _increment_media_count(album_id: str) -> None:
    from google.cloud import firestore

    db = _get_db()
    db.collection(_col("albums")).document(album_id).update(
        {
            "mediaCount": firestore.Increment(1),
            "updatedAt": datetime.now(timezone.utc),
        }
    )
