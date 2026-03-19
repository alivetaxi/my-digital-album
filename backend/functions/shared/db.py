"""Firestore client singleton and collection name helpers."""
from __future__ import annotations

import os

from google.cloud import firestore

_db: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client(
            project=os.environ.get("GCP_PROJECT_ID"),
        )
    return _db


def get_col(name: str) -> str:
    """Return the environment-scoped collection name, e.g. 'albums-dev'."""
    env = os.environ.get("ENVIRONMENT", "dev")
    return f"{name}-{env}"
