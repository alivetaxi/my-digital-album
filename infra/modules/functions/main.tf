locals {
  common_labels = {
    app         = "my-digital-album"
    environment = var.environment
    managed-by  = "terraform"
  }
}

data "google_project" "project" {
  project_id = var.project_id
}

# Service account for Cloud Functions
resource "google_service_account" "functions_sa" {
  project      = var.project_id
  account_id   = "functions-sa-${var.environment}"
  display_name = "Cloud Functions Service Account (${var.environment})"
}

# IAM bindings for Cloud Functions SA
resource "google_project_iam_member" "functions_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_project_iam_member" "functions_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_project_iam_member" "functions_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

resource "google_project_iam_member" "functions_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

# Required for generate_signed_url via IAM signBlob API (no private key on Cloud Run).
resource "google_service_account_iam_member" "functions_sa_token_creator" {
  service_account_id = google_service_account.functions_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.functions_sa.email}"
}

# Allow unauthenticated invocations of the API service.
# Security is enforced at the application layer via Firebase ID token verification.
resource "google_cloud_run_service_iam_member" "api_public_invoker" {
  project  = var.project_id
  location = var.region
  service  = "api-${var.environment}"
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_project_iam_member" "functions_eventarc_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.functions_sa.email}"
}

# Secret Manager secrets — one set per environment
resource "google_secret_manager_secret" "geocoding_api_key" {
  project   = var.project_id
  secret_id = "geocoding-api-key-${var.environment}"
  labels    = local.common_labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "firebase_service_account" {
  project   = var.project_id
  secret_id = "firebase-service-account-${var.environment}"
  labels    = local.common_labels

  replication {
    auto {}
  }
}

# Eventarc service agent needs to validate the GCS bucket when creating the trigger
resource "google_storage_bucket_iam_member" "eventarc_bucket_reader" {
  bucket = var.media_bucket_name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-eventarc.iam.gserviceaccount.com"
}

# Ensure the GCS service agent exists and retrieve its email
resource "google_project_service_identity" "gcs_sa" {
  provider = google-beta
  project  = var.project_id
  service  = "storage.googleapis.com"
}

# GCS service agent needs Pub/Sub publish rights to deliver events to Eventarc.
# google_project_service_identity ensures the agent is provisioned first;
# the email is then derived from the known GCS service agent format.
resource "google_project_iam_member" "gcs_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.project.number}@gs-project-accounts.iam.gserviceaccount.com"

  depends_on = [google_project_service_identity.gcs_sa]
}

# Eventarc trigger for the thumbnail Storage trigger.
# IMPORTANT: set create_triggers=true only AFTER the thumbnail Cloud Run service
# has been deployed (via Cloud Deploy). Applying before the service exists will fail.
resource "google_eventarc_trigger" "thumbnail_trigger" {
  count = var.create_triggers ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = "thumbnail-trigger-${var.environment}"
  labels   = local.common_labels

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.storage.object.v1.finalized"
  }

  matching_criteria {
    attribute = "bucket"
    value     = var.media_bucket_name
  }

  destination {
    cloud_run_service {
      service = "thumbnail-${var.environment}"
      region  = var.region
    }
  }

  service_account = google_service_account.functions_sa.email

  depends_on = [
    google_storage_bucket_iam_member.eventarc_bucket_reader,
    google_project_iam_member.gcs_pubsub_publisher,
    google_project_service_identity.gcs_sa,
    google_project_iam_member.functions_eventarc_receiver,
  ]
}
