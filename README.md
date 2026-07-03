# My Digital Album

A full-stack photo and video sharing app built on Google Cloud Platform. Upload media, organize it into albums, generate thumbnails automatically, and share with friends via invite links.

## Features

- **Albums** — create public or private albums; manage members with read/write permissions
- **Media** — upload photos (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV), up to 50 files × 500 MB each (files over 30 MB use a resumable upload session)
- **Auto-thumbnails** — Cloud Storage trigger generates thumbnails and extracts EXIF/video metadata on upload
- **Album sharing** — invite people to albums via time-limited tokens; manage member permissions
- **Real-time** — Firestore-backed live updates in the frontend
- **Google Sign-In** — Firebase Auth with Google provider

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21, TypeScript, Firebase SDK |
| Backend API | Python 3.12, FastAPI, Cloud Run |
| Thumbnail worker | Python 3.12, Pillow, Cloud Run (Eventarc-triggered, Functions Framework) |
| Database | Firestore |
| Storage | Cloud Storage (private media + public thumbnails) |
| Auth | Firebase Authentication |
| Hosting | Firebase Hosting |
| IaC | Terraform |
| CI/CD | Cloud Build |

## Project Structure

```
my-digital-album/
├── frontend/               # Angular 21 SPA
│   └── src/app/
│       ├── core/           # Auth, services, models
│       ├── features/       # albums/, media/, auth/, invite/
│       └── shared/         # Reusable components
├── backend/functions/
│   ├── api/                # FastAPI app (albums, media endpoints)
│   └── thumbnail/          # Storage-triggered thumbnail generator
├── infra/                  # Terraform modules
│   └── modules/            # firestore, storage, functions, firebase_hosting, cicd
├── cloudrun/               # Cloud Run service manifests (api.yaml, thumbnail.yaml)
├── firestore.rules         # Firestore security rules
├── firebase.json           # Firebase Hosting config
└── cloudbuild.yaml         # CI/CD pipeline definition
```

## Architecture

```
User → Firebase Hosting → Angular SPA
                              │
                              ├── Firebase Auth (Google Sign-In)
                              ├── Firestore (real-time reads)
                              └── /api/** → Cloud Run (FastAPI)
                                               │
                                               ├── Firestore (writes)
                                               └── Cloud Storage (signed URLs)
                                                         │
                                                         └── Eventarc trigger
                                                               → thumbnail/ (Cloud Run service)
                                                                     └── Firestore (metadata)
```

## Prerequisites

- Node 22+ (use `nvm use 22`)
- Python 3.12+
- Docker (with `--platform linux/amd64` for Apple Silicon)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- [Firebase CLI](https://firebase.google.com/docs/cli) — `npm install -g firebase-tools`
- [Terraform](https://developer.hashicorp.com/terraform/install)

## Local Development

### Frontend

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd frontend
npm ci
ng serve
```

The app runs at `http://localhost:4200`. Firebase config is in `src/environments/environment.development.ts` (gitignored — create from your Firebase project settings).

### Backend API

```bash
cd backend/functions
pip install -r api/requirements.txt -r requirements-test.txt
uvicorn api.main:app --reload --port 8080
```

### Thumbnail Function (local testing)

```bash
pip install -r thumbnail/requirements.txt
# Invoke manually via Functions Framework or Cloud Run local emulator
```

## Running Tests

### Backend

```bash
cd backend/functions
python -m pytest                         # all tests
python -m pytest api/test_albums.py -v  # specific suite
ruff check . && ruff format --check .   # lint / format check
```

### Frontend

```bash
cd frontend
npm test                    # unit tests (Karma + Jasmine, headless Chrome)
npm run e2e                 # Playwright E2E tests (headless)
npm run e2e:headed          # E2E with browser visible
npm run e2e:report          # open last Playwright report
ng lint                     # ESLint
```

## Infrastructure

Infrastructure is managed with Terraform. Environments are distinguished by resource name suffix (`-dev` / `-prod`).

```bash
cd infra
terraform init -backend-config="bucket=my-digital-album-tfstate" \
               -backend-config="prefix=terraform/state/dev"
terraform apply -var-file=terraform.dev.tfvars
```

> **Note:** Apply with `create_triggers=false` first. Once all Cloud Run services are running, apply again with `create_triggers=true` to enable Eventarc triggers.

### GCP Resources

| Resource | Dev | Prod |
|---|---|---|
| Firestore | single `(default)` database; collections prefixed `albums-dev`/`users-dev` | prefixed `albums-prod`/`users-prod` |
| Media bucket | `my-digital-album-media-dev` | `my-digital-album-media-prod` |
| Thumbnails bucket | `my-digital-album-thumbnails-dev` | `my-digital-album-thumbnails-prod` |
| Artifact Registry | `functions-dev` | `functions-prod` |
| Cloud Run services | `api-dev`, `thumbnail-dev` | `api-prod`, `thumbnail-prod` |

## Deployment

### CI/CD (Cloud Build)

The `cloudbuild.yaml` pipeline runs automatically on push:
1. Backend tests (pytest) + lint (ruff) + security audit (pip-audit)
2. Frontend unit tests + lint + E2E (Playwright) + production build
3. Firestore rules deploy + Firebase Hosting deploy
4. Docker build + push to Artifact Registry, then deploy each service to Cloud Run via `gcloud run services replace`

## API Reference

All endpoints are prefixed with `/api` and require a Firebase ID token in the `Authorization: Bearer <token>` header (except publicly readable album endpoints).

### Albums

| Method | Path | Description |
|---|---|---|
| `GET` | `/albums` | List albums grouped by `mine` / `shared` / `public` |
| `POST` | `/albums` | Create album |
| `GET` | `/albums/{id}` | Get album details |
| `PATCH` | `/albums/{id}` | Update title / cover / visibility |
| `DELETE` | `/albums/{id}` | Delete album (owner, empty only) |
| `GET` | `/albums/{id}/members` | List members |
| `POST` | `/albums/{id}/members` | Add a member by email; grants access directly if the user already exists, otherwise generates a 24-hour invite token |
| `PATCH` | `/albums/{id}/members/{email}` | Update a member's permission |
| `DELETE` | `/albums/{id}/members/{email}` | Remove member |
| `POST` | `/albums/{id}/accept-invite` | Join album via invite token |

### Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/albums/{id}/media` | List media (cursor-paginated, default 30/page) |
| `GET` | `/albums/{id}/media/{mediaId}/original-url` | Get a signed GCS read URL for the original file |
| `PATCH` | `/albums/{id}/media/{mediaId}` | Update description |
| `DELETE` | `/albums/{id}/media/{mediaId}` | Delete media |
| `POST` | `/albums/{id}/media/upload-url` | Generate GCS upload URLs (signed PUT, or a resumable session above 30 MB) |
| `GET` | `/thumbnail/{path}` | Redirect to the public thumbnail object in Cloud Storage |

## Environment Variables

Backend Cloud Run services receive these at runtime (injected via Cloud Run environment config):

| Variable | Description |
|---|---|
| `GCP_PROJECT_ID` | GCP project ID |
| `ENVIRONMENT` | Environment (`dev` or `prod`) |
| `MEDIA_BUCKET` | GCS bucket for raw media uploads |
| `THUMBNAILS_BUCKET` | GCS bucket for generated thumbnails |
| `GEOCODING_API_KEY` | Google Maps Geocoding API key (thumbnail service only; sourced from Secret Manager) |
| `UPLOAD_ALLOWED_ORIGINS` | Optional comma-separated allowlist for resumable-upload CORS origin binding (api service only) |

## Firestore Security Rules

Rules in `firestore.rules` enforce:
- Public albums are readable without auth
- Private albums are accessible only to the owner and listed `memberIds`
- All writes require authentication
- Media inherits its parent album's read/write rules
