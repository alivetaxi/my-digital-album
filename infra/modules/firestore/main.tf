locals {
  common_labels = {
    app         = "my-digital-album"
    environment = var.environment
    managed-by  = "terraform"
  }
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  # Named database per environment so both can coexist in the same GCP project.
  # Note: only one "(default)" database is allowed per project.
  name        = "album-${var.environment}"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  delete_protection_state = "DELETE_PROTECTION_ENABLED"
}
