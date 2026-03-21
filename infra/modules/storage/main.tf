locals {
  common_labels = {
    app         = "my-digital-album"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# Private bucket — original media files (accessed via signed URLs only)
resource "google_storage_bucket" "media" {
  name          = "${var.project_id}-media-${var.environment}"
  project       = var.project_id
  location      = var.region
  force_destroy = var.environment == "dev"
  labels        = local.common_labels

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST"]
    response_header = ["Content-Type", "Content-MD5", "Content-Range", "Range", "ETag", "x-goog-resumable"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      age            = 1
      with_state     = "ANY"
      matches_prefix = ["tmp/"]
    }
    action {
      type = "Delete"
    }
  }
}

# Public bucket — thumbnails only (no sensitive content, fast CDN delivery)
resource "google_storage_bucket" "thumbnails" {
  name          = "${var.project_id}-thumbnails-${var.environment}"
  project       = var.project_id
  location      = var.region
  force_destroy = var.environment == "dev"
  labels        = local.common_labels

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 86400
  }
}

# Grant public read on the thumbnails bucket (no condition needed — whole bucket is thumbnails)
resource "google_storage_bucket_iam_member" "thumbnails_public_read" {
  bucket = google_storage_bucket.thumbnails.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
