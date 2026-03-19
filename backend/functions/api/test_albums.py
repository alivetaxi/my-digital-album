"""Tests for albums endpoints."""
from __future__ import annotations

import pytest

from conftest import (
    ALBUM_ID,
    MEDIA_ID,
    OTHER_UID,
    TEST_UID,
    build_db,
    make_album,
    make_doc,
    make_media,
)


# ---------------------------------------------------------------------------
# GET /api/albums
# ---------------------------------------------------------------------------

class TestListAlbums:
    def test_anonymous_returns_only_public(self, anon_client, mocker):
        pub = make_album(album_id="pub-1", owner=OTHER_UID, visibility="public")
        db = build_db(album_list=[pub])
        mocker.patch("albums.get_db", return_value=db)

        resp = anon_client.get("/api/albums")
        assert resp.status_code == 200
        data = resp.json()
        assert data["mine"] == []
        assert data["shared"] == []
        assert len(data["public"]) == 1
        assert data["public"][0]["id"] == "pub-1"

    def test_invalid_token_returns_only_public(self, anon_client, mocker):
        """A request with an invalid/expired token degrades to public-only results."""
        pub = make_album(album_id="pub-1", owner=OTHER_UID, visibility="public")
        db = build_db(album_list=[pub])
        mocker.patch("albums.get_db", return_value=db)

        # anon_client simulates get_uid returning None, which is exactly what
        # happens when verify_id_token raises (bad token, expired, wrong project).
        resp = anon_client.get("/api/albums", headers={"Authorization": "Bearer bad-token"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["mine"] == []
        assert data["shared"] == []
        assert len(data["public"]) == 1

    def test_authenticated_populates_mine(self, client, mocker):
        mine = make_album(album_id="mine-1", owner=TEST_UID, visibility="private")
        db = build_db(album_list=[mine])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["mine"]) == 1
        assert data["mine"][0]["id"] == "mine-1"

    def test_own_public_album_excluded_from_public_section(self, client, mocker):
        own_pub = make_album(album_id="own-pub", owner=TEST_UID, visibility="public")
        db = build_db(album_list=[own_pub])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        data = resp.json()
        # "mine" query returns it; "public" query should exclude it
        pub_ids = [a["id"] for a in data["public"]]
        assert "own-pub" not in pub_ids

    def test_shared_albums_returned_for_group_member(self, client, mocker):
        shared = make_album(
            album_id="shared-1",
            owner=OTHER_UID,
            visibility="group",
            group_id="group-1",
        )
        user_doc = make_doc(TEST_UID, {"groupIds": ["group-1"]})
        db = build_db(album_list=[shared], user_doc=user_doc)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        data = resp.json()
        assert len(data["shared"]) == 1
        assert data["shared"][0]["id"] == "shared-1"

    def test_shared_empty_when_no_groups(self, client, mocker):
        user_doc = make_doc(TEST_UID, {"groupIds": []})
        db = build_db(user_doc=user_doc)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        assert resp.json()["shared"] == []


# ---------------------------------------------------------------------------
# POST /api/albums
# ---------------------------------------------------------------------------

class TestCreateAlbum:
    def test_creates_album_and_returns_201(self, client, mocker):
        db = build_db()
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post("/api/albums", json={"title": "Vacation"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Vacation"
        assert data["ownerId"] == TEST_UID
        assert data["visibility"] == "private"
        assert data["mediaCount"] == 0
        assert "id" in data
        db.collection("albums-dev").document.return_value.set.assert_called_once()

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.post("/api/albums", json={"title": "X"})
        assert resp.status_code == 401

    def test_creates_group_album(self, client, mocker):
        db = build_db()
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post(
            "/api/albums",
            json={"title": "Group Album", "visibility": "group", "groupId": "g-1"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["visibility"] == "group"
        assert data["groupId"] == "g-1"


# ---------------------------------------------------------------------------
# GET /api/albums/{album_id}
# ---------------------------------------------------------------------------

class TestGetAlbum:
    def test_public_album_accessible_anonymously(self, anon_client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = anon_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200
        assert resp.json()["id"] == ALBUM_ID

    def test_private_album_accessible_by_owner(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200

    def test_private_album_hidden_from_others(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ALBUM_NOT_FOUND"

    def test_group_album_denied_for_non_member(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="group", group_id="g-1")
        group = make_doc("g-1", {"memberIds": [TEST_UID]})
        db = build_db(album_doc=album, group_doc=group)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "NOT_GROUP_MEMBER"

    def test_group_album_accessible_by_member(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="group", group_id="g-1")
        group = make_doc("g-1", {"memberIds": [TEST_UID, OTHER_UID]})
        db = build_db(album_doc=album, group_doc=group)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/albums/{album_id}
# ---------------------------------------------------------------------------

class TestUpdateAlbum:
    def test_owner_can_update_title(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(f"/api/albums/{ALBUM_ID}", json={"title": "New Title"})
        assert resp.status_code == 200
        assert resp.json()["title"] == "New Title"
        db.collection("albums-dev").document.return_value.update.assert_called_once()

    def test_setting_cover_stores_thumbnail_path(self, client, mocker):
        album = make_album(owner=TEST_UID)
        media = make_media()  # thumbnailPath = "media/user-111/album-abc/mediahash123/thumbnail.jpg"
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(f"/api/albums/{ALBUM_ID}", json={"coverMediaId": MEDIA_ID})
        assert resp.status_code == 200
        data = resp.json()
        assert data["coverMediaId"] == MEDIA_ID
        assert data["coverThumbnailUrl"] is not None
        assert "thumbnail.jpg" in data["coverThumbnailUrl"]

    def test_owner_can_change_visibility(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(f"/api/albums/{ALBUM_ID}", json={"visibility": "public"})
        assert resp.status_code == 200
        assert resp.json()["visibility"] == "public"

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.patch(f"/api/albums/{ALBUM_ID}", json={"title": "X"})
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "PERMISSION_DENIED"

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(f"/api/albums/{ALBUM_ID}", json={"title": "X"})
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.patch(f"/api/albums/{ALBUM_ID}", json={"title": "X"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /api/albums/{album_id}
# ---------------------------------------------------------------------------

class TestDeleteAlbum:
    def test_owner_can_delete_empty_album(self, client, mocker):
        album = make_album(owner=TEST_UID, media_count=0)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        db.collection("albums-dev").document.return_value.delete.assert_called_once()

    def test_album_not_empty_returns_400(self, client, mocker):
        album = make_album(owner=TEST_UID, media_count=3)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "ALBUM_NOT_EMPTY"
        assert "3" in resp.json()["error"]["message"]

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID, media_count=0)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 403

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("albums.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 401
