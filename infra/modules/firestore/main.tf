locals {
  common_labels = {
    app         = "my-digital-album"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# Use the single (default) Firestore database (Spark free tier allows only one).
# Collections are prefixed with the environment, e.g. albums-dev, albums-prod.
# Only one module instance should set create_default_db = true to avoid conflicts.

resource "google_firestore_database" "default" {
  count       = var.create_default_db ? 1 : 0
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  delete_protection_state = "DELETE_PROTECTION_ENABLED"
}

# Composite indexes required by the albums list queries (where + order_by on different fields).

resource "google_firestore_index" "albums_owner_updated" {
  project    = var.project_id
  database   = "(default)"
  collection = "albums-${var.environment}"

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
  database   = "(default)"
  collection = "albums-${var.environment}"

  fields {
    field_path = "visibility"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "albums_member_ids_updated" {
  project    = var.project_id
  database   = "(default)"
  collection = "albums-${var.environment}"

  fields {
    field_path   = "memberIds"
    array_config = "CONTAINS"
  }
  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}
