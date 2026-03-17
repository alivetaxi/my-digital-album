locals {
  # Cloud Build's default service account
  cloudbuild_sa = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

data "google_project" "project" {
  project_id = var.project_id
}

# Artifact Registry repo for Docker images
resource "google_artifact_registry_repository" "functions" {
  project       = var.project_id
  location      = var.region
  repository_id = "functions-${var.environment}"
  description   = "Docker images for backend functions (${var.environment})"
  format        = "DOCKER"
  labels = {
    app         = "my-digital-album"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# Push images to Artifact Registry
resource "google_project_iam_member" "cloudbuild_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = local.cloudbuild_sa
}

resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = local.cloudbuild_sa
}

# Deploy to Firebase Hosting
resource "google_project_iam_member" "cloudbuild_firebase_hosting" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = local.cloudbuild_sa
}

# Read secrets (e.g. firebase-config-prod for environment.ts)
resource "google_project_iam_member" "cloudbuild_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = local.cloudbuild_sa
}

# Allow Cloud Build SA to impersonate the functions service account
# (Cloud Deploy requires actAs permission on the SA used by the Cloud Run service)
resource "google_service_account_iam_member" "cloudbuild_actAs_functions_sa" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/functions-sa-${var.environment}@${var.project_id}.iam.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloudbuild_sa
}
