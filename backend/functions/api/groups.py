"""Groups route handlers."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from google.cloud import firestore
from pydantic import BaseModel

from shared.auth import require_auth
from shared.db import get_col, get_db
from shared.errors import error_response

router = APIRouter(tags=["groups"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class CreateGroupBody(BaseModel):
    name: str


class JoinGroupBody(BaseModel):
    inviteToken: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize_group(group_id: str, data: dict) -> dict:
    expires_at = data.get("inviteTokenExpiresAt")
    created_at = data.get("createdAt")
    return {
        "id": group_id,
        "name": data.get("name", ""),
        "ownerId": data.get("ownerId", ""),
        "memberIds": data.get("memberIds", []),
        "inviteToken": data.get("inviteToken", ""),
        "inviteTokenExpiresAt": expires_at.isoformat() if expires_at else None,
        "createdAt": created_at.isoformat() if created_at else None,
    }


def _new_token() -> tuple[str, datetime]:
    """Return a fresh (token, expires_at) pair valid for 24 hours."""
    token = secrets.token_urlsafe(16)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    return token, expires_at


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/users/me/groups")
def list_my_groups(uid: str = Depends(require_auth)):
    db = get_db()
    groups = (
        db.collection(get_col("groups"))
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    return [_serialize_group(g.id, g.to_dict()) for g in groups]


@router.post("/groups", status_code=201)
def create_group(body: CreateGroupBody, uid: str = Depends(require_auth)):
    db = get_db()
    now = datetime.now(timezone.utc)
    token, expires_at = _new_token()

    group_ref = db.collection(get_col("groups")).document()
    group_id = group_ref.id
    group_data = {
        "id": group_id,
        "name": body.name.strip(),
        "ownerId": uid,
        "memberIds": [uid],
        "inviteToken": token,
        "inviteTokenExpiresAt": expires_at,
        "createdAt": now,
    }
    group_ref.set(group_data)

    # Track group membership on the user document
    db.collection(get_col("users")).document(uid).set(
        {"groupIds": firestore.ArrayUnion([group_id])},
        merge=True,
    )

    return _serialize_group(group_id, group_data)


@router.get("/groups/{group_id}")
def get_group(group_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    snap = db.collection(get_col("groups")).document(group_id).get()
    if not snap.exists:
        return error_response("GROUP_NOT_FOUND")
    data = snap.to_dict()
    if uid not in data.get("memberIds", []):
        return error_response("PERMISSION_DENIED")
    return _serialize_group(group_id, data)


@router.get("/groups/{group_id}/members")
def list_members(group_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    snap = db.collection(get_col("groups")).document(group_id).get()
    if not snap.exists:
        return error_response("GROUP_NOT_FOUND")
    data = snap.to_dict()
    if uid not in data.get("memberIds", []):
        return error_response("PERMISSION_DENIED")

    members = []
    for member_uid in data.get("memberIds", []):
        user_snap = db.collection(get_col("users")).document(member_uid).get()
        if user_snap.exists:
            u = user_snap.to_dict()
            members.append(
                {
                    "uid": member_uid,
                    "displayName": u.get("displayName"),
                    "email": u.get("email"),
                    "photoURL": u.get("photoURL"),
                }
            )
        else:
            members.append(
                {
                    "uid": member_uid,
                    "displayName": None,
                    "email": None,
                    "photoURL": None,
                }
            )
    return members


@router.post("/groups/join")
def join_group(body: JoinGroupBody, uid: str = Depends(require_auth)):
    db = get_db()

    results = list(
        db.collection(get_col("groups"))
        .where("inviteToken", "==", body.inviteToken)
        .limit(1)
        .stream()
    )
    if not results:
        return error_response("INVITE_TOKEN_INVALID")

    snap = results[0]
    data = snap.to_dict()
    group_id = snap.id

    expires_at = data.get("inviteTokenExpiresAt")
    if expires_at and expires_at < datetime.now(timezone.utc):
        return error_response("INVITE_TOKEN_EXPIRED")

    if uid in data.get("memberIds", []):
        return error_response("ALREADY_IN_GROUP")

    db.collection(get_col("groups")).document(group_id).update(
        {"memberIds": firestore.ArrayUnion([uid])}
    )
    db.collection(get_col("users")).document(uid).set(
        {"groupIds": firestore.ArrayUnion([group_id])},
        merge=True,
    )

    return _serialize_group(
        group_id, {**data, "memberIds": data.get("memberIds", []) + [uid]}
    )


@router.post("/groups/{group_id}/leave")
def leave_group(group_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    snap = db.collection(get_col("groups")).document(group_id).get()
    if not snap.exists:
        return error_response("GROUP_NOT_FOUND")
    data = snap.to_dict()
    if uid not in data.get("memberIds", []):
        return error_response("PERMISSION_DENIED")

    db.collection(get_col("groups")).document(group_id).update(
        {"memberIds": firestore.ArrayRemove([uid])}
    )
    db.collection(get_col("users")).document(uid).set(
        {"groupIds": firestore.ArrayRemove([group_id])},
        merge=True,
    )
    return {"ok": True}


@router.post("/groups/{group_id}/regenerate-invite")
def regenerate_invite(group_id: str, uid: str = Depends(require_auth)):
    db = get_db()
    snap = db.collection(get_col("groups")).document(group_id).get()
    if not snap.exists:
        return error_response("GROUP_NOT_FOUND")
    data = snap.to_dict()
    if data.get("ownerId") != uid:
        return error_response("PERMISSION_DENIED")

    token, expires_at = _new_token()
    db.collection(get_col("groups")).document(group_id).update(
        {
            "inviteToken": token,
            "inviteTokenExpiresAt": expires_at,
        }
    )
    return {
        "inviteToken": token,
        "inviteTokenExpiresAt": expires_at.isoformat(),
    }
