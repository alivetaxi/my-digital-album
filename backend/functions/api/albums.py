"""Albums route handlers."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from google.cloud import firestore
from google.cloud.firestore_v1.transforms import ArrayUnion, ArrayRemove
from pydantic import BaseModel

from shared.access import can_read_album, get_member_permission
from shared.auth import get_uid, require_auth
from shared.db import get_col, get_db
from shared.errors import error_response

router = APIRouter(prefix="/albums", tags=["albums"])

INVITE_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateAlbumBody(BaseModel):
    title: str
    visibility: Literal["public", "private"] = "private"


class UpdateAlbumBody(BaseModel):
    title: str | None = None
    coverMediaId: str | None = None
    visibility: Literal["public", "private"] | None = None


class AddMemberBody(BaseModel):
    email: str
    permission: Literal["read", "write"]


class UpdateMemberBody(BaseModel):
    permission: Literal["read", "write"]


class AcceptInviteBody(BaseModel):
    token: str


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _serialize(data: dict, uid: str | None = None) -> dict:
    """Convert Firestore Timestamps to ISO strings and compute derived fields.

    Strips internal-only fields (members, memberIds) from the response and
    optionally adds myPermission for the calling user.
    """
    out = dict(data)
    out.pop("members", None)
    out.pop("memberIds", None)
    for field in ("createdAt", "updatedAt"):
        v = out.get(field)
        if v is not None and hasattr(v, "isoformat"):
            out[field] = v.isoformat()
    thumb_path = out.get("coverThumbnailPath")
    out["coverThumbnailUrl"] = f"/api/thumbnail/{thumb_path}" if thumb_path else None
    if uid:
        perm = get_member_permission(data, uid)
        if perm:
            out["myPermission"] = perm
    return out


def _serialize_member(email: str, entry: dict, user_info: dict | None = None) -> dict:
    """Serialize a member entry for the /members list endpoint."""
    added_at = entry.get("addedAt")
    return {
        "email": email,
        "userId": entry.get("userId"),
        "displayName": user_info.get("displayName") if user_info else None,
        "photoURL": user_info.get("photoURL") if user_info else None,
        "permission": entry.get("permission"),
        # Only expose inviteToken when the user hasn't registered yet
        "inviteToken": entry.get("inviteToken") if not entry.get("userId") else None,
        "addedAt": added_at.isoformat() if hasattr(added_at, "isoformat") else added_at,
    }


# ---------------------------------------------------------------------------
# Album CRUD
# ---------------------------------------------------------------------------

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
        mine = [_serialize({**d.to_dict(), "id": d.id}, uid) for d in mine_docs]

        shared_docs = (
            db.collection(get_col("albums"))
            .where("memberIds", "array_contains", uid)
            .order_by("updatedAt", direction=firestore.Query.DESCENDING)
            .stream()
        )
        shared = [
            _serialize({**d.to_dict(), "id": d.id}, uid)
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
        _serialize({**d.to_dict(), "id": d.id}, uid)
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
        "visibility": body.visibility,
        "mediaCount": 0,
        "members": {},
        "memberIds": [],
        "createdAt": now,
        "updatedAt": now,
    }
    db.collection(get_col("albums")).document(album_id).set(data)
    return _serialize(data, uid)


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

    return _serialize({**album, "id": doc.id}, uid)


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

    ref.update(updates)
    return _serialize({**album, **updates, "id": album_id}, uid)


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


# ---------------------------------------------------------------------------
# Member management
# ---------------------------------------------------------------------------

@router.get("/{album_id}/members")
def list_members(album_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    doc = db.collection(get_col("albums")).document(album_id).get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    # Any member (including non-owners) may view the member list.
    if album.get("ownerId") != uid and not get_member_permission(album, uid):
        return error_response("PERMISSION_DENIED")

    members = album.get("members", {})
    result = []
    for email, entry in members.items():
        user_info = None
        if entry.get("userId"):
            user_doc = db.collection(get_col("users")).document(entry["userId"]).get()
            if user_doc.exists:
                user_info = user_doc.to_dict()
        result.append(_serialize_member(email, entry, user_info))
    return result


@router.post("/{album_id}/members", status_code=201)
def add_member(album_id: str, body: AddMemberBody, uid: str = Depends(require_auth)):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    if album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    email = body.email.lower().strip()
    members = album.get("members", {})

    if email in members:
        return error_response("ALREADY_MEMBER")

    now = datetime.now(timezone.utc)

    # Look up user by email in the users collection
    user_docs = list(
        db.collection(get_col("users"))
        .where("email", "==", email)
        .limit(1)
        .stream()
    )

    if user_docs:
        # User exists — grant access directly (no invite needed)
        user_doc = user_docs[0]
        user_uid = user_doc.id
        user_info = user_doc.to_dict()
        entry: dict = {
            "userId": user_uid,
            "permission": body.permission,
            "inviteToken": None,
            "inviteExpiresAt": None,
            "addedAt": now,
        }
        new_members = {**members, email: entry}
        ref.update({"members": new_members, "memberIds": ArrayUnion([user_uid]), "updatedAt": now})
        return _serialize_member(email, entry, user_info)
    else:
        # User not registered — generate a one-time invite token
        token = secrets.token_urlsafe(32)
        expires_at = now + timedelta(hours=INVITE_TTL_HOURS)
        entry = {
            "userId": None,
            "permission": body.permission,
            "inviteToken": token,
            "inviteExpiresAt": expires_at,
            "addedAt": now,
        }
        new_members = {**members, email: entry}
        ref.update({"members": new_members, "updatedAt": now})
        return _serialize_member(email, entry)


@router.patch("/{album_id}/members/{email}")
def update_member(
    album_id: str,
    email: str,
    body: UpdateMemberBody,
    uid: str = Depends(require_auth),
):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    if album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    email = email.lower()
    members = album.get("members", {})
    if email not in members:
        return error_response("MEMBER_NOT_FOUND")

    now = datetime.now(timezone.utc)
    new_members = {**members, email: {**members[email], "permission": body.permission}}
    ref.update({"members": new_members, "updatedAt": now})

    entry = {**members[email], "permission": body.permission}
    user_info = None
    if entry.get("userId"):
        user_doc = db.collection(get_col("users")).document(entry["userId"]).get()
        if user_doc.exists:
            user_info = user_doc.to_dict()
    return _serialize_member(email, entry, user_info)


@router.delete("/{album_id}/members/{email}")
def delete_member(
    album_id: str,
    email: str,
    uid: str = Depends(require_auth),
):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    if album.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    email = email.lower()
    members = album.get("members", {})
    if email not in members:
        return error_response("MEMBER_NOT_FOUND")

    entry = members[email]
    new_members = {k: v for k, v in members.items() if k != email}
    updates: dict = {"members": new_members, "updatedAt": datetime.now(timezone.utc)}
    if entry.get("userId"):
        updates["memberIds"] = ArrayRemove([entry["userId"]])
    ref.update(updates)
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Invite acceptance
# ---------------------------------------------------------------------------

@router.post("/{album_id}/accept-invite")
def accept_invite(
    album_id: str,
    body: AcceptInviteBody,
    uid: str = Depends(require_auth),
):
    db = get_db()
    ref = db.collection(get_col("albums")).document(album_id)
    doc = ref.get()

    if not doc.exists:
        return error_response("ALBUM_NOT_FOUND")

    album = doc.to_dict()
    members = album.get("members", {})

    # Find the member entry whose inviteToken matches
    found_email: str | None = None
    for email, entry in members.items():
        if entry.get("inviteToken") == body.token:
            found_email = email
            break

    if not found_email:
        return error_response("INVITE_TOKEN_INVALID")

    entry = members[found_email]
    expires_at = entry.get("inviteExpiresAt")
    if expires_at:
        if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            return error_response("INVITE_TOKEN_EXPIRED")

    now = datetime.now(timezone.utc)
    new_members = {
        **members,
        found_email: {**entry, "userId": uid, "inviteToken": None, "inviteExpiresAt": None},
    }
    ref.update({"members": new_members, "memberIds": ArrayUnion([uid]), "updatedAt": now})

    # Return updated album so the frontend can navigate in
    updated_members = {
        **members,
        found_email: {**entry, "userId": uid, "inviteToken": None, "inviteExpiresAt": None},
    }
    updated_album = {
        **album,
        "id": doc.id,
        "members": updated_members,
        "memberIds": list({*album.get("memberIds", []), uid}),
    }
    return _serialize(updated_album, uid)
