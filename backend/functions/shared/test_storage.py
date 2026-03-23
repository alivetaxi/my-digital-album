"""Tests for storage helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

from shared import storage


class TestResolveUploadOrigin:
    def test_returns_request_origin_when_allowlist_unset(self, monkeypatch):
        monkeypatch.delenv("UPLOAD_ALLOWED_ORIGINS", raising=False)

        assert (
            storage.resolve_upload_origin("https://app.example.com")
            == "https://app.example.com"
        )

    def test_returns_none_when_request_origin_missing(self, monkeypatch):
        monkeypatch.delenv("UPLOAD_ALLOWED_ORIGINS", raising=False)

        assert storage.resolve_upload_origin(None) is None

    def test_returns_origin_when_present_in_allowlist(self, monkeypatch):
        monkeypatch.setenv(
            "UPLOAD_ALLOWED_ORIGINS",
            "https://app.example.com, https://album.example.com ",
        )

        assert (
            storage.resolve_upload_origin("https://album.example.com")
            == "https://album.example.com"
        )

    def test_returns_none_when_origin_not_in_allowlist(self, monkeypatch):
        monkeypatch.setenv("UPLOAD_ALLOWED_ORIGINS", "https://app.example.com")

        assert storage.resolve_upload_origin("https://evil.example.com") is None


class TestGenerateResumableUploadUrl:
    def test_passes_origin_to_gcs_session(self, mocker):
        client = MagicMock()
        blob = client.bucket.return_value.blob.return_value
        blob.create_resumable_upload_session.return_value = "https://session-url"
        mocker.patch("shared.storage.get_storage_client", return_value=client)

        url = storage.generate_resumable_upload_url(
            "bucket",
            "media/u/a/m/original.mp4",
            "video/mp4",
            123,
            origin="https://app.example.com",
        )

        assert url == "https://session-url"
        blob.create_resumable_upload_session.assert_called_once_with(
            content_type="video/mp4",
            size=123,
            origin="https://app.example.com",
        )
