variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "media_bucket_name" {
  type = string
}

variable "thumbnails_bucket_name" {
  type = string
}

variable "create_triggers" {
  description = "Set to true only after Cloud Run services are deployed. Eventarc triggers require the target service to exist."
  type        = bool
  default     = false
}
