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

# Composite indexes required by the albums list queries (where + order_by on different fields).

resource "google_firestore_index" "albums_owner_updated" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "albums"

  fields {
    field_path = "ownerId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "albums_visibility_updated" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "albums"

  fields {
    field_path = "visibility"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "albums_visibility_group_updated" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "albums"

  fields {
    field_path = "visibility"
    order      = "ASCENDING"
  }
  fields {
    field_path = "groupId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}
