# Dedicated service account for Cloud Build
resource "google_service_account" "cloudbuild" {
  project      = var.project_id
  account_id   = "cloudbuild-sa"
  display_name = "Cloud Build SA"
  description  = "Used by Cloud Build triggers to build and deploy the application"
}

locals {
  cloudbuild_sa = "serviceAccount:${google_service_account.cloudbuild.email}"
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

# Deploy to Cloud Run
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

# Write build logs to Cloud Logging
resource "google_project_iam_member" "cloudbuild_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.cloudbuild_sa
}

# Read secrets (e.g. firebase-config-dev/prod for environment.ts)
resource "google_project_iam_member" "cloudbuild_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = local.cloudbuild_sa
}

# Allow Cloud Build SA to impersonate the functions service account
# (required by gcloud run services replace, which deploys as functions-sa)
resource "google_service_account_iam_member" "cloudbuild_actAs_functions_sa" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.functions_sa_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloudbuild_sa
}
