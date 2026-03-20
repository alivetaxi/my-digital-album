"""Media route handlers — nested under /albums/{album_id}/media."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from google.cloud import firestore
from pydantic import BaseModel

from shared.access import can_read_album
from shared.auth import get_uid, require_auth
from shared.db import get_col, get_db
from shared.errors import error_response
from shared.storage import generate_read_url, generate_upload_url, get_storage_client

router = APIRouter(prefix="/albums", tags=["media"])

MAX_FILE_SIZE = 30 * 1024 * 1024  # 30 MB
MAX_BATCH = 50

MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
}


class UploadItem(BaseModel):
    sha256: str
    mimeType: str
    filename: str
    size: int


class UpdateMediaBody(BaseModel):
    description: str | None = None


def _serialize_media(doc_id: str, data: dict) -> dict:
    out = {**data, "id": doc_id}
    for field in ("createdAt", "updatedAt", "takenAt"):
        v = out.get(field)
        if v is not None and hasattr(v, "isoformat"):
            out[field] = v.isoformat()
    return out


@router.get("/{album_id}/media")
def list_media(
    album_id: str,
    limit: int = Query(default=30, le=100),
    after: str | None = Query(default=None),
    uid: str | None = Depends(get_uid),
):
    db = get_db()
    album_doc = db.collection(get_col("albums")).document(album_id).get()

    if not album_doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    allowed, err = can_read_album(album_doc.to_dict(), uid, db)
    if not allowed:
        return error_response(err)

    media_ref = db.collection(get_col("albums")).document(album_id).collection("media")
    query = media_ref.order_by("createdAt", direction=firestore.Query.DESCENDING)

    if after:
        cursor_doc = media_ref.document(after).get()
        if cursor_doc.exists:
            query = query.start_after(cursor_doc)

    # Fetch one extra to detect whether a next page exists
    docs = list(query.limit(limit + 1).stream())
    has_more = len(docs) > limit
    page = docs[:limit]

    return {
        "items": [_serialize_media(d.id, d.to_dict()) for d in page],
        "nextCursor": page[-1].id if has_more and page else None,
    }


@router.post("/{album_id}/media/upload-url", status_code=200)
def request_upload_url(
    album_id: str,
    items: list[UploadItem],
    uid: str = Depends(require_auth),
):
    db = get_db()
    album_doc = db.collection(get_col("albums")).document(album_id).get()

    if not album_doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    allowed, err = can_read_album(album_doc.to_dict(), uid, db)
    if not allowed:
        return error_response(err or "PERMISSION_DENIED")

    bucket = os.environ.get("MEDIA_BUCKET", "")
    now = datetime.now(timezone.utc)
    result: dict[str, str] = {}

    for item in items[:MAX_BATCH]:
        if item.size > MAX_FILE_SIZE:
            continue  # oversized — client-side validation is primary guard

        media_id = item.sha256
        ext = MIME_TO_EXT.get(item.mimeType, "bin")
        storage_path = f"media/{uid}/{album_id}/{media_id}/original.{ext}"

        (
            db.collection(get_col("albums"))
            .document(album_id)
            .collection("media")
            .document(media_id)
            .set(
                {
                    "id": media_id,
                    "type": "photo" if item.mimeType.startswith("image/") else "video",
                    "storagePath": storage_path,
                    "thumbnailPath": None,
                    "uploaderId": uid,
                    "description": None,
                    "width": None,
                    "height": None,
                    "duration": None,
                    "takenAt": None,
                    "takenPlace": None,
                    "thumbnailStatus": "pending",
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
        )

        result[media_id] = generate_upload_url(bucket, storage_path, item.mimeType)

    return result


@router.get("/{album_id}/media/{media_id}/original-url")
def get_original_url(
    album_id: str,
    media_id: str,
    uid: str | None = Depends(get_uid),
):
    db = get_db()
    album_doc = db.collection(get_col("albums")).document(album_id).get()

    if not album_doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    allowed, err = can_read_album(album_doc.to_dict(), uid, db)
    if not allowed:
        return error_response(err)

    media_doc = (
        db.collection(get_col("albums"))
        .document(album_id)
        .collection("media")
        .document(media_id)
        .get()
    )
    if not media_doc.exists:
        return error_response("MEDIA_NOT_FOUND")

    storage_path = media_doc.to_dict().get("storagePath", "")
    bucket_name = os.environ.get("MEDIA_BUCKET", "")
    url = generate_read_url(bucket_name, storage_path)
    return {"url": url}


@router.patch("/{album_id}/media/{media_id}")
def update_media(
    album_id: str,
    media_id: str,
    body: UpdateMediaBody,
    uid: str = Depends(require_auth),
):
    db = get_db()
    album_doc = db.collection(get_col("albums")).document(album_id).get()

    if not album_doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    media_ref = (
        db.collection(get_col("albums")).document(album_id).collection("media").document(media_id)
    )
    media_doc = media_ref.get()

    if not media_doc.exists:
        return error_response("MEDIA_NOT_FOUND")

    media = media_doc.to_dict()
    album = album_doc.to_dict()

    if media.get("uploaderId") != uid and album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    updates: dict = {"updatedAt": datetime.now(timezone.utc)}
    if body.description is not None:
        updates["description"] = body.description

    media_ref.update(updates)
    return _serialize_media(media_id, {**media, **updates})


@router.delete("/{album_id}/media/{media_id}")
def delete_media(
    album_id: str,
    media_id: str,
    uid: str = Depends(require_auth),
):
    db = get_db()
    album_ref = db.collection(get_col("albums")).document(album_id)
    album_doc = album_ref.get()

    if not album_doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    media_ref = album_ref.collection("media").document(media_id)
    media_doc = media_ref.get()

    if not media_doc.exists:
        return error_response("MEDIA_NOT_FOUND")

    media = media_doc.to_dict()
    album = album_doc.to_dict()

    if media.get("uploaderId") != uid and album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    if album.get("coverMediaId") == media_id:
        return error_response("MEDIA_IS_COVER")

    # Delete GCS files (best-effort; don't fail the request if GCS errors)
    bucket_name = os.environ.get("MEDIA_BUCKET", "")
    if bucket_name:
        try:
            gcs = get_storage_client()
            bucket = gcs.bucket(bucket_name)
            for path in filter(None, [media.get("storagePath"), media.get("thumbnailPath")]):
                bucket.blob(path).delete()
        except Exception:
            pass  # logged by Cloud Run; Firestore delete still proceeds

    media_ref.delete()
    album_ref.update(
        {
            "mediaCount": firestore.Increment(-1),
            "updatedAt": datetime.now(timezone.utc),
        }
    )
    return {"deleted": True}
