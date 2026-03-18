"""Firebase token verification — FastAPI dependency helpers."""
from __future__ import annotations

import logging
import os

import firebase_admin
from firebase_admin import auth as firebase_auth
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

if not firebase_admin._apps:
    project_id = os.environ.get("GCP_PROJECT_ID")
    opts = {"projectId": project_id} if project_id else {}
    firebase_admin.initialize_app(options=opts)

_bearer = HTTPBearer(auto_error=False)


def get_uid(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str | None:
    """Return the Firebase uid from the Bearer token, or None if absent/invalid."""
    if not credentials:
        return None
    try:
        return firebase_auth.verify_id_token(credentials.credentials)["uid"]
    except Exception as exc:
        logger.warning("Token verification failed: %s", exc)
        return None


def require_auth(uid: str | None = Depends(get_uid)) -> str:
    """Dependency that raises 401 if the request has no valid Firebase token."""
    if uid is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHENTICATED", "message": "Please sign in to continue.", "status": 401},
        )
    return uid
