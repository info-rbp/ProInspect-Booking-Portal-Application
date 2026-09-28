variable "project_id" {
  description = "Google Cloud project that hosts ProInspect."
  type        = string
}

variable "environment" {
  description = "Explicit environment. Staging must use a separate Google Cloud project."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
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
  description = "Existing or explicitly Terraform-managed runtime identity. Import before adopting an existing account."
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
  validation {
    condition     = var.environment != "production" || can(regex("^[a-z0-9][a-z0-9.-]+$", var.client_documents_bucket_name))
    error_message = "Production requires an explicitly inventoried existing documents bucket; no derived fallback is allowed."
  }
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
    "firebaserules.googleapis.com",
    "sheets.googleapis.com",
    "sts.googleapis.com",
    "logging.googleapis.com",
  ]
}

variable "production_project_id" {
  type    = string
  default = "business-plan-applicatio-17047"
  validation {
    condition     = var.environment != "staging" || (var.project_id != var.production_project_id && var.project_id != "business-plan-applicatio-17047")
    error_message = "Staging must not share the production project or production identities."
  }
}
variable "firestore_location" {
  description = "Actual existing location when importing. Never guess or relocate a production database."
  type        = string
  default     = "australia-southeast1"
}
variable "manage_database" {
  description = "Enable for a new staging database, or ONLY after importing an existing database."
  type        = bool
  default     = false
}
variable "manage_firestore_rules" {
  type    = bool
  default = false
}
variable "manage_runtime_service_account" {
  description = "Keep false for an externally managed runtime identity. Import before enabling for existing accounts."
  type        = bool
  default     = false
}
variable "enable_staging_ci" {
  type    = bool
  default = false
  validation {
    condition     = !var.enable_staging_ci || var.environment == "staging"
    error_message = "Stage 3 does not create production deployment authority."
  }
}
variable "github_repository_id" {
  type    = string
  default = "1390107826"
}
variable "github_owner_id" {
  type    = string
  default = "235419395"
}
variable "report_tool_url" {
  type    = string
  default = ""
}
variable "payment_checkout_url_template" {
  type    = string
  default = ""
}
variable "runtime_secret_versions" {
  description = "Map of secret logical keys to numeric enabled versions. No payloads and no latest alias."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for v in values(var.runtime_secret_versions) : can(regex("^[1-9][0-9]*$", v))])
    error_message = "Secret versions must be positive numbers; latest is not reproducible."
  }
}
variable "email_delivery_mode" {
  description = "Staging is deliberately unable to send customer email."
  type        = string
  default     = "disabled"
  validation {
    condition     = contains(["disabled", "live"], var.email_delivery_mode) && (var.environment != "staging" || var.email_delivery_mode == "disabled")
    error_message = "Staging email must be disabled."
  }
}

variable "staging_calendar_ids" {
  description = "Dedicated non-production Calendar IDs. No production Calendar is allowed in staging."
  type        = list(string)
  default     = []
}
variable "operator_members" {
  description = "Explicit trusted operator IAM members allowed to impersonate runtime/migration identities. No CI identity receives migration authority."
  type        = set(string)
  default     = []
}
