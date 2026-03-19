"""Thumbnail generation Cloud Function (Storage trigger via Eventarc)."""
from __future__ import annotations

import io
import logging
import os
import re
from datetime import datetime, timezone

import functions_framework
from cloudevents.http import CloudEvent

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
    """Extract takenAt from EXIF DateTimeOriginal; returns {} on any failure."""
    try:
        import piexif

        raw = img.info.get("exif")
        if not raw:
            return {}

        exif = piexif.load(raw)
        dt_bytes = exif.get("Exif", {}).get(piexif.ExifIFD.DateTimeOriginal)
        if not dt_bytes:
            return {}

        dt_str = dt_bytes.decode("utf-8", errors="ignore").rstrip("\x00")
        taken_at = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        )
        return {"takenAt": taken_at}
    except Exception as exc:
        logger.debug("EXIF extraction skipped: %s", exc)
        return {}


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
