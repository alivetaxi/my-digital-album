"""Thumbnail generation Cloud Function (Storage trigger via Eventarc)."""
from __future__ import annotations

import io
import logging
import os
import re
from datetime import datetime, timezone

import functions_framework
from cloudevents.http import CloudEvent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GCS_PATH_RE = re.compile(
    r"^media/(?P<uid>[^/]+)/(?P<album_id>[^/]+)/(?P<media_id>[^/]+)/original\.[^/]+$"
)

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
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

    if content_type in IMAGE_TYPES or content_type.startswith("image/"):
        thumbnail_bytes, width, height, exif = _process_image(file_bytes, content_type)
    else:
        # Video support is Phase 3
        raise InvalidFileFormatError(f"Unsupported content type in Phase 2: {content_type}")

    # Upload thumbnail to THUMBNAILS_BUCKET
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
        "updatedAt": datetime.now(timezone.utc),
    }
    if exif.get("takenAt"):
        updates["takenAt"] = exif["takenAt"]
    if exif.get("takenPlace") is not None:
        updates["takenPlace"] = exif["takenPlace"]

    _update_media(album_id, media_id, updates)
    _increment_media_count(album_id)


def _process_image(
    file_bytes: bytes, content_type: str
) -> tuple[bytes, int, int, dict]:
    """Resize image to THUMBNAIL_WIDTH and extract EXIF. Returns (jpeg_bytes, width, height, exif)."""
    try:
        if content_type in ("image/heic", "image/heif"):
            import pillow_heif

            pillow_heif.register_heif_opener()

        from PIL import Image

        img = Image.open(io.BytesIO(file_bytes))
        orig_width, orig_height = img.size
        exif = _extract_exif(img)

        img = img.convert("RGB")
        new_height = int(orig_height * THUMBNAIL_WIDTH / orig_width)
        thumbnail = img.resize((THUMBNAIL_WIDTH, new_height), Image.LANCZOS)

        buf = io.BytesIO()
        thumbnail.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), orig_width, orig_height, exif

    except (InvalidFileFormatError, CorruptedFileError):
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "cannot identify image file" in msg or "decompression" in msg:
            raise CorruptedFileError(str(exc)) from exc
        raise


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
    import json

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
        # Use the first result's formatted_address as a concise place name
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
