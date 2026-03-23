"""Shared test fixtures for the API."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("ENVIRONMENT", "dev")

from main import app

from shared.auth import get_uid, require_auth

TEST_UID = "user-111"
OTHER_UID = "user-222"
ALBUM_ID = "album-abc"
MEDIA_ID = "mediahash123"


# ---------------------------------------------------------------------------
# Auth dependency overrides
# ---------------------------------------------------------------------------


def _auth_as(uid: str):
    def _override():
        return uid

    return _override


@pytest.fixture
def client():
    """Authenticated test client — resolves to TEST_UID."""
    app.dependency_overrides[require_auth] = _auth_as(TEST_UID)
    app.dependency_overrides[get_uid] = _auth_as(TEST_UID)
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def other_client():
    """Authenticated client for a different user (OTHER_UID)."""
    app.dependency_overrides[require_auth] = _auth_as(OTHER_UID)
    app.dependency_overrides[get_uid] = _auth_as(OTHER_UID)
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    """Unauthenticated client — get_uid returns None, require_auth raises 401."""
    app.dependency_overrides[get_uid] = lambda: None
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Firestore mock helpers
# ---------------------------------------------------------------------------


def make_doc(doc_id: str, data: dict | None) -> MagicMock:
    """Return a mock Firestore DocumentSnapshot."""
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = data is not None
    doc.to_dict.return_value = dict(data) if data else {}
    return doc


def make_album(
    album_id: str = ALBUM_ID,
    owner: str = TEST_UID,
    visibility: str = "private",
    media_count: int = 0,
    cover_media_id: str | None = None,
    members: dict | None = None,
    member_ids: list | None = None,
) -> MagicMock:
    return make_doc(
        album_id,
        {
            "id": album_id,
            "title": "Test Album",
            "ownerId": owner,
            "visibility": visibility,
            "mediaCount": media_count,
            "coverMediaId": cover_media_id,
            "coverThumbnailPath": None,
            "members": members or {},
            "memberIds": member_ids or [],
            "createdAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "updatedAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
        },
    )


GROUP_ID = "group-1"


def make_group(
    group_id: str = GROUP_ID,
    owner: str = TEST_UID,
    name: str = "Test Group",
    member_ids: list | None = None,
    invite_token: str = "valid-token-abc",
    expired: bool = False,
) -> MagicMock:
    from datetime import timedelta

    if member_ids is None:
        member_ids = [owner]
    expires_at = datetime.now(timezone.utc) + timedelta(hours=-1 if expired else 48)
    return make_doc(
        group_id,
        {
            "id": group_id,
            "name": name,
            "ownerId": owner,
            "memberIds": member_ids,
            "inviteToken": invite_token,
            "inviteTokenExpiresAt": expires_at,
            "createdAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
        },
    )


def make_user(
    uid: str = TEST_UID,
    display_name: str = "Test User",
    email: str = "test@example.com",
) -> MagicMock:
    return make_doc(
        uid,
        {
            "uid": uid,
            "displayName": display_name,
            "email": email,
            "photoURL": f"https://avatar.example.com/{uid}",
        },
    )


def make_media(
    media_id: str = MEDIA_ID,
    uploader: str = TEST_UID,
    thumbnail_status: str = "ready",
) -> MagicMock:
    return make_doc(
        media_id,
        {
            "id": media_id,
            "type": "photo",
            "storagePath": f"media/{uploader}/{ALBUM_ID}/{media_id}/original.jpg",
            "thumbnailPath": f"media/{uploader}/{ALBUM_ID}/{media_id}/thumbnail.jpg",
            "uploaderId": uploader,
            "description": None,
            "width": 1920,
            "height": 1080,
            "duration": None,
            "takenAt": None,
            "takenPlace": None,
            "thumbnailStatus": thumbnail_status,
            "createdAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "updatedAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
        },
    )


def _make_albums_query(album_list: list) -> MagicMock:
    """Return a mock Firestore query that streams album_list."""
    q = MagicMock()
    q.where.return_value = q
    q.order_by.return_value = q
    q.limit.return_value = q
    q.stream.side_effect = lambda: iter(album_list)
    return q


def build_db(
    *,
    album_doc: MagicMock | None = None,
    media_doc: MagicMock | None = None,
    media_list: list[MagicMock] | None = None,
    user_doc: MagicMock | None = None,
    group_doc: MagicMock | None = None,
    # Fallback list for all album collection queries
    album_list: list[MagicMock] | None = None,
    # Per-query overrides: used by list_albums to distinguish mine / shared / public
    mine_album_list: list[MagicMock] | None = None,
    member_album_list: list[MagicMock] | None = None,
    public_album_list: list[MagicMock] | None = None,
    group_list: list[MagicMock] | None = None,
    group_query_list: list[MagicMock] | None = None,
    # Per-user lookups keyed by uid (for list_members)
    user_docs_by_uid: dict[str, MagicMock] | None = None,
    # Results for the "find user by email" query in add_member
    user_by_email_list: list[MagicMock] | None = None,
) -> MagicMock:
    """
    Return a configured MagicMock Firestore client.

    The mock resolves the most common call chains used by the API handlers.
    Tests that need finer control can override specific attributes after calling
    this function.
    """
    db = MagicMock()

    albums_col = MagicMock()
    users_col = MagicMock()
    groups_col = MagicMock()

    env = os.environ.get("ENVIRONMENT", "dev")

    def _collection(name):
        if name == f"albums-{env}":
            return albums_col
        if name == f"users-{env}":
            return users_col
        if name == f"groups-{env}":
            return groups_col
        return MagicMock()

    db.collection.side_effect = _collection

    # --- albums ---
    album_ref = MagicMock()
    albums_col.document.return_value = album_ref
    album_ref.get.return_value = album_doc or make_doc(ALBUM_ID, None)
    album_ref.set.return_value = None
    album_ref.update.return_value = None
    album_ref.delete.return_value = None

    # media subcollection
    media_col = MagicMock()
    album_ref.collection.return_value = media_col

    media_ref = MagicMock()
    media_col.document.return_value = media_ref
    media_ref.get.return_value = media_doc or make_doc(MEDIA_ID, None)
    media_ref.set.return_value = None
    media_ref.update.return_value = None
    media_ref.delete.return_value = None

    media_query = MagicMock()
    media_col.order_by.return_value = media_query
    media_query.start_after.return_value = media_query
    media_query.limit.return_value = media_query
    media_query.stream.return_value = iter(media_list or [])

    # Album collection queries — dispatch per first where() field when specific
    # lists are provided; fall back to album_list otherwise.
    def _albums_where(field, *args):
        if field == "ownerId" and mine_album_list is not None:
            return _make_albums_query(mine_album_list)
        if field == "memberIds" and member_album_list is not None:
            return _make_albums_query(member_album_list)
        if field == "visibility" and public_album_list is not None:
            return _make_albums_query(public_album_list)
        return _make_albums_query(album_list or [])

    albums_col.where.side_effect = _albums_where

    # --- users ---
    def _users_document(uid):
        if user_docs_by_uid and uid in user_docs_by_uid:
            ref = MagicMock()
            ref.get.return_value = user_docs_by_uid[uid]
            return ref
        r = MagicMock()
        r.get.return_value = user_doc or make_doc(TEST_UID, {"groupIds": []})
        return r

    users_col.document.side_effect = _users_document

    # "find user by email" query (used by add_member)
    users_query = MagicMock()
    users_col.where.return_value = users_query
    users_query.where.return_value = users_query
    users_query.limit.return_value = users_query
    users_query.stream.side_effect = lambda: iter(user_by_email_list or [])

    # --- groups ---
    group_ref = MagicMock()
    groups_col.document.return_value = group_ref
    group_ref.get.return_value = group_doc or make_doc("group-1", None)
    group_ref.set.return_value = None
    group_ref.update.return_value = None

    groups_query = MagicMock()
    groups_col.where.return_value = groups_query
    groups_query.where.return_value = groups_query
    groups_query.limit.return_value = groups_query
    groups_query.stream.side_effect = lambda: iter(
        group_query_list if group_query_list is not None else (group_list or [])
    )

    return db
