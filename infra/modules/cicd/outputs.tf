output "cloudbuild_sa_email" {
  description = "Email of the Cloud Build service account — set this in the Cloud Build trigger's 'Service account' field"
  value       = google_service_account.cloudbuild.email
}
