"""Standard error response helpers."""
from __future__ import annotations

from fastapi.responses import JSONResponse

ERROR_MESSAGES: dict[str, tuple[str, int]] = {
    "UNAUTHENTICATED":      ("Please sign in to continue.", 401),
    "PERMISSION_DENIED":    ("You don't have permission to do that.", 403),
    "NOT_GROUP_MEMBER":     ("This album is only visible to group members.", 403),
    "ALBUM_NOT_FOUND":      ("Album not found.", 404),
    "MEDIA_NOT_FOUND":      ("This item no longer exists.", 404),
    "GROUP_NOT_FOUND":      ("Group not found.", 404),
    "MEMBER_NOT_FOUND":     ("Member not found.", 404),
    "ALBUM_NOT_EMPTY":      ("This album still has items. Remove all media before deleting.", 400),
    "MEDIA_IS_COVER":       ("This item is the album cover. Change the cover before deleting it.", 400),
    "INVITE_TOKEN_INVALID": ("This invite link is invalid.", 400),
    "INVITE_TOKEN_EXPIRED": ("This invite link has expired. Ask the album owner for a new one.", 400),
    "ALREADY_IN_GROUP":     ("You're already a member of this group.", 409),
    "ALREADY_MEMBER":       ("This person already has access to the album.", 409),
}


def error_response(code: str, message: str | None = None) -> JSONResponse:
    msg, status = ERROR_MESSAGES.get(code, ("An error occurred.", 500))
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message or msg, "status": status}},
    )
