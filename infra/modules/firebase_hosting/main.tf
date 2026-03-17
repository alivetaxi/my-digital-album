resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.project_id
  # Site ID must be globally unique; use project-environment as the identifier.
  site_id  = "${var.project_id}-${var.environment}"
}
