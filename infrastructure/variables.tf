variable "project_id" {
  description = "Google Cloud project that hosts ProInspect."
  type        = string
}

variable "environment" {
  description = "Logical environment name used in resource names."
  type        = string
  default     = "production"
}

variable "region" {
  description = "Google Cloud region used by the existing Cloud Run service."
  type        = string
  default     = "europe-west1"
}

variable "storage_location" {
  description = "Location for client documents. This is separate from the existing Firebase default bucket."
  type        = string
  default     = "australia-southeast1"
}

variable "runtime_service_account_email" {
  description = "Existing Cloud Run runtime service account. bootstrap.sh creates it if absent."
  type        = string
}

variable "cloud_run_service_name" {
  description = "Existing Cloud Run service that receives Terraform-managed runtime configuration."
  type        = string
}

variable "firestore_database_id" {
  description = "Named Firestore database used by the application."
  type        = string
}

variable "admin_emails" {
  description = "Comma-separated ProInspect staff administrator email allow-list."
  type        = string
}

variable "google_calendar_id" {
  description = "Dedicated Google Calendar used for booking availability and events."
  type        = string
}

variable "app_url" {
  description = "Public application origin."
  type        = string
}

variable "address_validation_mode" {
  description = "Address validation rollout mode."
  type        = string
  default     = "optional"

  validation {
    condition     = contains(["off", "optional", "required"], var.address_validation_mode)
    error_message = "address_validation_mode must be off, optional, or required."
  }
}

variable "access_data_encryption_key_id" {
  description = "Application-level version label stored with encrypted booking access data."
  type        = string
  default     = "v1"
}

variable "booking_email_from" {
  description = "Verified Resend sender used for booking and portal emails."
  type        = string
}

variable "booking_email_reply_to" {
  description = "Reply-to address used for customer emails."
  type        = string
}

variable "document_request_notify_to" {
  description = "Internal address notified of new public document requests."
  type        = string
}

variable "client_documents_bucket_name" {
  description = "Optional explicit globally unique bucket name. Leave blank to derive one from the project and environment."
  type        = string
  default     = ""
}

variable "required_apis" {
  description = "Google APIs required by the current ProInspect application and deployment path."
  type        = set(string)
  default = [
    "addressvalidation.googleapis.com",
    "artifactregistry.googleapis.com",
    "calendar-json.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "places.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ]
}
