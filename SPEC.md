# Photo Album App — Project Specification (V1)

## Overview

A mobile-first personal photo & video album web app with group sharing support.
Users can upload photos and videos, organize them into albums, control visibility,
and share albums with members of one or more groups.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (mobile web, PWA-ready) |
| Backend | Python 3, GCP Cloud Functions (HTTP + Event triggers) |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Firestore |
| File Storage | GCP Cloud Storage |
| Thumbnail Generation | Cloud Functions — Storage trigger (Pillow for images, ffmpeg for videos) |
| Hosting | Firebase Hosting (frontend) + Cloud Functions (backend) |
| Infrastructure | Terraform |
| Deployment | GCP Cloud Deploy |
| Frontend Testing | Jest + Angular Testing Library |
| Backend Testing | pytest |

---

## Project Directory Structure

```
/
├── frontend/                        — Angular 21 app
│   └── src/app/
│       ├── core/
│       │   ├── auth/                — Firebase auth service, auth guard
│       │   ├── services/            — AlbumService, MediaService, GroupService
│       │   └── models/              — TypeScript interfaces (Album, Media, Group, User)
│       ├── features/
│       │   ├── auth/                — login page
│       │   ├── home/                — public album feed (anonymous accessible)
│       │   ├── albums/
│       │   │   ├── album-list/      — three-section album listing
│       │   │   ├── album-detail/    — 5-column media grid
│       │   │   └── album-form/      — create / edit album
│       │   ├── media/
│       │   │   ├── upload/          — multi-file upload UI (max 50)
│       │   │   └── viewer/          — photo lightbox + video player + swipe
│       │   └── groups/
│       │       ├── group-detail/    — group info + member list
│       │       └── group-join/      — /join?token=xxx landing page
│       └── shared/
│           └── components/          — thumbnail-card, upload-progress, avatar, etc.
│
├── backend/                         — Python Cloud Functions
│   └── functions/
│       ├── albums/                  — album CRUD endpoints
│       ├── media/                   — media endpoints + upload-url
│       ├── groups/                  — group endpoints
│       └── thumbnail/               — Storage trigger: thumbnail + metadata
│
├── infra/                           — Terraform
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.dev.tfvars
│   ├── terraform.prod.tfvars
│   └── modules/
│       ├── firestore/
│       ├── storage/
│       ├── functions/               — IAM, triggers, secrets only (no code)
│       ├── firebase_hosting/
│       └── cloud_deploy/
│
└── clouddeploy/                     — GCP Cloud Deploy
    ├── clouddeploy.yaml             — pipeline and targets definition
    └── skaffold.yaml                — build and deploy manifests
```

---

## Features — V1 Scope

### Authentication
- Google Sign-In via Firebase Auth
- Sign out
- Anonymous browsing of public albums (no login required)

### Albums
- Create / delete album
- Set album title and cover media
- Visibility (`public` | `group` | `private`) can be set at creation and **changed at any time**
- Browse albums in three separated sections (see Album List UX)

### Media
- Upload photos (JPEG, PNG, WebP, HEIC) and videos (mp4, mov) — up to 50 files per batch, 30MB per file
- Each media item has an optional description, editable after upload
- Thumbnail auto-generated via Storage trigger (400px width for photos, first frame for videos)
- EXIF / metadata parsed on upload and persisted to Firestore
- Media ID is the SHA-256 hash of the file content (natural deduplication within an album)

### Groups
- Create a group and generate an invite link (valid 24 hours)
- Owner can regenerate invite token at any time (invalidates previous link)
- Join a group via invite link; a user can belong to multiple groups
- Leave a group (media and albums are preserved)
- View group members list

---

## Firestore Data Model

### `users/{uid}`
```
uid:         string       — Firebase UID
displayName: string
email:       string
photoURL:    string
groupIds:    string[]     — IDs of groups the user belongs to
createdAt:   timestamp
```

### `groups/{groupId}`
```
id:                   string
name:                 string
ownerId:              string    — uid of creator
memberIds:            string[]
inviteToken:          string    — unique token for invite link (regeneratable by owner)
inviteTokenExpiresAt: timestamp — always 24 hours from token generation / regeneration
createdAt:            timestamp
```

### `albums/{albumId}`
```
id:           string
title:        string
coverMediaId: string | null
ownerId:      string         — uid of creator
ownerType:    "user" | "group"
groupId:      string | null  — set when ownerType == "group"
visibility:   "public" | "group" | "private"
mediaCount:   number         — updated via FieldValue.increment() for atomicity
createdAt:    timestamp
updatedAt:    timestamp
```

### `albums/{albumId}/media/{mediaId}`
```
id:              string        — SHA-256 hash of the file content
type:            "photo" | "video"
storagePath:     string        — GCS path to original file
thumbnailPath:   string | null — GCS path to thumbnail; null until Storage trigger completes
uploaderId:      string        — uid
description:     string | null — user-provided caption, editable after upload

— Dimensions & duration
width:           number
height:          number
duration:        number | null — video duration in seconds; null for photos

— Parsed metadata (from EXIF / video container)
takenAt:         timestamp | null — EXIF DateTimeOriginal (photo) or video creation time
takenPlace: {                     — null if no GPS data available
  lat:           number
  lng:           number
  placeName:     string | null    — reverse-geocoded via Google Maps Geocoding API
} | null

— Status & timestamps
thumbnailStatus: "pending" | "ready" | "failed"
                              — "pending" is written by the upload-url endpoint when
                                creating the Firestore doc; updated to "ready" or "failed"
                                by the Storage trigger
createdAt:       timestamp    — written by upload-url endpoint on doc creation
updatedAt:       timestamp    — updated on any field change
```

---

## Access Control Rules

| Resource | Who can read | Who can update | Who can delete |
|---|---|---|---|
| `public` album | Anyone (anonymous OK) | Owner only | Owner only; only when `mediaCount == 0` |
| `group` album | Group members only | Owner only (album fields); group members (media description) | Owner only; only when `mediaCount == 0` |
| `private` album | Owner only | Owner only | Owner only; only when `mediaCount == 0` |
| Media in album | Inherits album visibility | Uploader or album owner | Uploader or album owner; blocked if media is current cover |

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuth() {
      return request.auth != null;
    }

    function isOwner(resource) {
      return isAuth() && request.auth.uid == resource.data.ownerId;
    }

    function isGroupMember(groupId) {
      return isAuth() &&
        request.auth.uid in
          get(/databases/$(database)/documents/groups/$(groupId)).data.memberIds;
    }

    function canReadAlbum(album) {
      return album.data.visibility == 'public'
        || (isAuth() && album.data.ownerId == request.auth.uid)
        || (album.data.visibility == 'group' && isGroupMember(album.data.groupId));
    }

    match /users/{uid} {
      allow read, write: if isAuth() && request.auth.uid == uid;
    }

    match /groups/{groupId} {
      allow read: if isAuth() && isGroupMember(groupId);
      allow create: if isAuth();
      allow update, delete: if isOwner(resource);
    }

    match /albums/{albumId} {
      allow read: if canReadAlbum(resource);
      allow create: if isAuth();
      allow update: if isOwner(resource);
      allow delete: if isOwner(resource) && resource.data.mediaCount == 0;

      match /media/{mediaId} {
        allow read: if canReadAlbum(
          get(/databases/$(database)/documents/albums/$(albumId)));
        allow create: if isAuth();
        allow update: if isAuth() && (
          request.auth.uid == resource.data.uploaderId ||
          request.auth.uid ==
            get(/databases/$(database)/documents/albums/$(albumId)).data.ownerId
        );
        allow delete: if isAuth() && (
          request.auth.uid == resource.data.uploaderId ||
          request.auth.uid ==
            get(/databases/$(database)/documents/albums/$(albumId)).data.ownerId
        );
      }
    }
  }
}
```

> **Note:** The cover-photo check on media deletion and the `mediaCount == 0` check on album deletion are enforced at the Cloud Functions layer, not in Firestore rules, because they require cross-document reads that would be too expensive in rules.

---

## API Error Codes

All error responses follow this structure:

```json
{
  "error": {
    "code": "ALBUM_NOT_EMPTY",
    "message": "Human-readable description",
    "status": 400
  }
}
```

| Code | HTTP Status | Trigger | Frontend message |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid token on an auth-required endpoint | "Please sign in to continue." |
| `PERMISSION_DENIED` | 403 | Authenticated user lacks permission | "You don't have permission to do that." |
| `NOT_GROUP_MEMBER` | 403 | Accessing a group album without membership | "This album is only visible to group members." |
| `ALBUM_NOT_FOUND` | 404 | Album does not exist | "Album not found." |
| `MEDIA_NOT_FOUND` | 404 | Media item does not exist | "This item no longer exists." |
| `GROUP_NOT_FOUND` | 404 | Group does not exist | "Group not found." |
| `ALBUM_NOT_EMPTY` | 400 | Deleting an album that still has media | "This album still has {n} item(s). Remove all media before deleting." |
| `MEDIA_IS_COVER` | 400 | Deleting media that is the current album cover | "This item is the album cover. Change the cover before deleting it." |
| `INVITE_TOKEN_INVALID` | 400 | Token does not exist | "This invite link is invalid." |
| `INVITE_TOKEN_EXPIRED` | 400 | Token exists but older than 24 hours | "This invite link has expired. Ask the group owner for a new one." |
| `ALREADY_IN_GROUP` | 409 | User is already a group member | "You're already a member of this group." |

> **Note:** File size, format, and batch count violations are validated client-side only. The backend returns a plain `400 Bad Request` if these are bypassed directly via API.

---

## Cloud Functions — HTTP Endpoints

All authenticated endpoints require:
`Authorization: Bearer <firebase_id_token>`

### Albums

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/albums` | Optional | List albums grouped by section: `mine` / `shared` / `public`. Anonymous: `public` only |
| GET | `/albums/{albumId}` | Optional | Get album detail (respects visibility) |
| POST | `/albums` | Required | Create album |
| PATCH | `/albums/{albumId}` | Required | Update title / cover / visibility — owner only |
| DELETE | `/albums/{albumId}` | Required | Delete album — owner only; returns `ALBUM_NOT_EMPTY` if `mediaCount > 0` |

### Media

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/albums/{albumId}/media` | Optional | List media with cursor-based pagination. Query params: `limit` (default 30), `after` (mediaId cursor). Returns `{ items: Media[], nextCursor: string \| null }` |
| POST | `/albums/{albumId}/media/upload-url` | Required | Request signed GCS upload URLs. Creates Firestore media docs with `thumbnailStatus: "pending"`. Body: `[{ sha256, mimeType, filename, size }]`; max 50 items; rejects any `size > 30MB`; URLs expire in 15 min |
| PATCH | `/albums/{albumId}/media/{mediaId}` | Required | Update `description` — uploader or album owner only |
| DELETE | `/albums/{albumId}/media/{mediaId}` | Required | Delete media — uploader or album owner only; returns `MEDIA_IS_COVER` if media is current cover |

### Groups

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me/groups` | Required | List all groups the current user belongs to |
| POST | `/groups` | Required | Create group |
| GET | `/groups/{groupId}` | Required | Get group info — members only |
| GET | `/groups/{groupId}/members` | Required | List members — members only |
| POST | `/groups/join` | Required | Join via `{ inviteToken }` — returns `INVITE_TOKEN_INVALID` or `INVITE_TOKEN_EXPIRED` |
| POST | `/groups/{groupId}/leave` | Required | Leave group — removes caller from `memberIds`; media and albums preserved |
| POST | `/groups/{groupId}/regenerate-invite` | Required | Owner only — new `inviteToken` + fresh 24h expiry; invalidates previous token |

---

## Cloud Functions — Storage Trigger

### `generateThumbnailAndMetadata` (onObjectFinalized)

Triggered when a file lands in GCS. `retry_on_failure = true` is set in Terraform.
The function is idempotent — safe to re-run (thumbnail overwritten, Firestore merge-written).

**GCS path convention:**
```
original:  media/{uid}/{albumId}/{mediaId}/original.{ext}
thumbnail: media/{uid}/{albumId}/{mediaId}/thumbnail.jpg
```

**Full upload flow:**
```
1. Client computes SHA-256 per file (browser SubtleCrypto API)
2. POST /albums/{albumId}/media/upload-url  [{ sha256, mimeType, filename, size }]
3. Backend creates Firestore media doc: thumbnailStatus "pending", createdAt = now()
4. Backend returns signed GCS URLs keyed by sha256 (15 min expiry)
5. Client uploads files directly to GCS via signed URLs
6. GCS triggers generateThumbnailAndMetadata per file
```

**Processing logic:**
1. Verify path matches `media/{uid}/{albumId}/{mediaId}/original.*`
2. Determine type by MIME type
3. **Thumbnail generation:**
   - Photo: **Pillow** (register **pillow-heif** opener first for HEIC) → resize to 400px width → save as JPEG
   - Video: **ffmpeg** → extract frame at 00:00:01 → save as JPEG
4. Upload thumbnail to `media/{uid}/{albumId}/{mediaId}/thumbnail.jpg`
5. **Metadata extraction:**
   - Photo: **piexif** → `takenAt` from `DateTimeOriginal`; `takenPlace.lat/lng` from GPS IFD tags; `width`/`height` from image dimensions
   - Video: **ffprobe** → `takenAt` from `creation_time`; `takenPlace.lat/lng` from `location` tag; `width`/`height`/`duration` from stream info
   - If GPS present: **Google Maps Geocoding API** → `takenPlace.placeName`
6. Merge Firestore doc: `thumbnailPath`, `thumbnailStatus: "ready"`, `width`, `height`, `duration`, `takenAt`, `takenPlace`, `updatedAt`
7. `FieldValue.increment(1)` on `albums/{albumId}.mediaCount`

**Error handling:**
```python
def generate_thumbnail_and_metadata(event):
    try:
        process(event)
    except (InvalidFileFormatError, CorruptedFileError) as e:
        # Unrecoverable — mark failed, return without raising (avoids infinite retry)
        logging.error(f"Unrecoverable: {e}")
        update_firestore(media_id, {"thumbnailStatus": "failed", "updatedAt": now()})
        return
    except Exception as e:
        # Recoverable — raise to trigger Eventarc retry
        raise
```

---

## Frontend UX

### Album List — Three Sections

Rendered on both Home and My Albums pages. Each section shown only if non-empty.

| Section heading | Visible to | Contents |
|---|---|---|
| "My Albums" | Authenticated users | `ownerId == currentUser.uid` (any visibility) |
| "Shared with Me" | Authenticated users | `visibility == "group"` + user is a group member (excludes own albums) |
| "Public Albums" | Everyone (anonymous OK) | `visibility == "public"` (excludes own albums to avoid duplication) |

### Album Detail — Media Grid

- 5-column thumbnail grid
- Video cells show a play icon overlay
- `thumbnailStatus == "pending"` → grey placeholder with loading spinner; Firestore real-time listener swaps in thumbnail automatically when status becomes `"ready"`
- `thumbnailStatus == "failed"` → broken-image icon; no retry UI in V1
- `coverMediaId == null` → album card shows a generic placeholder image

**Infinite scroll:**
- Default page size: 30 items, ordered by `createdAt` descending (newest first)
- Use **Intersection Observer** to detect when the last row of thumbnails enters the viewport
- On enter: automatically fetch `GET /albums/{albumId}/media?limit=30&after={lastCursor}`
- Loading state: show a row of 5 skeleton placeholder cells (animated grey shimmer) below the last row
- All loaded (`nextCursor == null`): no indicator shown; list ends naturally
- Load failure: show an inline text button "Failed to load. Tap to retry."

### Media Viewer

Opened by tapping any thumbnail.

**Layout (top → bottom):**
1. Full-screen media — original photo (pinch-to-zoom) or HTML5 `<video>` player
2. Description + metadata (`takenAt`, `takenPlace`)
3. Thumbnail strip — 5 thumbnails centred on current item; active item highlighted

**Navigation:**
- Swipe left / right → next / previous with horizontal slide (ease-out ~250ms)
- Thumbnail strip scrolls in sync; tapping a thumbnail jumps directly to that item
- Arrow buttons as fallback for non-touch devices
- Boundary bounce-back: only triggered when `nextCursor == null` and the user is already on the last item; if more pages are available or currently loading, do not bounce

**Infinite swipe — background preload:**
- Viewer shares the already-loaded `mediaList` from the album detail page (no separate fetch)
- When the user's current position is **5 items from the end** of the loaded list, automatically trigger a background fetch for the next page (non-blocking)
- On success: append new items to `mediaList`; thumbnail strip extends automatically
- Loading state: show 1 skeleton thumbnail cell at the end of the strip (spinner)
- `nextCursor == null`: no further preload; bounce-back triggers normally on the last item

### Key Interaction Flows

**Change visibility:** Album settings → Visibility picker (Public / Group / Private) → if Group, select which group → `PATCH /albums/{albumId}`

**Delete album:** Delete button always visible → if `mediaCount > 0`, backend returns `ALBUM_NOT_EMPTY` → show *"This album still has {n} item(s). Remove all media before deleting."*

**Delete media:** If media is cover, backend returns `MEDIA_IS_COVER` → show *"This item is the album cover. Change the cover before deleting it."*

**Upload validation (client-side, before any API call):**
- File > 30MB → reject with inline error per file
- Unsupported format → reject; file picker `accept` attribute + JS validation fallback
- Batch > 50 → truncate to 50 with a notice

---

## Testing Guidelines

### Backend — pytest

Co-locate test files with source:
```
backend/functions/albums/main.py
backend/functions/albums/test_main.py
```

**What to test:**
- Happy path for every HTTP endpoint
- All permission checks: unauthenticated, wrong user, non-member accessing group album
- Every error code path (`ALBUM_NOT_EMPTY`, `MEDIA_IS_COVER`, `INVITE_TOKEN_EXPIRED`, etc.)
- `generateThumbnailAndMetadata`: recoverable vs unrecoverable errors; `thumbnailStatus` transitions (`pending` → `ready` / `failed`)
- `mediaCount` increment / decrement atomicity

**Mocking strategy:**
- Unit tests: `pytest-mock` for Firestore, GCS, and Firebase Admin SDK token verification
- Integration tests: Firebase Local Emulator Suite (separate suite, not in CI by default)

**Minimum coverage: 80%**

---

### Frontend — Jest + Angular Testing Library

Co-locate test files with source:
```
albums/album-list/album-list.component.ts
albums/album-list/album-list.component.spec.ts
core/services/album.service.ts
core/services/album.service.spec.ts
```

**What to test:**

*Services:* all API methods (mock `HttpClient`); each error code maps to correct user-facing message; auth state changes

*Components:*
- Placeholder renders correctly for `thumbnailStatus` `pending` / `failed`
- Album deletion blocked when `mediaCount > 0` — correct message shown
- Media deletion blocked when media is cover — correct message shown
- Upload validation: >30MB rejected, unsupported format rejected, >50 truncated
- Three-section list renders correctly for authenticated vs anonymous users
- Viewer: swipe navigation, thumbnail strip sync, boundary bounce-back

**Mocking strategy:** `HttpClientTestingModule`; stub `AuthService`; `TestBed` with standalone imports; `BehaviorSubject` stubs for Firestore real-time listeners

**Minimum coverage: 80%**

---

## Infrastructure — Terraform

All GCP resources managed by Terraform. Nothing created manually via GCP Console.

**Managed resources:** GCP project & APIs, Firestore, GCS buckets, Cloud Functions infrastructure, IAM, Firebase Hosting, Cloud Deploy pipeline, Secret Manager secrets

**Cloud Functions split responsibility:**

| Concern | Managed by |
|---|---|
| IAM service account + role bindings | Terraform |
| Event trigger + Storage bucket binding | Terraform |
| Secret Manager references / env var keys | Terraform |
| `retry_on_failure` for Storage trigger | Terraform |
| Function code packaging + deployment | Cloud Deploy |
| dev → prod promotion | Cloud Deploy |

**Environments:** `dev` and `prod` use separate Terraform workspaces with separate `.tfvars` files.

---

## Deployment — GCP Cloud Deploy

Triggered by Cloud Build on every merge to `main`.

```
Cloud Build → Deploy to dev → Manual approval → Deploy to prod
```

- **Frontend:** `ng build --configuration=production` → Firebase Hosting
- **Backend:** Cloud Build packages each function → `gcloud functions deploy` per function
- Skaffold used as delivery manifest format (`clouddeploy/skaffold.yaml`)

---

## Angular 21 Implementation Guidelines

**Use:**
- Standalone components (no `NgModule`; each component has its own `imports` array)
- `signal()`, `computed()`, `effect()` for state; RxJS only for HTTP and async event streams
- `input()` / `output()` signal-based APIs (not `@Input()` / `@Output()` decorators)
- `inject()` for dependency injection (not constructor parameter injection)
- `@if` / `@for` / `@switch` built-in control flow syntax
- `HttpClient` with typed responses; no `any`
- `DestroyRef` + `takeUntilDestroyed` for subscription lifecycle
- `@defer` for lazy-loading heavy components (media viewer, upload UI)
- Typed `Router.navigate()` params

**Avoid:**
- `NgModule`, `CommonModule`
- `@Input()` / `@Output()` decorators
- `ngOnDestroy` + `Subject` takeUntil pattern
- `*ngIf` / `*ngFor` structural directives
- Constructor-based dependency injection

---

## GCS Bucket Structure

```
gs://{project-id}-media/
  media/
    {uid}/
      {albumId}/
        {mediaId}/
          original.{ext}   — private; accessed via backend-generated signed URLs
          thumbnail.jpg    — public read (fast grid loading)
```

---

## Environment Variables

Stored in Secret Manager; referenced via Terraform.

```
GCP_PROJECT_ID
GCS_BUCKET_NAME
GEOCODING_API_KEY          — Google Maps Geocoding API key
FIREBASE_SERVICE_ACCOUNT   — for Admin SDK (if needed outside GCP)
```

---

## Suggested Development Order

### Phase 1 — Foundation
1. Terraform scaffold: modules, dev workspace, enable GCP APIs
2. Provision Firestore, GCS, Firebase Auth via Terraform
3. Cloud Deploy pipeline (dev target only)
4. Firebase Auth: Google Sign-In — frontend + backend token verification
5. Firestore security rules (full ruleset as defined above)
6. Angular scaffold: routing, auth guard, bottom nav (standalone + signals)

### Phase 2 — Core Album Flow
7. Album CRUD endpoints + frontend (create, list, detail, delete)
8. `upload-url` endpoint (30MB guard, 15min expiry, creates `thumbnailStatus: "pending"` doc)
9. Frontend multi-file upload UI with client-side validation
10. Storage trigger: image thumbnails (Pillow + pillow-heif for HEIC)
11. Album detail: 5-column grid, placeholder states, real-time `thumbnailStatus` listener

### Phase 3 — Video Support
12. Extend upload to mp4 / mov
13. Storage trigger: video thumbnail (ffmpeg) + metadata (ffprobe)
14. Media viewer: HTML5 player, swipe navigation, thumbnail strip

### Phase 4 — Groups
15. Group creation + invite token (24h expiry)
16. Join-by-link + leave group
17. Regenerate invite token endpoint
18. Group album visibility (backend enforcement + Firestore rules)
19. Group list page + group detail UI

### Phase 5 — Polish
20. EXIF metadata + Google Maps reverse geocoding
21. Album cover photo + placeholder
22. Error handling, loading states, empty states for all flows
23. Mobile UX: gestures, transitions, viewer bounce-back

### Throughout all phases
- Write unit tests alongside each feature
- Maintain ≥80% coverage per module
- Add Firebase emulator integration tests at end of each phase

---

## Out of Scope (V2)

- Search (by date, location, tag)
- External share links
- Email invitations to groups
- Photo drag-and-drop reordering
- Comments / reactions
- Multipart upload for files > 30MB
- Group dissolution
- Offline / PWA service worker caching
