terraform {
  required_version = ">= 1.10.5, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "6.49.2"
    }
  }
  backend "gcs" {}
}
