"""Albums route handlers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from google.cloud import firestore
from pydantic import BaseModel

from shared.access import can_read_album
from shared.auth import get_uid, require_auth
from shared.db import get_col, get_db
from shared.errors import error_response

router = APIRouter(prefix="/albums", tags=["albums"])


class CreateAlbumBody(BaseModel):
    title: str
    visibility: Literal["public", "group", "private"] = "private"
    ownerType: Literal["user", "group"] = "user"
    groupId: str | None = None


class UpdateAlbumBody(BaseModel):
    title: str | None = None
    coverMediaId: str | None = None
    visibility: Literal["public", "group", "private"] | None = None
    groupId: str | None = None


def _serialize(data: dict) -> dict:
    """Convert Firestore Timestamp fields to ISO strings and compute derived URLs."""
    out = dict(data)
    for field in ("createdAt", "updatedAt"):
        v = out.get(field)
        if v is not None and hasattr(v, "isoformat"):
            out[field] = v.isoformat()
    thumb_path = out.get("coverThumbnailPath")
    out["coverThumbnailUrl"] = f"/api/thumbnail/{thumb_path}" if thumb_path else None
    return out


@router.get("")
def list_albums(uid: str | None = Depends(get_uid)):
    db = get_db()

    mine: list[dict] = []
    shared: list[dict] = []
    public: list[dict] = []

    if uid:
        mine_docs = (
            db.collection(get_col("albums"))
            .where("ownerId", "==", uid)
            .order_by("updatedAt", direction=firestore.Query.DESCENDING)
            .stream()
        )
        mine = [_serialize({**d.to_dict(), "id": d.id}) for d in mine_docs]

        user_doc = db.collection(get_col("users")).document(uid).get()
        group_ids: list[str] = (
            user_doc.to_dict().get("groupIds", []) if user_doc.exists else []
        )
        if group_ids:
            shared_docs = (
                db.collection(get_col("albums"))
                .where("visibility", "==", "group")
                .where("groupId", "in", group_ids)
                .order_by("updatedAt", direction=firestore.Query.DESCENDING)
                .stream()
            )
            shared = [
                _serialize({**d.to_dict(), "id": d.id})
                for d in shared_docs
                if d.to_dict().get("ownerId") != uid
            ]

    public_docs = (
        db.collection(get_col("albums"))
        .where("visibility", "==", "public")
        .order_by("updatedAt", direction=firestore.Query.DESCENDING)
        .stream()
    )
    public = [
        _serialize({**d.to_dict(), "id": d.id})
        for d in public_docs
        if d.to_dict().get("ownerId") != uid
    ]

    return {"mine": mine, "shared": shared, "public": public}


@router.post("", status_code=201)
def create_album(body: CreateAlbumBody, uid: str = Depends(require_auth)):
    db = get_db()
    now = datetime.now(timezone.utc)
    album_id = str(uuid.uuid4())

    data = {
        "id": album_id,
        "title": body.title,
        "coverMediaId": None,
        "ownerId": uid,
        "ownerType": body.ownerType,
        "groupId": body.groupId,
        "visibility": body.visibility,
        "mediaCount": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    db.collection(get_col("albums")).document(album_id).set(data)
    return _serialize(data)


@router.get("/{album_id}")
def get_album(album_id: str, uid: str | None = Depends(get_uid)):
    db = get_db()
    doc = db.collection(get_col("albums")).document(album_id).get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    allowed, err = can_read_album(album, uid, db)
    if not allowed:
        return error_response(err)

    return _serialize({**album, "id": doc.id})


@router.patch("/{album_id}")
def update_album(
    album_id: str, body: UpdateAlbumBody, uid: str = Depends(require_auth)
):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    if album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    updates: dict = {"updatedAt": datetime.now(timezone.utc)}
    if body.title is not None:
        updates["title"] = body.title
    if body.coverMediaId is not None:
        updates["coverMediaId"] = body.coverMediaId
        media_doc = ref.collection("media").document(body.coverMediaId).get()
        thumb_path = media_doc.to_dict().get("thumbnailPath") if media_doc.exists else None
        updates["coverThumbnailPath"] = thumb_path
    if body.visibility is not None:
        updates["visibility"] = body.visibility
    if body.groupId is not None:
        updates["groupId"] = body.groupId

    ref.update(updates)
    return _serialize({**album, **updates, "id": album_id})


@router.delete("/{album_id}")
def delete_album(album_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    if album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    media_count = album.get("mediaCount", 0)
    if media_count > 0:
        return error_response(
            "ALBUM_NOT_EMPTY",
            f"This album still has {media_count} item(s). Remove all media before deleting.",
        )

    ref.delete()
    return {"deleted": True}
