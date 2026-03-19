"""Album access-control helpers shared by api and thumbnail."""
from __future__ import annotations

from shared.db import get_col


def can_read_album(
    album: dict, uid: str | None, db
) -> tuple[bool, str | None]:
    """Return (allowed, error_code).

    error_code is None when access is granted, otherwise the API error code
    to surface (ALBUM_NOT_FOUND or NOT_GROUP_MEMBER).
    """
    vis = album.get("visibility")

    if vis == "public":
        return True, None

    if uid is None:
        # Treat private/group albums as not-found for anonymous users
        return False, "ALBUM_NOT_FOUND"

    if album.get("ownerId") == uid:
        return True, None

    if vis == "group":
        group_id = album.get("groupId")
        if group_id:
            group = db.collection(get_col("groups")).document(group_id).get()
            if group.exists and uid in group.to_dict().get("memberIds", []):
                return True, None
        return False, "NOT_GROUP_MEMBER"

    # private, not owner
    return False, "ALBUM_NOT_FOUND"
