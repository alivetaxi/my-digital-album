"""Tests for albums endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from conftest import (
    ALBUM_ID,
    MEDIA_ID,
    OTHER_UID,
    TEST_UID,
    build_db,
    make_album,
    make_doc,
    make_media,
    make_user,
)

MEMBER_EMAIL = "member@example.com"


def make_member_entry(
    user_id: str | None = OTHER_UID,
    permission: str = "read",
    invite_token: str | None = None,
    expired: bool = False,
) -> dict:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=-1 if expired else 24) if invite_token else None
    return {
        "userId": user_id,
        "permission": permission,
        "inviteToken": invite_token,
        "inviteExpiresAt": expires_at,
        "addedAt": now,
    }


# ---------------------------------------------------------------------------
# GET /api/albums
# ---------------------------------------------------------------------------

class TestListAlbums:
    def test_anonymous_returns_only_public(self, anon_client, mocker):
        pub = make_album(album_id="pub-1", owner=OTHER_UID, visibility="public")
        db = build_db(public_album_list=[pub])
        mocker.patch("albums.get_db", return_value=db)

        resp = anon_client.get("/api/albums")
        assert resp.status_code == 200
        data = resp.json()
        assert data["mine"] == []
        assert data["shared"] == []
        assert len(data["public"]) == 1
        assert data["public"][0]["id"] == "pub-1"

    def test_invalid_token_returns_only_public(self, anon_client, mocker):
        pub = make_album(album_id="pub-1", owner=OTHER_UID, visibility="public")
        db = build_db(public_album_list=[pub])
        mocker.patch("albums.get_db", return_value=db)

        resp = anon_client.get("/api/albums", headers={"Authorization": "Bearer bad-token"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["public"]) == 1

    def test_authenticated_populates_mine(self, client, mocker):
        mine = make_album(album_id="mine-1", owner=TEST_UID, visibility="private")
        db = build_db(mine_album_list=[mine])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["mine"]) == 1
        assert data["mine"][0]["id"] == "mine-1"

    def test_own_public_album_excluded_from_public_section(self, client, mocker):
        own_pub = make_album(album_id="own-pub", owner=TEST_UID, visibility="public")
        db = build_db(mine_album_list=[own_pub], public_album_list=[own_pub])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        data = resp.json()
        pub_ids = [a["id"] for a in data["public"]]
        assert "own-pub" not in pub_ids

    def test_shared_albums_returned_for_member(self, client, mocker):
        shared = make_album(
            album_id="shared-1",
            owner=OTHER_UID,
            visibility="private",
            member_ids=[TEST_UID],
        )
        db = build_db(member_album_list=[shared])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get("/api/albums")
        data = resp.json()
        assert len(data["shared"]) == 1
        assert data["shared"][0]["id"] == "shared-1"

    def test_shared_empty_when_not_a_member(self, client, mocker):
        db = build_db(member_album_list=[])
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
        assert data["myPermission"] == "owner"
        assert "id" in data
        # Internal fields must not be exposed
        assert "members" not in data
        assert "memberIds" not in data
        db.collection("albums-dev").document.return_value.set.assert_called_once()

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.post("/api/albums", json={"title": "X"})
        assert resp.status_code == 401

    def test_create_with_public_visibility(self, client, mocker):
        db = build_db()
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post("/api/albums", json={"title": "Public Album", "visibility": "public"})
        assert resp.status_code == 201
        assert resp.json()["visibility"] == "public"


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
        assert resp.json()["myPermission"] == "owner"

    def test_private_album_hidden_from_non_member(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ALBUM_NOT_FOUND"

    def test_private_album_accessible_by_read_member(self, other_client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="read")
        album = make_album(
            owner=TEST_UID,
            visibility="private",
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200
        assert resp.json()["myPermission"] == "read"

    def test_private_album_accessible_by_write_member(self, other_client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="write")
        album = make_album(
            owner=TEST_UID,
            visibility="private",
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 200
        assert resp.json()["myPermission"] == "write"

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
        media = make_media()
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

    def test_unauthenticated_returns_401(self, anon_client):
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

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.delete(f"/api/albums/{ALBUM_ID}")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/albums/{album_id}/members
# ---------------------------------------------------------------------------

class TestListMembers:
    def test_owner_can_list_members(self, client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="read")
        album = make_album(
            owner=TEST_UID,
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        other_user = make_user(uid=OTHER_UID, display_name="Other", email=MEMBER_EMAIL)
        db = build_db(album_doc=album, user_docs_by_uid={OTHER_UID: other_user})
        mocker.patch("albums.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}/members")
        assert resp.status_code == 200
        members = resp.json()
        assert len(members) == 1
        assert members[0]["email"] == MEMBER_EMAIL
        assert members[0]["permission"] == "read"
        assert members[0]["displayName"] == "Other"

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}/members")
        assert resp.status_code == 403

    def test_unauthenticated_gets_401(self, anon_client):
        resp = anon_client.get(f"/api/albums/{ALBUM_ID}/members")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/albums/{album_id}/members
# ---------------------------------------------------------------------------

class TestAddMember:
    def test_owner_adds_existing_user_directly(self, client, mocker):
        album = make_album(owner=TEST_UID)
        existing_user = make_user(uid=OTHER_UID, email=MEMBER_EMAIL)
        db = build_db(album_doc=album, user_by_email_list=[existing_user])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/members",
            json={"email": MEMBER_EMAIL, "permission": "write"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["email"] == MEMBER_EMAIL
        assert data["userId"] == OTHER_UID
        assert data["permission"] == "write"
        assert data["inviteToken"] is None  # user exists, no token needed

    def test_owner_adds_unregistered_user_with_invite_token(self, client, mocker):
        album = make_album(owner=TEST_UID)
        db = build_db(album_doc=album, user_by_email_list=[])
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/members",
            json={"email": "newuser@example.com", "permission": "read"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["userId"] is None
        assert data["inviteToken"] is not None  # invite link generated
        assert data["permission"] == "read"

    def test_already_member_returns_409(self, client, mocker):
        entry = make_member_entry()
        album = make_album(owner=TEST_UID, members={MEMBER_EMAIL: entry})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/members",
            json={"email": MEMBER_EMAIL, "permission": "read"},
        )
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "ALREADY_MEMBER"

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/members",
            json={"email": MEMBER_EMAIL, "permission": "read"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /api/albums/{album_id}/members/{email}
# ---------------------------------------------------------------------------

class TestUpdateMember:
    def test_owner_can_change_permission(self, client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="read")
        album = make_album(owner=TEST_UID, members={MEMBER_EMAIL: entry})
        other_user = make_user(uid=OTHER_UID, email=MEMBER_EMAIL)
        db = build_db(album_doc=album, user_docs_by_uid={OTHER_UID: other_user})
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(
            f"/api/albums/{ALBUM_ID}/members/{MEMBER_EMAIL}",
            json={"permission": "write"},
        )
        assert resp.status_code == 200
        assert resp.json()["permission"] == "write"

    def test_member_not_found_returns_404(self, client, mocker):
        album = make_album(owner=TEST_UID, members={})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.patch(
            f"/api/albums/{ALBUM_ID}/members/nobody@example.com",
            json={"permission": "write"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "MEMBER_NOT_FOUND"

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.patch(
            f"/api/albums/{ALBUM_ID}/members/{MEMBER_EMAIL}",
            json={"permission": "write"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /api/albums/{album_id}/members/{email}
# ---------------------------------------------------------------------------

class TestDeleteMember:
    def test_owner_can_remove_member(self, client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="read")
        album = make_album(
            owner=TEST_UID,
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}/members/{MEMBER_EMAIL}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        db.collection("albums-dev").document.return_value.update.assert_called_once()

    def test_non_owner_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID)
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.delete(f"/api/albums/{ALBUM_ID}/members/{MEMBER_EMAIL}")
        assert resp.status_code == 403

    def test_member_not_found_returns_404(self, client, mocker):
        album = make_album(owner=TEST_UID, members={})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}/members/nobody@example.com")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/albums/{album_id}/accept-invite
# ---------------------------------------------------------------------------

class TestAcceptInvite:
    def test_valid_token_accepted(self, other_client, mocker):
        token = "valid-invite-token"
        entry = make_member_entry(user_id=None, permission="read", invite_token=token)
        album = make_album(owner=TEST_UID, members={MEMBER_EMAIL: entry})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/accept-invite",
            json={"token": token},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == ALBUM_ID
        assert data["myPermission"] == "read"

    def test_expired_token_returns_400(self, other_client, mocker):
        token = "expired-token"
        entry = make_member_entry(user_id=None, permission="read", invite_token=token, expired=True)
        album = make_album(owner=TEST_UID, members={MEMBER_EMAIL: entry})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/accept-invite",
            json={"token": token},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVITE_TOKEN_EXPIRED"

    def test_invalid_token_returns_400(self, other_client, mocker):
        entry = make_member_entry(user_id=None, permission="read", invite_token="real-token")
        album = make_album(owner=TEST_UID, members={MEMBER_EMAIL: entry})
        db = build_db(album_doc=album)
        mocker.patch("albums.get_db", return_value=db)

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/accept-invite",
            json={"token": "wrong-token"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVITE_TOKEN_INVALID"

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.post(
            f"/api/albums/{ALBUM_ID}/accept-invite",
            json={"token": "any"},
        )
        assert resp.status_code == 401
