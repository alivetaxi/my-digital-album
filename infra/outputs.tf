output "media_bucket_name" {
  description = "Name of the GCS media bucket (private, originals)"
  value       = module.storage.media_bucket_name
}

output "thumbnails_bucket_name" {
  description = "Name of the GCS thumbnails bucket (public)"
  value       = module.storage.thumbnails_bucket_name
}

output "functions_service_account_email" {
  description = "Service account email for Cloud Functions"
  value       = module.functions.service_account_email
}

output "firebase_hosting_site_id" {
  description = "Firebase Hosting site ID"
  value       = module.firebase_hosting.site_id
}
