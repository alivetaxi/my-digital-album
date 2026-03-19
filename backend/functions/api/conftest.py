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
    group_id: str | None = None,
) -> MagicMock:
    return make_doc(
        album_id,
        {
            "id": album_id,
            "title": "Test Album",
            "ownerId": owner,
            "ownerType": "user",
            "visibility": visibility,
            "mediaCount": media_count,
            "coverMediaId": cover_media_id,
            "coverThumbnailPath": None,
            "groupId": group_id,
            "createdAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
            "updatedAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
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


def build_db(
    *,
    album_doc: MagicMock | None = None,
    media_doc: MagicMock | None = None,
    media_list: list[MagicMock] | None = None,
    user_doc: MagicMock | None = None,
    group_doc: MagicMock | None = None,
    album_list: list[MagicMock] | None = None,
) -> MagicMock:
    """
    Return a configured MagicMock Firestore client.

    The mock resolves the most common call chains used by the API handlers.
    Tests that need finer control can override specific attributes after calling
    this function.
    """
    db = MagicMock()

    # collection("albums")
    albums_col = MagicMock()
    # collection("users")
    users_col = MagicMock()
    # collection("groups")
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

    # list queries on media subcollection
    media_query = MagicMock()
    media_col.order_by.return_value = media_query
    media_query.start_after.return_value = media_query
    media_query.limit.return_value = media_query
    media_query.stream.return_value = iter(media_list or [])

    # list queries on albums collection
    albums_query = MagicMock()
    albums_col.where.return_value = albums_query
    albums_query.where.return_value = albums_query
    albums_query.order_by.return_value = albums_query
    # Use side_effect so each call gets a fresh iterator (return_value would be exhausted after first use)
    albums_query.stream.side_effect = lambda: iter(album_list or [])

    # --- users ---
    user_ref = MagicMock()
    users_col.document.return_value = user_ref
    user_ref.get.return_value = user_doc or make_doc(TEST_UID, {"groupIds": []})

    # --- groups ---
    group_ref = MagicMock()
    groups_col.document.return_value = group_ref
    group_ref.get.return_value = group_doc or make_doc("group-1", None)

    return db
