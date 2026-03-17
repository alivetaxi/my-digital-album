"""Media route handlers — nested under /albums/{album_id}/media."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from shared.auth import get_uid, require_auth
from shared.errors import error_response

# Mounted at /albums in main.py so routes here complete the full path
router = APIRouter(prefix="/albums", tags=["media"])


@router.get("/{album_id}/media")
def list_media(
    album_id: str,
    limit: int = Query(default=30, le=100),
    after: str | None = Query(default=None),
    uid: str | None = Depends(get_uid),
):
    # TODO Phase 2: query Firestore with cursor pagination
    return {"items": [], "nextCursor": None}


@router.post("/{album_id}/media/upload-url", status_code=200)
def request_upload_url(album_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 2: generate signed GCS upload URL
    return []


@router.patch("/{album_id}/media/{media_id}")
def update_media(album_id: str, media_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 2
    return error_response("MEDIA_NOT_FOUND")


@router.delete("/{album_id}/media/{media_id}")
def delete_media(album_id: str, media_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 2
    return error_response("MEDIA_NOT_FOUND")
