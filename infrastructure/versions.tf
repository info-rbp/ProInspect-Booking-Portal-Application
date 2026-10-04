terraform {
  required_version = ">= 1.10.5, < 2.0"
  required_providers {
    google-beta = { source = "hashicorp/google-beta", version = "6.49.2" }
    google      = { source = "hashicorp/google", version = "6.49.2" }
  }
  backend "gcs" {}
}
