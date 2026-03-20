"""Tests for group endpoints."""
from __future__ import annotations

import pytest

from conftest import (
    GROUP_ID,
    OTHER_UID,
    TEST_UID,
    build_db,
    make_doc,
    make_group,
    make_user,
)


# ---------------------------------------------------------------------------
# GET /users/me/groups
# ---------------------------------------------------------------------------

class TestListMyGroups:
    def test_returns_groups_for_member(self, client, mocker):
        group = make_group(member_ids=[TEST_UID])
        db = build_db(group_list=[group])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get("/api/users/me/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == GROUP_ID
        assert data[0]["name"] == "Test Group"

    def test_returns_empty_when_no_groups(self, client, mocker):
        db = build_db(group_list=[])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get("/api/users/me/groups")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.get("/api/users/me/groups")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /groups
# ---------------------------------------------------------------------------

class TestCreateGroup:
    def test_creates_group_with_invite_token(self, client, mocker):
        db = build_db()
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post("/api/groups", json={"name": "Family"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Family"
        assert data["ownerId"] == TEST_UID
        assert TEST_UID in data["memberIds"]
        assert data["inviteToken"] != ""
        assert data["inviteTokenExpiresAt"] is not None

    def test_creator_added_to_user_groupids(self, client, mocker):
        db = build_db()
        mocker.patch("groups.get_db", return_value=db)

        client.post("/api/groups", json={"name": "Pals"})

        user_ref = db.collection("users-dev").document(TEST_UID)
        user_ref.set.assert_called_once()
        call_args = user_ref.set.call_args
        assert "groupIds" in call_args[0][0]

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.post("/api/groups", json={"name": "X"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /groups/{group_id}
# ---------------------------------------------------------------------------

class TestGetGroup:
    def test_member_can_get_group(self, client, mocker):
        group = make_group(member_ids=[TEST_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}")
        assert resp.status_code == 200
        assert resp.json()["id"] == GROUP_ID

    def test_non_member_gets_403(self, client, mocker):
        group = make_group(member_ids=[OTHER_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}")
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "PERMISSION_DENIED"

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(group_doc=make_doc(GROUP_ID, None))
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "GROUP_NOT_FOUND"


# ---------------------------------------------------------------------------
# GET /groups/{group_id}/members
# ---------------------------------------------------------------------------

class TestListMembers:
    def test_returns_member_profiles(self, client, mocker):
        group = make_group(member_ids=[TEST_UID, OTHER_UID])
        user = make_user(uid=TEST_UID, display_name="Alice", email="alice@example.com")
        db = build_db(group_doc=group, user_doc=user)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}/members")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # First member has profile from user_doc
        assert data[0]["uid"] == TEST_UID
        assert data[0]["displayName"] == "Alice"
        assert data[0]["email"] == "alice@example.com"

    def test_member_without_profile_returns_nulls(self, client, mocker):
        group = make_group(member_ids=[TEST_UID])
        db = build_db(group_doc=group, user_doc=make_doc(TEST_UID, None))
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}/members")
        assert resp.status_code == 200
        assert resp.json()[0]["displayName"] is None

    def test_non_member_gets_403(self, client, mocker):
        group = make_group(member_ids=[OTHER_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.get(f"/api/groups/{GROUP_ID}/members")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /groups/join
# ---------------------------------------------------------------------------

class TestJoinGroup:
    def test_valid_token_joins_group(self, client, mocker):
        group = make_group(member_ids=[OTHER_UID], invite_token="valid-token-abc")
        db = build_db(group_query_list=[group])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post("/api/groups/join", json={"inviteToken": "valid-token-abc"})
        assert resp.status_code == 200
        data = resp.json()
        assert TEST_UID in data["memberIds"]

    def test_invalid_token_returns_400(self, client, mocker):
        db = build_db(group_query_list=[])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post("/api/groups/join", json={"inviteToken": "bad-token"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVITE_TOKEN_INVALID"

    def test_expired_token_returns_400(self, client, mocker):
        group = make_group(member_ids=[OTHER_UID], expired=True)
        db = build_db(group_query_list=[group])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post("/api/groups/join", json={"inviteToken": "valid-token-abc"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVITE_TOKEN_EXPIRED"

    def test_already_member_returns_409(self, client, mocker):
        group = make_group(member_ids=[TEST_UID, OTHER_UID])
        db = build_db(group_query_list=[group])
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post("/api/groups/join", json={"inviteToken": "valid-token-abc"})
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "ALREADY_IN_GROUP"

    def test_unauthenticated_returns_401(self, anon_client, mocker):
        resp = anon_client.post("/api/groups/join", json={"inviteToken": "x"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /groups/{group_id}/leave
# ---------------------------------------------------------------------------

class TestLeaveGroup:
    def test_member_can_leave(self, client, mocker):
        group = make_group(member_ids=[TEST_UID, OTHER_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/leave")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        group_ref = db.collection("groups-dev").document(GROUP_ID)
        group_ref.update.assert_called_once()

    def test_non_member_gets_403(self, client, mocker):
        group = make_group(member_ids=[OTHER_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/leave")
        assert resp.status_code == 403

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(group_doc=make_doc(GROUP_ID, None))
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/leave")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /groups/{group_id}/regenerate-invite
# ---------------------------------------------------------------------------

class TestRegenerateInvite:
    def test_owner_gets_new_token(self, client, mocker):
        group = make_group(owner=TEST_UID, member_ids=[TEST_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/regenerate-invite")
        assert resp.status_code == 200
        data = resp.json()
        assert data["inviteToken"] != ""
        assert data["inviteTokenExpiresAt"] is not None

        group_ref = db.collection("groups-dev").document(GROUP_ID)
        group_ref.update.assert_called_once()

    def test_non_owner_gets_403(self, client, mocker):
        group = make_group(owner=OTHER_UID, member_ids=[TEST_UID, OTHER_UID])
        db = build_db(group_doc=group)
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/regenerate-invite")
        assert resp.status_code == 403

    def test_not_found_returns_404(self, client, mocker):
        db = build_db(group_doc=make_doc(GROUP_ID, None))
        mocker.patch("groups.get_db", return_value=db)

        resp = client.post(f"/api/groups/{GROUP_ID}/regenerate-invite")
        assert resp.status_code == 404
