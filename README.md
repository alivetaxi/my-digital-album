# My Digital Album

A full-stack photo and video sharing app built on Google Cloud Platform. Upload media, organize it into albums, generate thumbnails automatically, and share with friends via invite links.

## Features

- **Albums** — create public or private albums; manage members with viewer/contributor/editor permissions
- **Media** — upload photos (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV), up to 50 files × 30 MB each
- **Auto-thumbnails** — Cloud Storage trigger generates thumbnails and extracts EXIF/video metadata on upload
- **Album sharing** — invite people to albums via time-limited tokens; manage member permissions
- **Real-time** — Firestore-backed live updates in the frontend
- **Google Sign-In** — Firebase Auth with Google provider

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21, TypeScript, Firebase SDK |
| Backend API | Python 3.12, FastAPI, Cloud Run |
| Thumbnail worker | Python 3.12, Pillow, Cloud Functions (Eventarc) |
| Database | Firestore |
| Storage | Cloud Storage (private media + public thumbnails) |
| Auth | Firebase Authentication |
| Hosting | Firebase Hosting |
| IaC | Terraform |
| CI/CD | Cloud Build + Cloud Deploy |

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
├── clouddeploy/            # Skaffold + Cloud Deploy pipeline configs
├── cloudrun/               # Cloud Run service manifests
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
                                                               → thumbnail/ (Cloud Function)
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
python -m pytest test_albums.py -v      # specific suite
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
| Firestore | `album-dev` | `album-prod` |
| Media bucket | `my-digital-album-media-dev` | `my-digital-album-media-prod` |
| Thumbnails bucket | `my-digital-album-thumbnails-dev` | `my-digital-album-thumbnails-prod` |
| Artifact Registry | `functions-dev` | `functions-prod` |
| Cloud Run services | `albums-dev`, `media-dev`, `thumbnail-dev` | `*-prod` variants |

## Deployment

### Build & Push Docker Images

Build on Apple Silicon requires `--platform linux/amd64` (Cloud Run targets amd64).

```bash
cd backend/functions
for svc in albums media thumbnail; do
  docker build --platform linux/amd64 \
    -t asia-east1-docker.pkg.dev/my-digital-album/functions-dev/${svc}:latest \
    -f ${svc}/Dockerfile .
  docker push asia-east1-docker.pkg.dev/my-digital-album/functions-dev/${svc}:latest
done
```

### Cloud Deploy Release

```bash
cd clouddeploy
for svc in albums media thumbnail; do
  gcloud deploy releases create release-$(date +%Y%m%d-%H%M) \
    --delivery-pipeline=${svc}-pipeline-dev \
    --region=asia-east1 \
    --skaffold-file=skaffold-${svc}.yaml \
    --source=.
done
```

### Frontend

```bash
cd frontend
ng build --configuration=production
firebase deploy --only hosting:dev
```

### CI/CD (Cloud Build)

The `cloudbuild.yaml` pipeline runs automatically on push:
1. Backend tests (pytest) + lint (ruff) + security audit (pip-audit)
2. Frontend unit tests + lint + E2E (Playwright) + production build
3. Docker build + push to Artifact Registry
4. Cloud Deploy releases

## API Reference

All endpoints are prefixed with `/api` and require a Firebase ID token in the `Authorization: Bearer <token>` header (except publicly readable album endpoints).

### Albums

| Method | Path | Description |
|---|---|---|
| `GET` | `/albums` | List albums (mine / shared / public) |
| `POST` | `/albums` | Create album |
| `GET` | `/albums/{id}` | Get album details |
| `PATCH` | `/albums/{id}` | Update title / cover / visibility |
| `DELETE` | `/albums/{id}` | Delete album (owner, empty only) |
| `POST` | `/albums/{id}/invite` | Generate 24-hour invite token |
| `POST` | `/albums/{id}/accept-invite` | Join album via token |
| `POST` | `/albums/{id}/members/{uid}` | Add / update member permission |
| `DELETE` | `/albums/{id}/members/{uid}` | Remove member |

### Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/albums/{id}/media` | List media (paginated, 30/page) |
| `GET` | `/albums/{id}/media/{mediaId}` | Get media details |
| `PATCH` | `/albums/{id}/media/{mediaId}` | Update description |
| `POST` | `/albums/{id}/media/upload-urls` | Generate resumable GCS upload URLs |
| `GET` | `/media/{mediaId}/thumbnail` | Proxy thumbnail from Cloud Storage |

## Environment Variables

Backend Cloud Run services receive these at runtime (injected via Cloud Run environment config):

| Variable | Description |
|---|---|
| `GCP_PROJECT` | GCP project ID |
| `ENV` | Environment (`dev` or `prod`) |
| `MEDIA_BUCKET` | GCS bucket for raw media uploads |
| `THUMBNAIL_BUCKET` | GCS bucket for generated thumbnails |
| `FIREBASE_SA_SECRET` | Secret Manager secret name for Firebase Admin credentials |

## Firestore Security Rules

Rules in `firestore.rules` enforce:
- Public albums are readable without auth
- Private albums are accessible only to the owner and listed `memberIds`
- All writes require authentication
- Media inherits its parent album's read/write rules
