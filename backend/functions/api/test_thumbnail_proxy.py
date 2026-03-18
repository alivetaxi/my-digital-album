"""Tests for the thumbnail redirect endpoint."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import thumbnail_proxy


@pytest.fixture
def client():
    """TestClient with THUMBNAILS_BUCKET set to a test bucket name."""
    from main import app
    with patch.object(thumbnail_proxy, "_THUMBNAILS_BUCKET", "test-thumbnail-bucket"):
        with TestClient(app, raise_server_exceptions=True, follow_redirects=False) as c:
            yield c


class TestThumbnailRedirect:
    def test_redirects_to_gcs_url(self, client):
        resp = client.get("/thumbnail/media/u1/a1/m1/thumbnail.jpg")
        assert resp.status_code == 302
        assert resp.headers["location"] == (
            "https://storage.googleapis.com/test-thumbnail-bucket/"
            "media/u1/a1/m1/thumbnail.jpg"
        )

    def test_nested_path_preserved(self, client):
        resp = client.get("/thumbnail/a/b/c/d/e.jpg")
        assert resp.status_code == 302
        assert resp.headers["location"].endswith("/a/b/c/d/e.jpg")

    def test_no_auth_required(self, client):
        """Thumbnail endpoint is public — no auth header needed."""
        resp = client.get("/thumbnail/some/path.jpg")
        assert resp.status_code == 302
