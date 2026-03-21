"""Tests for media endpoints."""
from __future__ import annotations

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
from test_albums import make_member_entry

MEMBER_EMAIL = "member@example.com"

UPLOAD_ITEMS = [
    {
        "sha256": "abc123",
        "mimeType": "image/jpeg",
        "filename": "photo.jpg",
        "size": 1024 * 1024,  # 1 MB
    }
]


# ---------------------------------------------------------------------------
# GET /api/albums/{album_id}/media
# ---------------------------------------------------------------------------

class TestListMedia:
    def test_returns_items_for_public_album(self, anon_client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public")
        media = make_media()
        db = build_db(album_doc=album, media_list=[media])
        mocker.patch("media.get_db", return_value=db)

        resp = anon_client.get(f"/api/albums/{ALBUM_ID}/media")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["id"] == MEDIA_ID
        assert data["nextCursor"] is None

    def test_cursor_pagination_sets_next_cursor(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        # Return limit+1 docs so nextCursor is set
        docs = [make_media(media_id=f"m-{i}") for i in range(31)]
        db = build_db(album_doc=album, media_list=docs)
        mocker.patch("media.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}/media?limit=30")
        data = resp.json()
        assert len(data["items"]) == 30
        assert data["nextCursor"] == "m-29"

    def test_album_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}/media")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ALBUM_NOT_FOUND"

    def test_private_album_returns_404_for_anonymous(self, anon_client, mocker):
        album = make_album(owner=OTHER_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)

        resp = anon_client.get(f"/api/albums/{ALBUM_ID}/media")
        assert resp.status_code == 404

    def test_private_album_returns_404_for_non_member(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)

        resp = other_client.get(f"/api/albums/{ALBUM_ID}/media")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/albums/{album_id}/media/upload-url
# ---------------------------------------------------------------------------

class TestRequestUploadUrl:
    def test_returns_signed_url_keyed_by_media_id(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["abc123"]["url"] == "https://signed-url"
        assert data["abc123"]["multipart"] is False

    def test_large_file_returns_resumable_url(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_resumable_upload_url", return_value="https://resumable-session")

        large_item = [{
            "sha256": "largehash",
            "mimeType": "video/mp4",
            "filename": "video.mp4",
            "size": 50 * 1024 * 1024,  # 50 MB — over MULTIPART_THRESHOLD (30 MB)
        }]
        resp = client.post(f"/api/albums/{ALBUM_ID}/media/upload-url", json=large_item)
        assert resp.status_code == 200
        data = resp.json()
        assert data["largehash"]["url"] == "https://resumable-session"
        assert data["largehash"]["multipart"] is True

    def test_creates_firestore_doc_with_pending_status(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        client.post(f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS)

        set_call = (
            db.collection("albums-dev")
            .document()
            .collection()
            .document()
            .set
        )
        set_call.assert_called_once()
        doc_data = set_call.call_args[0][0]
        assert doc_data["thumbnailStatus"] == "pending"
        assert doc_data["id"] == "abc123"
        assert doc_data["uploaderId"] == TEST_UID

    def test_skips_oversized_files(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        oversized = [
            {
                "sha256": "toobig",
                "mimeType": "image/jpeg",
                "filename": "big.jpg",
                "size": 501 * 1024 * 1024,  # 501 MB — over 500 MB limit
            }
        ]
        resp = client.post(f"/api/albums/{ALBUM_ID}/media/upload-url", json=oversized)
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_truncates_batch_to_50(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        items = [
            {"sha256": f"h{i}", "mimeType": "image/jpeg", "filename": "f.jpg", "size": 1024}
            for i in range(60)
        ]
        resp = client.post(f"/api/albums/{ALBUM_ID}/media/upload-url", json=items)
        assert resp.status_code == 200
        assert len(resp.json()) == 50

    def test_skips_set_when_media_already_ready(self, client, mocker):
        """Re-uploading a file whose thumbnail is already ready must not reset the doc."""
        album = make_album(owner=TEST_UID, visibility="private")
        existing_media = make_media(media_id="abc123", thumbnail_status="ready")
        db = build_db(album_doc=album, media_doc=existing_media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 200
        assert resp.json()["abc123"]["url"] == "https://signed-url"

        media_ref = (
            db.collection("albums-dev").document(ALBUM_ID).collection("media").document("abc123")
        )
        media_ref.set.assert_not_called()

    def test_write_member_can_request_upload_url(self, other_client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="write")
        album = make_album(
            owner=TEST_UID,
            visibility="private",
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_upload_url", return_value="https://signed-url")

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 200

    def test_read_member_cannot_request_upload_url(self, other_client, mocker):
        entry = make_member_entry(user_id=OTHER_UID, permission="read")
        album = make_album(
            owner=TEST_UID,
            visibility="private",
            members={MEMBER_EMAIL: entry},
            member_ids=[OTHER_UID],
        )
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)

        resp = other_client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "PERMISSION_DENIED"

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 401

    def test_album_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.post(
            f"/api/albums/{ALBUM_ID}/media/upload-url", json=UPLOAD_ITEMS
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/albums/{album_id}/media/{media_id}/original-url
# ---------------------------------------------------------------------------

class TestGetOriginalUrl:
    def test_returns_signed_url_for_album_member(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_read_url", return_value="https://signed-read-url")

        resp = client.get(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}/original-url")
        assert resp.status_code == 200
        assert resp.json()["url"] == "https://signed-read-url"

    def test_anonymous_can_access_public_album_original(self, anon_client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public")
        media = make_media(uploader=OTHER_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.generate_read_url", return_value="https://public-url")

        resp = anon_client.get(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}/original-url")
        assert resp.status_code == 200

    def test_private_album_returns_404_for_anonymous(self, anon_client, mocker):
        album = make_album(owner=OTHER_UID, visibility="private")
        db = build_db(album_doc=album)
        mocker.patch("media.get_db", return_value=db)

        resp = anon_client.get(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}/original-url")
        assert resp.status_code == 404

    def test_media_not_found_returns_404(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album, media_doc=make_doc(MEDIA_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}/original-url")
        assert resp.status_code == 404

    def test_album_not_found_returns_404(self, client, mocker):
        db = build_db(album_doc=make_doc(ALBUM_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.get(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}/original-url")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/albums/{album_id}/media/{media_id}
# ---------------------------------------------------------------------------

class TestUpdateMedia:
    def test_uploader_can_update_description(self, client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public")
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)

        resp = client.patch(
            f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}",
            json={"description": "A sunny day"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "A sunny day"

    def test_album_owner_can_update_description(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        media = make_media(uploader=OTHER_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)

        resp = client.patch(
            f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}",
            json={"description": "Owner edit"},
        )
        assert resp.status_code == 200

    def test_non_member_of_private_album_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)

        resp = other_client.patch(
            f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}",
            json={"description": "Hack"},
        )
        assert resp.status_code == 403

    def test_media_not_found_returns_404(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album, media_doc=make_doc(MEDIA_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.patch(
            f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}",
            json={"description": "x"},
        )
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.patch(
            f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}",
            json={"description": "x"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /api/albums/{album_id}/media/{media_id}
# ---------------------------------------------------------------------------

class TestDeleteMedia:
    def test_uploader_can_delete(self, client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public")
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.get_storage_client")

        resp = client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        db.collection("albums-dev").document().collection().document().delete.assert_called_once()

    def test_album_owner_can_delete(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        media = make_media(uploader=OTHER_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.get_storage_client")

        resp = client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 200

    def test_media_is_cover_blocked(self, client, mocker):
        album = make_album(owner=OTHER_UID, visibility="public", cover_media_id=MEDIA_ID)
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "MEDIA_IS_COVER"

    def test_decrements_media_count(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private", media_count=5)
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)
        mocker.patch("media.get_storage_client")

        client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")

        update_call = db.collection("albums-dev").document.return_value.update
        call_kwargs = update_call.call_args[0][0]
        assert "mediaCount" in call_kwargs

    def test_third_party_gets_403(self, other_client, mocker):
        album = make_album(owner=TEST_UID, visibility="public")
        media = make_media(uploader=TEST_UID)
        db = build_db(album_doc=album, media_doc=media)
        mocker.patch("media.get_db", return_value=db)

        resp = other_client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 403

    def test_media_not_found_returns_404(self, client, mocker):
        album = make_album(owner=TEST_UID, visibility="private")
        db = build_db(album_doc=album, media_doc=make_doc(MEDIA_ID, None))
        mocker.patch("media.get_db", return_value=db)

        resp = client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self, anon_client):
        resp = anon_client.delete(f"/api/albums/{ALBUM_ID}/media/{MEDIA_ID}")
        assert resp.status_code == 401
