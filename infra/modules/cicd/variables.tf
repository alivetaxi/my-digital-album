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
