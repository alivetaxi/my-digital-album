output "media_bucket_name" {
  value = google_storage_bucket.media.name
}

output "thumbnails_bucket_name" {
  value = google_storage_bucket.thumbnails.name
}
