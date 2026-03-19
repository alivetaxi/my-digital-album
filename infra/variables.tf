variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "asia-east1"
}

variable "environment" {
  description = "Deployment environment (dev or prod)"
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "create_default_db" {
  description = "Set to true once to create the (default) Firestore database. Only needed on first apply; the database is shared across environments."
  type        = bool
  default     = false
}

variable "create_triggers" {
  description = "Set to true after Cloud Run services are deployed to create Eventarc triggers"
  type        = bool
  default     = true
}
