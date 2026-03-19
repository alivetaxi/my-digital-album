variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "create_default_db" {
  type        = bool
  default     = false
  description = "Set to true for the first environment to create the (default) Firestore database. Only one instance across all environments should set this."
}
