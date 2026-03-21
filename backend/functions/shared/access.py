"""Album access-control helpers shared by api and thumbnail."""
from __future__ import annotations


def can_read_album(
    album: dict, uid: str | None, db
) -> tuple[bool, str | None]:
    """Return (allowed, error_code).

    error_code is None when access is granted, otherwise the API error code
    to surface (ALBUM_NOT_FOUND or PERMISSION_DENIED).
    """
    vis = album.get("visibility")

    if vis == "public":
        return True, None

    if uid is None:
        # Treat private albums as not-found for anonymous users
        return False, "ALBUM_NOT_FOUND"

    if album.get("ownerId") == uid:
        return True, None

    if uid in album.get("memberIds", []):
        return True, None

    # private, not owner, not a member
    return False, "ALBUM_NOT_FOUND"


def can_write_album(album: dict, uid: str) -> bool:
    """Return True if uid can upload/edit media in the album.

    Public albums: any authenticated user (preserves existing behaviour).
    Private albums: owner or a member with 'write' permission.
    """
    if album.get("visibility") == "public":
        return True

    if album.get("ownerId") == uid:
        return True

    for entry in album.get("members", {}).values():
        if entry.get("userId") == uid and entry.get("permission") == "write":
            return True

    return False


def get_member_permission(album: dict, uid: str) -> str | None:
    """Return 'owner', 'read', 'write', or None if uid has no explicit membership."""
    if album.get("ownerId") == uid:
        return "owner"

    for entry in album.get("members", {}).values():
        if entry.get("userId") == uid:
            return entry.get("permission")  # 'read' or 'write'

    return None
