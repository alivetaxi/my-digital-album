"""Tests for thumbnail generation Cloud Function."""
from __future__ import annotations

import io
import os
import tempfile
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# Since thumbnail/ is a package (has __init__.py), import via the package path
# to avoid colliding with api/main.py when both test suites run together.
import thumbnail.main as thumb


def _write_tmp(data: bytes, suffix: str = ".jpg") -> str:
    """Write bytes to a named temp file and return its path. Caller must os.unlink it."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)
    return path


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
        path = _write_tmp(jpeg, ".jpg")
        try:
            thumbnail_bytes, width, height, exif = thumb._process_image(path, "image/jpeg")

            assert isinstance(thumbnail_bytes, bytes) and len(thumbnail_bytes) > 0
            assert width == 800
            assert height == 600

            from PIL import Image
            img = Image.open(io.BytesIO(thumbnail_bytes))
            assert img.width == 400
            assert img.height == 300  # aspect ratio preserved
        finally:
            os.unlink(path)

    def test_png_is_processed(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (600, 400)).save(buf, format="PNG")
        path = _write_tmp(buf.getvalue(), ".png")
        try:
            _, w, h, _ = thumb._process_image(path, "image/png")
            assert w == 600
            assert h == 400
        finally:
            os.unlink(path)

    def test_webp_processed_successfully(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (400, 300)).save(buf, format="WEBP")
        path = _write_tmp(buf.getvalue(), ".webp")
        try:
            thumbnail_bytes, w, h, _ = thumb._process_image(path, "image/webp")
            assert w == 400
        finally:
            os.unlink(path)

    def test_corrupted_bytes_raise_corrupted_error(self):
        path = _write_tmp(b"not an image", ".jpg")
        try:
            with pytest.raises(thumb.CorruptedFileError):
                thumb._process_image(path, "image/jpeg")
        finally:
            os.unlink(path)


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
        def _download(path: str) -> None:
            with open(path, "wb") as fh:
                fh.write(file_bytes)

        blob = MagicMock()
        blob.download_to_filename.side_effect = _download
        bucket = MagicMock()
        bucket.blob.return_value = blob
        client = MagicMock()
        client.bucket.return_value = bucket
        return client

    def test_happy_path_updates_firestore(self, mocker):
        jpeg = _make_jpeg()
        gcs = self._mock_gcs(jpeg)
        mock_update = mocker.patch("thumbnail.main._update_media")

        with patch("google.cloud.storage.Client", return_value=gcs):
            thumb._process("bucket", "media/u/a/m/original.jpg", "u", "a", "m", "image/jpeg")

        mock_update.assert_called_once()
        fields = mock_update.call_args[0][2]
        assert fields["thumbnailStatus"] == "ready"
        assert fields["width"] == 800
        assert fields["height"] == 600
        assert "thumbnailPath" in fields

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
# Video processing
# ---------------------------------------------------------------------------

class TestProcessVideo:
    """Tests for _process_video — imageio_ffmpeg.read_frames and subprocess are mocked."""

    def _make_raw_frame(self, width: int = 1280, height: int = 720) -> bytes:
        """Packed RGB bytes as imageio_ffmpeg.read_frames() would return."""
        return bytes(width * height * 3)

    def _make_reader(self, meta: dict, frame: bytes | None = None):
        """Return a generator that mimics imageio_ffmpeg.read_frames()."""
        def _gen():
            yield meta
            if frame is not None:
                yield frame
        return _gen()

    def _no_tags_subprocess(self, mocker):
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr="", stdout=""),
        )

    # _process_video now accepts a file path (str); imageio_ffmpeg and subprocess
    # are mocked so the file doesn't need to actually exist.
    _FAKE_PATH = "/tmp/test_video.mp4"

    def test_happy_path_returns_thumbnail_and_dimensions(self, mocker):
        frame = self._make_raw_frame(1280, 720)
        meta = {"size": (1280, 720), "duration": 10.5, "fps": 30.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        self._no_tags_subprocess(mocker)

        thumbnail_bytes, width, height, duration, metadata = thumb._process_video(self._FAKE_PATH)

        assert isinstance(thumbnail_bytes, bytes) and len(thumbnail_bytes) > 0
        assert width == 1280
        assert height == 720
        assert duration == pytest.approx(10.5)

        from PIL import Image
        img = Image.open(io.BytesIO(thumbnail_bytes))
        assert img.width == 400  # resized to THUMBNAIL_WIDTH

    def test_no_extractable_frame_raises_corrupted(self, mocker):
        meta = {"size": (1280, 720), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, None))
        self._no_tags_subprocess(mocker)

        with pytest.raises(thumb.CorruptedFileError):
            thumb._process_video(self._FAKE_PATH)

    def test_zero_width_raises_corrupted(self, mocker):
        frame = self._make_raw_frame(1280, 720)
        meta = {"size": (0, 0), "duration": None}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        self._no_tags_subprocess(mocker)

        with pytest.raises(thumb.CorruptedFileError):
            thumb._process_video(self._FAKE_PATH)

    def test_extracts_creation_time_as_taken_at(self, mocker):
        frame = self._make_raw_frame(640, 480)
        meta = {"size": (640, 480), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        stderr = "    creation_time   : 2023-06-15T10:30:00.000000Z\n"
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=stderr, stdout=""),
        )

        _, _, _, _, metadata = thumb._process_video(self._FAKE_PATH)
        assert metadata["takenAt"] == datetime(2023, 6, 15, 10, 30, 0, tzinfo=timezone.utc)

    def test_quicktime_creationdate_takes_priority_over_creation_time(self, mocker):
        frame = self._make_raw_frame(640, 480)
        meta = {"size": (640, 480), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        # Both tags present; creationdate includes timezone, creation_time is UTC
        stderr = (
            "    creation_time   : 2023-06-14T16:30:00.000000Z\n"
            "    com.apple.quicktime.creationdate: 2023-06-15T00:30:00+0800\n"
        )
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=stderr, stdout=""),
        )

        _, _, _, _, metadata = thumb._process_video(self._FAKE_PATH)
        # Should use quicktime_creationdate (local midnight +08:00 = UTC 16:30)
        from datetime import timezone as tz
        import datetime as dt_mod
        expected_tz = dt_mod.timezone(dt_mod.timedelta(hours=8))
        assert metadata["takenAt"].year == 2023
        assert metadata["takenAt"].month == 6
        assert metadata["takenAt"].day == 15
        assert metadata["takenAt"].hour == 0

    def test_skips_epoch_sentinel_creation_time(self, mocker):
        frame = self._make_raw_frame(640, 480)
        meta = {"size": (640, 480), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        # Null sentinel: year < 2000 means timestamp was never set
        stderr = "    creation_time   : 1970-01-01T00:00:00.000000Z\n"
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=stderr, stdout=""),
        )

        _, _, _, _, metadata = thumb._process_video(self._FAKE_PATH)
        assert "takenAt" not in metadata

    def test_skips_qt_null_sentinel_creation_time(self, mocker):
        frame = self._make_raw_frame(640, 480)
        meta = {"size": (640, 480), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        stderr = "    creation_time   : 0001-01-01T00:00:00.000000Z\n"
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=stderr, stdout=""),
        )

        _, _, _, _, metadata = thumb._process_video(self._FAKE_PATH)
        assert "takenAt" not in metadata

    def test_extracts_gps_location_as_taken_place(self, mocker):
        frame = self._make_raw_frame(640, 480)
        meta = {"size": (640, 480), "duration": 5.0}
        mocker.patch("imageio_ffmpeg.read_frames", return_value=self._make_reader(meta, frame))
        stderr = "    location        : +35.6894+139.6917+40/\n"
        mocker.patch(
            "thumbnail.main.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=stderr, stdout=""),
        )
        mocker.patch("thumbnail.main._reverse_geocode", return_value="Tokyo, Japan")

        _, _, _, _, metadata = thumb._process_video(self._FAKE_PATH)
        assert metadata["takenPlace"]["lat"] == pytest.approx(35.6894)
        assert metadata["takenPlace"]["lng"] == pytest.approx(139.6917)
        assert metadata["takenPlace"]["placeName"] == "Tokyo, Japan"


# ---------------------------------------------------------------------------
# ISO 6709 parsing
# ---------------------------------------------------------------------------

class TestParseIso6709:
    def test_parses_positive_lat_lng(self):
        lat, lng = thumb._parse_iso6709("+35.6894+139.6917/")
        assert lat == pytest.approx(35.6894)
        assert lng == pytest.approx(139.6917)

    def test_parses_negative_values(self):
        lat, lng = thumb._parse_iso6709("-33.8688+151.2093/")
        assert lat == pytest.approx(-33.8688)
        assert lng == pytest.approx(151.2093)

    def test_returns_none_for_garbage(self):
        lat, lng = thumb._parse_iso6709("not-a-location")
        assert lat is None
        assert lng is None


# ---------------------------------------------------------------------------
# _process — video branch
# ---------------------------------------------------------------------------

class TestProcessVideoIntegration:
    def test_video_content_type_calls_process_video(self, mocker):
        jpeg = _make_jpeg()
        # download_to_filename is a no-op because _process_video is mocked
        gcs_client = MagicMock()
        mock_process_video = mocker.patch(
            "thumbnail.main._process_video",
            return_value=(jpeg, 1280, 720, 10.5, {}),
        )
        mock_update = mocker.patch("thumbnail.main._update_media")

        with patch("google.cloud.storage.Client", return_value=gcs_client):
            thumb._process("bucket", "media/u/a/m/original.mp4", "u", "a", "m", "video/mp4")

        mock_process_video.assert_called_once()
        # Argument must be a string path, not bytes
        assert isinstance(mock_process_video.call_args[0][0], str)
        fields = mock_update.call_args[0][2]
        assert fields["thumbnailStatus"] == "ready"
        assert fields["duration"] == 10.5
        assert fields["width"] == 1280

    def test_unsupported_content_type_raises_invalid_format(self, mocker):
        # download_to_filename is auto-mocked (returns MagicMock, does not raise)
        gcs_mock = MagicMock()

        with patch("google.cloud.storage.Client", return_value=gcs_mock):
            with pytest.raises(thumb.InvalidFileFormatError):
                thumb._process("bucket", "media/u/a/m/original.bin", "u", "a", "m", "application/octet-stream")


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

class TestFirestoreHelpers:
    def test_update_media_writes_correct_path(self):
        mock_db = MagicMock()
        with patch("google.cloud.firestore.Client", return_value=mock_db):
            thumb._update_media("album-1", "media-1", {"thumbnailStatus": "ready"})

        mock_db.collection.assert_called_with("albums-dev")
        doc_ref = mock_db.collection().document().collection().document()
        doc_ref.update.assert_called_once_with({"thumbnailStatus": "ready"})

