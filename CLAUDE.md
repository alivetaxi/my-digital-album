# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A full-stack photo/video album app: Angular 21 frontend, Python/FastAPI backend on Cloud Run, Firestore, Cloud Storage, Firebase Auth/Hosting, Terraform for infra. See `README.md` for the full architecture diagram, API reference, and deployment commands.

Album sharing is **member-based**: albums have a `memberIds` array and a `members` map (uid → `{permission: "read"|"write"}`). `POST /albums/{id}/members` grants access directly if the invited email already has an account, otherwise it generates a 24-hour invite token that the invitee redeems via `POST /albums/{id}/accept-invite`. There is no `groups` feature in this codebase.

## Commands

### Backend (`backend/functions/`)
```bash
cd backend/functions
pip install -r api/requirements.txt -r requirements-test.txt
python -m pytest                    # all tests (pythonpath=. ; testpaths = api thumbnail)
python -m pytest api/test_albums.py -v   # single suite
python -m pytest api/test_albums.py::test_name -v   # single test
ruff check . && ruff format --check .
uvicorn api.main:app --reload --port 8080   # run the combined API locally
```

### Frontend (`frontend/`)
```bash
source ~/.nvm/nvm.sh && nvm use 22   # Angular 21 requires Node 22
cd frontend
npm ci
ng serve                             # http://localhost:4200
npm test                             # Karma + Jasmine, headless Chrome
npm test -- --include='**/album.service.spec.ts'   # single spec
ng lint
npm run e2e                          # Playwright, spawns its own `ng serve --configuration=e2e`
npm run e2e:headed
npm run e2e:report
```
Firebase config is read from `src/environments/environment.development.ts` (gitignored, real keys) locally, and `environment.e2e.ts` (demo project + Firebase Auth Emulator, no real keys) for e2e in CI.

## Architecture

### Backend: one FastAPI app, two Cloud Run services from the same image family
`backend/functions/api/` is a single FastAPI app (`main.py`) mounted at `root_path="/api"` that combines the albums and media routers, deployed as one Cloud Run service (`api-dev`/`api-prod`) — there are **not** separate albums/media services. `backend/functions/thumbnail/` is a second, separate Cloud Run service (`thumbnail-dev`/`thumbnail-prod`) triggered by Eventarc on Cloud Storage `finalize` events; it is not part of the FastAPI app.

- `api/albums.py` — album CRUD, membership (`/members`), invite-token issuance and redemption (`/accept-invite`)
- `api/media.py` — media listing/pagination, `upload-url` (resumable GCS session), `original-url` (signed read URL), description updates, delete
- `api/thumbnail_proxy.py` — `GET /thumbnail/{path}` redirects to the public thumbnail object
- `thumbnail/main.py` — Storage-triggered worker: Pillow (+ pillow-heif for HEIC) for photo thumbnails, ffmpeg/ffprobe for video thumbnails + metadata, EXIF/GPS extraction, Google Maps Geocoding reverse-lookup, then merges results into the Firestore media doc and increments `albums/{id}.mediaCount`
- `shared/` — code shared by both services: `auth.py` (Firebase ID token verification via `get_uid`/`require_auth` FastAPI dependencies), `db.py` (Firestore client singleton + `get_col()` for env-scoped collection names), `access.py` (`can_read_album`/`can_write_album`/`get_member_permission` — the single source of truth for album permission logic, used identically by the API and the thumbnail worker), `storage.py` (GCS signed URL / resumable upload session helpers), `errors.py` (`error_response()` — maps error codes to the `{error: {code, message, status}}` envelope)

Env vars actually read by the code (not all match README's table — code is authoritative): `GCP_PROJECT_ID`, `ENVIRONMENT` (`dev`/`prod`, defaults to `dev`), `MEDIA_BUCKET`, `THUMBNAILS_BUCKET`, `GEOCODING_API_KEY`, `UPLOAD_ALLOWED_ORIGINS`.

**Environment isolation**: dev and prod share one Firestore database and one GCP project, distinguished purely by name suffix — `get_col("albums")` returns `albums-dev` or `albums-prod` depending on `ENVIRONMENT`. `firestore.rules` duplicates the full ruleset once per environment (`albums-dev`/`albums-prod`, `users-dev`/`users-prod`) rather than parameterizing — keep both blocks in sync when editing rules.

### Access control model
Album visibility is `public` | `private`. Reads: public albums are open to anyone; private albums require `ownerId == uid` or `uid` in `memberIds`. Writes: owner always; members need `permission == "write"` in the `members` map. This logic lives once in `shared/access.py` and is reused by both the FastAPI layer and Firestore security rules (`firestore.rules`) — when changing access semantics, update both, plus `access.py`'s docstring-level invariants.

### Frontend structure (Angular 21, standalone + signals)
Conventions in force throughout: no `NgModule`/`CommonModule`; `signal()`/`computed()`/`effect()` for state; `input()`/`output()` signal-based APIs (not `@Input()`/`@Output()` decorators); `inject()` (not constructor injection); `@if`/`@for`/`@switch` (not `*ngIf`/`*ngFor`); `DestroyRef` + `takeUntilDestroyed` for subscription cleanup.

- `core/auth/` — `AuthService`, `authGuard`
- `core/services/` — `AlbumService`, `MediaService` (typed HTTP clients)
- `core/models/` — shared TS interfaces
- `features/albums/` — list, detail, create/edit form, `album-access` (member/invite management UI)
- `features/media/` — multi-file `upload`, lightbox/video `viewer`
- `features/invite/` — `/join?token=...` invite-accept landing page
- `features/auth/login/` — Google Sign-In page
- `shared/components/` — `bottom-nav` and other reusable pieces

### E2E tests (`frontend/e2e/`)
Playwright, page-object pattern: `e2e/pages/*.page.ts` wrap each screen, `e2e/specs/*.spec.ts` are the scenarios, `e2e/fixtures/` holds `auth.fixture.ts` (Firebase Auth Emulator login), `api-mocks.ts`, and `test-data.ts`. Tests run against `ng serve --configuration=e2e` (demo Firebase project, no real backend calls needed for most flows since `api-mocks.ts` intercepts HTTP).

### Infra & deployment
Terraform (`infra/`) manages GCP resources for both environments from one project, selected via `-var-file=terraform.dev.tfvars` / `terraform.prod.tfvars`. `infra/modules/functions` provisions IAM/Eventarc/secrets only — it does not own function code deployment. Apply Eventarc triggers with `create_triggers=false` first, deploy the Cloud Run services, then re-apply with `create_triggers=true` (Eventarc needs the receiving service to already exist).

CI/CD (`cloudbuild.yaml`) deploys straight to Cloud Run via `gcloud run services replace` against templated manifests in `cloudrun/*.yaml` (env-substituted with `envsubst`) — there is no `clouddeploy/` directory or Skaffold pipeline in this repo. Docker images must be built with `--platform linux/amd64` (Cloud Run targets amd64; matters when building on Apple Silicon).

`cloudbuild.yaml` order: backend tests/lint/pip-audit and frontend tests/lint/npm-audit/e2e run in parallel → frontend build → Firestore rules deploy + Firebase Hosting deploy, and separately → Docker build/push for `api` and `thumbnail` → `gcloud run services replace` for each.
