# Stage 3 extends the frozen Client resources without renaming their state addresses.
# Cloud Run service/revisions remain owned exclusively by the deployment pipeline.
variable "firestore_location" {
  type        = string
  description = "Verified location of the existing database, or the approved location for a new staging database. Never guess this when importing."
}
variable "report_tool_url" {
  type = string
}
variable "payment_checkout_url_template" {
  type    = string
  default = ""
}
variable "github_repository" {
  type    = string
  default = "info-rbp/ProInspect-Booking-Portal-Application"
}
variable "github_repository_id" {
  type    = string
  default = "1390107826"
}
variable "terraform_service_account_email" {
  type        = string
  description = "Bootstrapped Terraform identity; never a runtime identity."
}
variable "enable_github_federation" {
  type    = bool
  default = true
}
variable "additional_runtime_buckets" {
  type        = set(string)
  default     = []
  description = "Existing private buckets still referenced by legacy document paths. Inventory and verify them before adding; no copy or public ACL change occurs."
}
variable "auth_support_email" {
  type = string
}
variable "auth_authorized_domains" {
  type = list(string)
}

locals {
  stage3_apis = toset(["firebaserules.googleapis.com", "sts.googleapis.com", "logging.googleapis.com"])
  integration_secret_ids = {
    report_handoff_signing_key = "${local.resource_prefix}-report-handoff-signing-key"
    report_ingest_token        = "${local.resource_prefix}-report-ingest-token"
    payment_webhook_token      = "${local.resource_prefix}-payment-webhook-token"
  }
  all_secret_ids = merge(local.secret_ids, local.integration_secret_ids)
  secret_environment = {
    ACCESS_DATA_ENCRYPTION_KEY = local.secret_ids.access_data_encryption_key
    RESEND_API_KEY             = local.secret_ids.resend_api_key
    GOOGLE_MAPS_API_KEY        = local.secret_ids.google_maps_api_key
    REPORT_HANDOFF_SIGNING_KEY = local.integration_secret_ids.report_handoff_signing_key
    REPORT_INGEST_TOKEN        = local.integration_secret_ids.report_ingest_token
    PAYMENT_WEBHOOK_TOKEN      = local.integration_secret_ids.payment_webhook_token
  }
  index_file = jsondecode(file("${path.module}/../firestore.indexes.json"))
  indexes    = { for index in local.index_file.indexes : substr(sha256(jsonencode(index)), 0, 20) => index }
  fields     = { for field in try(local.index_file.fieldOverrides, []) : "${field.collectionGroup}/${field.fieldPath}" => field }
  stage3_runtime_environment = merge(local.runtime_environment, {
    STAGING_EMAIL_RECIPIENT       = var.staging_email_recipient
    NODE_ENV                      = "production"
    PLATFORM_ENVIRONMENT          = var.environment
    REPORT_TOOL_URL               = var.report_tool_url
    PAYMENT_CHECKOUT_URL_TEMPLATE = var.payment_checkout_url_template
    TENANT_EMAIL_FROM             = var.booking_email_from
    TENANT_EMAIL_REPLY_TO         = var.booking_email_reply_to
  })
}
resource "google_project_service" "stage3" {
  for_each           = local.stage3_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = split("@", var.runtime_service_account_email)[0]
  display_name = "ProInspect ${var.environment} runtime"
  lifecycle { prevent_destroy = true }
}
resource "google_service_account" "platform" {
  for_each     = toset(["build", "deploy", "migration", "gateway"])
  project      = var.project_id
  account_id   = "proinspect-${var.environment}-${each.key}"
  display_name = "ProInspect ${var.environment} ${each.key}"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_firestore_database" "platform" {
  project                           = var.project_id
  name                              = var.firestore_database_id
  location_id                       = var.firestore_location
  type                              = "FIRESTORE_NATIVE"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABANDON"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_firestore_backup_schedule" "daily" {
  project   = var.project_id
  database  = google_firestore_database.platform.name
  retention = "1209600s"
  daily_recurrence {}
}
resource "google_firestore_index" "canonical" {
  for_each    = local.indexes
  project     = var.project_id
  database    = google_firestore_database.platform.name
  collection  = each.value.collectionGroup
  query_scope = each.value.queryScope
  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path   = fields.value.fieldPath
      order        = try(fields.value.order, null)
      array_config = try(fields.value.arrayConfig, null)
    }
  }
  lifecycle { prevent_destroy = true }
}
resource "google_firestore_field" "canonical" {
  for_each   = local.fields
  project    = var.project_id
  database   = google_firestore_database.platform.name
  collection = each.value.collectionGroup
  field      = each.value.fieldPath
  index_config {
    dynamic "indexes" {
      for_each = try(each.value.indexes, [])
      content {
        order        = try(indexes.value.order, null)
        array_config = try(indexes.value.arrayConfig, null)
        query_scope  = indexes.value.queryScope
      }
    }
  }
  dynamic "ttl_config" {
    for_each = try(each.value.ttl, false) ? [1] : []
    content {}
  }
}
resource "google_firebase_project" "platform" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.required]
}
resource "google_firebase_web_app" "platform" {
  provider     = google-beta
  project      = var.project_id
  display_name = "ProInspect ${var.environment} portal"
  depends_on   = [google_firebase_project.platform]
  lifecycle { prevent_destroy = true }
}
data "google_firebase_web_app_config" "platform" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.platform.app_id
}
resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../firestore.rules")
    }
  }
  depends_on = [google_project_service.stage3, google_firebase_project.platform]
}
resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = var.firestore_database_id == "(default)" ? "cloud.firestore" : "cloud.firestore/${var.firestore_database_id}"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"
  depends_on   = [google_firestore_database.platform]
}
resource "google_secret_manager_secret" "integration" {
  for_each  = local.integration_secret_ids
  project   = var.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_secret_manager_secret_iam_member" "integration_runtime" {
  for_each   = google_secret_manager_secret.integration
  project    = var.project_id
  secret_id  = each.value.secret_id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${var.runtime_service_account_email}"
  depends_on = [google_service_account.runtime]
}
resource "google_storage_bucket" "operations" {
  for_each                    = toset(["release-evidence", "migration-backups", "build-sources"])
  project                     = var.project_id
  name                        = "${var.project_id}-proinspect-${each.key}"
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_artifact_registry_repository" "platform" {
  project       = var.project_id
  location      = var.region
  repository_id = "proinspect-${var.environment}"
  format        = "DOCKER"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_artifact_registry_repository_iam_member" "builder" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.platform.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.platform["build"].email}"
}
resource "google_project_iam_member" "platform" {
  for_each = {
    gateway_invoke   = { identity = "gateway", role = "roles/run.invoker" }
    build_log        = { identity = "build", role = "roles/logging.logWriter" }
    deploy_run       = { identity = "deploy", role = "roles/run.developer" }
    deploy_invoke    = { identity = "deploy", role = "roles/run.invoker" }
    deploy_build     = { identity = "deploy", role = "roles/cloudbuild.builds.editor" }
    deploy_secrets   = { identity = "deploy", role = "roles/secretmanager.viewer" }
    deploy_read      = { identity = "deploy", role = "roles/artifactregistry.reader" }
    migration_data   = { identity = "migration", role = "roles/datastore.user" }
    migration_backup = { identity = "migration", role = "roles/datastore.importExportAdmin" }
    migration_admin  = { identity = "migration", role = "roles/datastore.owner" }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.platform[each.value.identity].email}"
}
resource "google_service_account_iam_member" "deploy_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_service_account_iam_member" "deploy_build" {
  service_account_id = google_service_account.platform["build"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_storage_bucket_iam_member" "builder_source" {
  bucket = google_storage_bucket.operations["build-sources"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.platform["build"].email}"
}
resource "google_storage_bucket_iam_member" "deploy_artifacts" {
  for_each = toset(["build-sources", "release-evidence"])
  bucket   = google_storage_bucket.operations[each.key].name
  role     = "roles/storage.objectAdmin"
  member   = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_storage_bucket_iam_member" "migration_backup" {
  bucket = google_storage_bucket.operations["migration-backups"].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.platform["migration"].email}"
}
resource "google_storage_bucket_iam_member" "firestore_backup" {
  bucket     = google_storage_bucket.operations["migration-backups"].name
  role       = "roles/storage.objectAdmin"
  member     = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-firestore.iam.gserviceaccount.com"
  depends_on = [google_firestore_database.platform]
}
resource "google_storage_bucket_iam_member" "runtime_legacy" {
  for_each = var.additional_runtime_buckets
  bucket   = each.value
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${var.runtime_service_account_email}"
}
resource "google_iam_workload_identity_pool" "github" {
  count                     = var.enable_github_federation ? 1 : 0
  project                   = var.project_id
  workload_identity_pool_id = "proinspect-${var.environment}"
  depends_on                = [google_project_service.stage3, google_project_service.required]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.enable_github_federation ? 1 : 0
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
  }
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/release/platform-unification' && assertion.sub == 'repo:${var.github_repository}:environment:${var.environment}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "github_deploy" {
  count              = var.enable_github_federation && var.environment == "staging" ? 1 : 0
  service_account_id = google_service_account.platform["deploy"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository_id/${var.github_repository_id}"
}
output "stage3_manifest" {
  value = {
    schemaVersion      = 1
    environment        = var.environment
    projectId          = var.project_id
    databaseId         = var.firestore_database_id
    region             = var.region
    service            = var.cloud_run_service_name
    runtimeIdentity    = var.runtime_service_account_email
    deployIdentity     = google_service_account.platform["deploy"].email
    migrationIdentity  = google_service_account.platform["migration"].email
    buildIdentity      = google_service_account.platform["build"].email
    gatewayIdentity    = google_service_account.platform["gateway"].email
    gatewayService     = "${var.cloud_run_service_name}-reports"
    imageRepository    = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.platform.repository_id}/platform"
    buckets            = { for key, bucket in google_storage_bucket.operations : key => bucket.name }
    documentBucket     = google_storage_bucket.client_documents.name
    secretBindings     = local.secret_environment
    requiredSecrets    = concat(["ACCESS_DATA_ENCRYPTION_KEY", "RESEND_API_KEY", "REPORT_HANDOFF_SIGNING_KEY", "REPORT_INGEST_TOKEN"], var.payment_checkout_url_template != "" ? ["PAYMENT_WEBHOOK_TOKEN"] : [])
    runtimeEnvironment = local.stage3_runtime_environment
    authSupportEmail   = var.auth_support_email
    authDomains        = var.auth_authorized_domains
    firebaseConfig = {
      projectId           = var.project_id
      appId               = google_firebase_web_app.platform.app_id
      apiKey              = data.google_firebase_web_app_config.platform.api_key
      authDomain          = data.google_firebase_web_app_config.platform.auth_domain
      firestoreDatabaseId = var.firestore_database_id
      storageBucket       = google_storage_bucket.client_documents.name
      messagingSenderId   = data.google_firebase_web_app_config.platform.messaging_sender_id
      measurementId       = ""
      oAuthClientId       = ""
      recaptchaSiteKey    = ""
    }
    workloadIdentityProvider = try(google_iam_workload_identity_pool_provider.github[0].name, "")
  }
}

variable "operator_principal" {
  type        = string
  description = "Named operator permitted to impersonate stage-specific accounts. Never allUsers."
  validation {
    condition     = can(regex("^(user|serviceAccount):[^ ]+@[^ ]+$", var.operator_principal))
    error_message = "A named user or service account is required."
  }
}
variable "staging_email_recipient" {
  type        = string
  default     = ""
  description = "Staging-only notification sink; production delivery remains unchanged."
  validation {
    condition     = var.environment != "staging" || can(regex("^[^ @,;<>]+@[^ @,;<>]+\\.[^ @,;<>]+$", var.staging_email_recipient))
    error_message = "Staging needs one explicit test mailbox."
  }
}
resource "google_service_account_iam_member" "operator_platform" {
  for_each           = var.environment == "staging" ? google_service_account.platform : {}
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = var.operator_principal
}
resource "google_service_account_iam_member" "operator_runtime_probe" {
  count              = var.environment == "staging" ? 1 : 0
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = var.operator_principal
}
resource "google_service_account_iam_member" "deploy_self_token" {
  service_account_id = google_service_account.platform["deploy"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_project_iam_member" "platform_api_usage" {
  for_each = google_service_account.platform
  project  = var.project_id
  role     = "roles/serviceusage.serviceUsageConsumer"
  member   = "serviceAccount:${each.value.email}"
}

resource "google_secret_manager_secret" "auth_client" {
  project   = var.project_id
  secret_id = "${local.resource_prefix}-google-signin-client-secret"
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_service_account_iam_member" "deploy_gateway" {
  service_account_id = google_service_account.platform["gateway"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_secret_manager_secret_iam_member" "gateway_ingest" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.integration["report_ingest_token"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.platform["gateway"].email}"
}
resource "google_project_iam_custom_role" "gateway_policy" {
  project     = var.project_id
  role_id     = "proinspectGatewayPolicy"
  title       = "ProInspect staging gateway IAM publication"
  permissions = ["run.services.getIamPolicy", "run.services.setIamPolicy"]
}
resource "google_project_iam_member" "gateway_publisher" {
  project = var.project_id
  role    = google_project_iam_custom_role.gateway_policy.name
  member  = "serviceAccount:${google_service_account.platform["deploy"].email}"
}
resource "google_service_account_iam_member" "runtime_signing" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.runtime_service_account_email}"
}
