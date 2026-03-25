terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    # Use -backend-config="prefix=terraform/state/dev" (or prod) when running terraform init
    bucket = "my-digital-album-tfstate"
    prefix = "terraform/state/dev"  # overridden via -backend-config at init time
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Enable required GCP APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "secretmanager.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

module "firestore" {
  source            = "./modules/firestore"
  project_id        = var.project_id
  region            = var.region
  environment       = var.environment
  create_default_db = var.create_default_db
  depends_on        = [google_project_service.apis]
}

module "storage" {
  source      = "./modules/storage"
  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  depends_on  = [google_project_service.apis]
}

module "functions" {
  source                 = "./modules/functions"
  project_id             = var.project_id
  region                 = var.region
  environment            = var.environment
  media_bucket_name      = module.storage.media_bucket_name
  thumbnails_bucket_name = module.storage.thumbnails_bucket_name
  create_triggers        = var.create_triggers
  depends_on             = [google_project_service.apis, module.storage]
}

module "firebase_hosting" {
  source      = "./modules/firebase_hosting"
  project_id  = var.project_id
  environment = var.environment
  depends_on  = [google_project_service.apis]
}

module "cicd" {
  source               = "./modules/cicd"
  project_id           = var.project_id
  region               = var.region
  environment          = var.environment
  functions_sa_email   = module.functions.service_account_email
  create_cloudbuild_sa = var.create_cloudbuild_sa
  depends_on           = [google_project_service.apis, module.functions]
}
