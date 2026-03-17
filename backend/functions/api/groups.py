"""Groups route handlers."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from shared.auth import require_auth
from shared.errors import error_response

router = APIRouter(tags=["groups"])


@router.get("/users/me/groups")
def list_my_groups(uid: str = Depends(require_auth)):
    # TODO Phase 4
    return []


@router.post("/groups", status_code=201)
def create_group(uid: str = Depends(require_auth)):
    # TODO Phase 4
    return {}


@router.get("/groups/{group_id}")
def get_group(group_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 4
    return error_response("GROUP_NOT_FOUND")


@router.get("/groups/{group_id}/members")
def list_members(group_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 4
    return error_response("GROUP_NOT_FOUND")


@router.post("/groups/join")
def join_group(uid: str = Depends(require_auth)):
    # TODO Phase 4
    return error_response("INVITE_TOKEN_INVALID")


@router.post("/groups/{group_id}/leave")
def leave_group(group_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 4
    return error_response("GROUP_NOT_FOUND")


@router.post("/groups/{group_id}/regenerate-invite")
def regenerate_invite(group_id: str, uid: str = Depends(require_auth)):
    # TODO Phase 4
    return error_response("GROUP_NOT_FOUND")
