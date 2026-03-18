"""Firestore client singleton."""
from __future__ import annotations

import os

from google.cloud import firestore

_db: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client(
            project=os.environ.get("GCP_PROJECT_ID"),
            database=os.environ.get("FIRESTORE_DATABASE", "(default)"),
        )
    return _db
