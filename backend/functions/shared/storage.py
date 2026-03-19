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
