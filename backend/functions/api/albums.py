"""Albums route handlers."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from shared.auth import get_uid, require_auth
from shared.errors import error_response

router = APIRouter(prefix="/albums", tags=["albums"])


@router.get("")
def list_albums(uid: str | None = Depends(get_uid)):
    # TODO Phase 2: query Firestore
    return {"mine": [], "shared": [], "public": []}


@router.post("", status_code=201)
def create_album(uid: str = Depends(require_auth)):
    # TODO Phase 2: create album in Firestore
    return {}


@router.get("/{album_id}")
def get_album(album_id: str, uid: str | None = Depends(get_uid)):
    # TODO Phase 2: fetch from Firestore, check visibility
    return error_response("ALBUM_NOT_FOUND")


@router.patch("/{album_id}")
def update_album(album_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 2
    return error_response("ALBUM_NOT_FOUND")


@router.delete("/{album_id}")
def delete_album(album_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 2
    return error_response("ALBUM_NOT_FOUND")
