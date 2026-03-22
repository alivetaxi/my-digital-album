"""GCS client and signed URL helpers."""
from __future__ import annotations

import datetime
import os

import google.auth
import google.auth.transport.requests
from google.cloud import storage

_client: storage.Client | None = None


def get_storage_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client(project=os.environ.get("GCP_PROJECT_ID"))
    return _client


def resolve_upload_origin(request_origin: str | None) -> str | None:
    """Return the request origin to bind resumable sessions to, if allowed.

    If UPLOAD_ALLOWED_ORIGINS is unset, fall back to the request origin so
    resumable uploads keep working without extra configuration. When the env
    var is set, only exact origin matches are allowed.
    """
    if not request_origin:
        return None

    configured = os.environ.get("UPLOAD_ALLOWED_ORIGINS", "")
    if not configured.strip():
        return request_origin

    allowed = {origin.strip() for origin in configured.split(",") if origin.strip()}
    return request_origin if request_origin in allowed else None


def generate_read_url(
    bucket_name: str,
    blob_path: str,
    expiration_minutes: int = 15,
) -> str:
    """Generate a v4 signed GET URL for reading a private GCS object."""
    credentials, _ = google.auth.default()
    credentials.refresh(google.auth.transport.requests.Request())

    client = get_storage_client()
    blob = client.bucket(bucket_name).blob(blob_path)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=expiration_minutes),
        method="GET",
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )


def generate_resumable_upload_url(
    bucket_name: str,
    blob_path: str,
    content_type: str,
    size: int,
    origin: str | None = None,
) -> str:
    """Create a GCS resumable upload session URI for large files.

    The returned URL is used by the client to PUT data in chunks using
    Content-Range headers.  No signing required — the session itself is
    authenticated by GCS.
    """
    client = get_storage_client()
    blob = client.bucket(bucket_name).blob(blob_path)
    return blob.create_resumable_upload_session(
        content_type=content_type,
        size=size,
        origin=origin,
    )


def generate_upload_url(
    bucket_name: str,
    blob_path: str,
    content_type: str,
    expiration_minutes: int = 15,
) -> str:
    """Generate a v4 signed PUT URL for direct client uploads to GCS.

    Requires the service account running this code to have
    roles/iam.serviceAccountTokenCreator on itself so it can call signBlob.
    """
    credentials, _ = google.auth.default()
    credentials.refresh(google.auth.transport.requests.Request())

    client = get_storage_client()
    blob = client.bucket(bucket_name).blob(blob_path)
    # Compute Engine / Cloud Run credentials don't hold a private key, so we
    # cannot sign locally.  Passing service_account_email + access_token tells
    # the GCS library to call the IAM signBlob API instead.
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=expiration_minutes),
        method="PUT",
        content_type=content_type,
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )
