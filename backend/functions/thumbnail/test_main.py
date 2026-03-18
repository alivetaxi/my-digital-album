"""Tests for thumbnail generation Cloud Function."""
from __future__ import annotations

import io
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# Since thumbnail/ is a package (has __init__.py), import via the package path
# to avoid colliding with api/main.py when both test suites run together.
import thumbnail.main as thumb


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(
    bucket: str = "media-bucket",
    name: str = "media/uid1/album1/mediaid1/original.jpg",
    content_type: str = "image/jpeg",
) -> MagicMock:
    event = MagicMock()
    event.data = {"bucket": bucket, "name": name, "contentType": content_type}
    return event


def _make_jpeg(width: int = 800, height: int = 600) -> bytes:
    """Create a minimal valid JPEG in memory via Pillow."""
    from PIL import Image

    img = Image.new("RGB", (width, height), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Path matching
# ---------------------------------------------------------------------------

class TestPathMatching:
    def test_ignores_non_media_paths(self):
        event = _make_event(name="some/other/path.jpg")
        with patch("thumbnail.main._process") as mock_process:
            thumb.generate_thumbnail_and_metadata(event)
            mock_process.assert_not_called()

    def test_ignores_thumbnail_path(self):
        event = _make_event(name="media/uid/album/media/thumbnail.jpg")
        with patch("thumbnail.main._process") as mock_process:
            thumb.generate_thumbnail_and_metadata(event)
            mock_process.assert_not_called()


# ---------------------------------------------------------------------------
# Image processing
# ---------------------------------------------------------------------------

class TestProcessImage:
    def test_jpeg_produces_thumbnail_and_dimensions(self):
        jpeg = _make_jpeg(800, 600)
        thumbnail_bytes, width, height, exif = thumb._process_image(jpeg, "image/jpeg")

        assert isinstance(thumbnail_bytes, bytes) and len(thumbnail_bytes) > 0
        assert width == 800
        assert height == 600

        from PIL import Image
        img = Image.open(io.BytesIO(thumbnail_bytes))
        assert img.width == 400
        assert img.height == 300  # aspect ratio preserved

    def test_png_is_processed(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (600, 400)).save(buf, format="PNG")
        _, w, h, _ = thumb._process_image(buf.getvalue(), "image/png")
        assert w == 600
        assert h == 400

    def test_webp_processed_successfully(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (400, 300)).save(buf, format="WEBP")
        thumbnail_bytes, w, h, _ = thumb._process_image(buf.getvalue(), "image/webp")
        assert w == 400

    def test_corrupted_bytes_raise_corrupted_error(self):
        with pytest.raises(thumb.CorruptedFileError):
            thumb._process_image(b"not an image", "image/jpeg")


# ---------------------------------------------------------------------------
# EXIF extraction
# ---------------------------------------------------------------------------

class TestExtractExif:
    def test_returns_empty_dict_when_no_exif(self):
        from PIL import Image

        img = Image.new("RGB", (100, 100))
        assert thumb._extract_exif(img) == {}

    def test_extracts_taken_at_from_datetime_original(self):
        from PIL import Image
        import piexif

        exif_dict = {
            "0th": {},
            "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2023:06:15 10:30:00"},
            "GPS": {},
            "1st": {},
            "thumbnail": None,
        }
        img = Image.new("RGB", (100, 100))
        img.info["exif"] = piexif.dump(exif_dict)

        result = thumb._extract_exif(img)
        assert result["takenAt"] == datetime(2023, 6, 15, 10, 30, 0, tzinfo=timezone.utc)

    def test_gracefully_handles_bad_exif(self):
        from PIL import Image

        img = Image.new("RGB", (100, 100))
        img.info["exif"] = b"garbage"
        assert thumb._extract_exif(img) == {}


# ---------------------------------------------------------------------------
# Full _process flow
# ---------------------------------------------------------------------------

class TestProcess:
    def _mock_gcs(self, file_bytes: bytes) -> MagicMock:
        blob = MagicMock()
        blob.download_as_bytes.return_value = file_bytes
        bucket = MagicMock()
        bucket.blob.return_value = blob
        client = MagicMock()
        client.bucket.return_value = bucket
        return client

    def test_happy_path_updates_firestore_and_increments_count(self, mocker):
        jpeg = _make_jpeg()
        gcs = self._mock_gcs(jpeg)
        mock_update = mocker.patch("thumbnail.main._update_media")
        mock_increment = mocker.patch("thumbnail.main._increment_media_count")

        with patch("google.cloud.storage.Client", return_value=gcs):
            thumb._process("bucket", "media/u/a/m/original.jpg", "u", "a", "m", "image/jpeg")

        mock_update.assert_called_once()
        fields = mock_update.call_args[0][2]
        assert fields["thumbnailStatus"] == "ready"
        assert fields["width"] == 800
        assert fields["height"] == 600
        assert "thumbnailPath" in fields
        mock_increment.assert_called_once_with("a")

    def test_invalid_format_marks_failed_without_retry(self, mocker):
        mock_update = mocker.patch("thumbnail.main._update_media")

        with patch("thumbnail.main._process", side_effect=thumb.InvalidFileFormatError("bad")):
            thumb.generate_thumbnail_and_metadata(_make_event())  # must NOT raise

        mock_update.assert_called_once()
        assert mock_update.call_args[0][2]["thumbnailStatus"] == "failed"

    def test_corrupted_file_marks_failed_without_retry(self, mocker):
        mock_update = mocker.patch("thumbnail.main._update_media")

        with patch("thumbnail.main._process", side_effect=thumb.CorruptedFileError("corrupt")):
            thumb.generate_thumbnail_and_metadata(_make_event())  # must NOT raise

        assert mock_update.call_args[0][2]["thumbnailStatus"] == "failed"

    def test_recoverable_exception_re_raises_for_retry(self, mocker):
        mocker.patch("thumbnail.main._update_media")

        with patch("thumbnail.main._process", side_effect=RuntimeError("transient")):
            with pytest.raises(RuntimeError, match="transient"):
                thumb.generate_thumbnail_and_metadata(_make_event())


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

class TestFirestoreHelpers:
    def test_update_media_writes_correct_path(self):
        mock_db = MagicMock()
        with patch("google.cloud.firestore.Client", return_value=mock_db):
            thumb._update_media("album-1", "media-1", {"thumbnailStatus": "ready"})

        mock_db.collection.assert_called_with("albums")
        doc_ref = mock_db.collection().document().collection().document()
        doc_ref.update.assert_called_once_with({"thumbnailStatus": "ready"})

    def test_increment_media_count_calls_firestore_increment(self):
        mock_db = MagicMock()
        with patch("google.cloud.firestore.Client", return_value=mock_db):
            thumb._increment_media_count("album-1")

        update_args = mock_db.collection().document().update.call_args[0][0]
        assert "mediaCount" in update_args
