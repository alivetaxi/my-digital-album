"""Thumbnail generation Cloud Function (Storage trigger via Eventarc)."""
from __future__ import annotations

import logging
import re

import functions_framework
from cloudevents.http import CloudEvent

logger = logging.getLogger(__name__)

GCS_PATH_RE = re.compile(
    r"^media/(?P<uid>[^/]+)/(?P<album_id>[^/]+)/(?P<media_id>[^/]+)/original\.[^/]+$"
)


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
        _update_firestore(album_id, media_id, {"thumbnailStatus": "failed"})
        return
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
    """Main processing logic. Implemented in Phase 3."""
    # TODO Phase 2/3: implement thumbnail generation + metadata extraction
    logger.info(
        "Processing %s (type=%s) for album=%s media=%s",
        object_name,
        content_type,
        album_id,
        media_id,
    )


def _update_firestore(album_id: str, media_id: str, fields: dict) -> None:
    """Merge-write fields into the Firestore media document."""
    # TODO Phase 2: import and use Firestore client
    logger.info("Would update Firestore albums/%s/media/%s with %s", album_id, media_id, fields)
