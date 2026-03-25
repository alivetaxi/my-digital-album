# Dedicated service account for Cloud Build
resource "google_service_account" "cloudbuild" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project      = var.project_id
  account_id   = "cloudbuild-sa"
  display_name = "Cloud Build SA"
  description  = "Used by Cloud Build triggers to build and deploy the application"
}

data "google_service_account" "cloudbuild_existing" {
  count      = var.create_cloudbuild_sa ? 0 : 1
  account_id = "cloudbuild-sa"
  project    = var.project_id
}

locals {
  cloudbuild_sa_email = var.create_cloudbuild_sa ? google_service_account.cloudbuild[0].email : data.google_service_account.cloudbuild_existing[0].email
  cloudbuild_sa       = "serviceAccount:${local.cloudbuild_sa_email}"
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
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = local.cloudbuild_sa
}

# Deploy to Cloud Run
resource "google_project_iam_member" "cloudbuild_run_admin" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/run.admin"
  member  = local.cloudbuild_sa
}

# Deploy to Firebase Hosting
resource "google_project_iam_member" "cloudbuild_firebase_hosting" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = local.cloudbuild_sa
}

# Deploy Firestore security rules
resource "google_project_iam_member" "cloudbuild_firebase_rules" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/firebaserules.admin"
  member  = local.cloudbuild_sa
}

# Check/enable GCP APIs (required by Firebase CLI preflight checks)
resource "google_project_iam_member" "cloudbuild_service_usage" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = local.cloudbuild_sa
}

# Write build logs to Cloud Logging
resource "google_project_iam_member" "cloudbuild_log_writer" {
  count = var.create_cloudbuild_sa ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.cloudbuild_sa
}

# Read secrets (e.g. firebase-config-dev/prod for environment.ts)
resource "google_project_iam_member" "cloudbuild_secret_accessor" {
  count = var.create_cloudbuild_sa ? 1 : 0

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
