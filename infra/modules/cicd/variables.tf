variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "functions_sa_email" {
  type        = string
  description = "Email of the functions service account (from the functions module)"
}

variable "create_cloudbuild_sa" {
  description = "Set to true once to create the cloudbuild service account. Only needed on first apply; the account is shared across environments."
  type        = bool
  default     = false
}
