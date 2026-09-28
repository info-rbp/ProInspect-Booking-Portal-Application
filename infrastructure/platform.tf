# Terraform owns supporting resources, NOT the Cloud Run service or its traffic.
resource "google_service_account" "runtime" {
  count        = var.manage_runtime_service_account ? 1 : 0
  project      = var.project_id
  account_id   = split("@", var.runtime_service_account_email)[0]
  display_name = "ProInspect ${var.environment} runtime"
  depends_on   = [google_project_service.required]
  lifecycle { prevent_destroy = true }
}
resource "google_firestore_database" "platform" {
  count                             = var.manage_database ? 1 : 0
  project                           = var.project_id
  name                              = var.firestore_database_id
  location_id                       = var.firestore_location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "PESSIMISTIC"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  deletion_policy                   = "ABANDON"
  depends_on                        = [google_project_service.required]
  lifecycle { prevent_destroy = true }
}
resource "google_firestore_index" "canonical" {
  for_each    = local.canonical_indexes
  project     = var.project_id
  database    = var.firestore_database_id
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
  depends_on = [google_project_service.required, google_firestore_database.platform]
  lifecycle { prevent_destroy = true }
}
resource "google_firebaserules_ruleset" "firestore" {
  count   = var.manage_firestore_rules ? 1 : 0
  project = var.project_id
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../firestore.rules")
    }
  }
  depends_on = [google_project_service.required]
}
resource "google_firebaserules_release" "firestore" {
  count        = var.manage_firestore_rules ? 1 : 0
  project      = var.project_id
  name         = var.firestore_database_id == "(default)" ? "cloud.firestore" : "cloud.firestore/${var.firestore_database_id}"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore[0].name}"
  depends_on   = [google_firestore_database.platform]
}
resource "google_storage_bucket" "operations" {
  for_each                    = toset(["build-source", "migration-evidence", "firestore-backups"])
  project                     = var.project_id
  name                        = "${local.resource_prefix}-${data.google_project.current.number}-${each.key}"
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = merge(local.labels, { purpose = each.key })
  versioning { enabled = true }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_artifact_registry_repository" "platform" {
  project       = var.project_id
  location      = var.region
  repository_id = local.resource_prefix
  description   = "Immutable source-SHA-tagged ProInspect platform images"
  format        = "DOCKER"
  labels        = local.labels
  docker_config { immutable_tags = true }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_service_account" "automation" {
  for_each     = toset(["build", "deploy", "migration"])
  project      = var.project_id
  account_id   = "${local.resource_prefix}-${each.key}"
  display_name = "ProInspect ${var.environment} ${each.key}"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.automation["build"].email}"
}
resource "google_artifact_registry_repository_iam_member" "build_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.platform.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.automation["build"].email}"
}
resource "google_storage_bucket_iam_member" "build_source_reader" {
  bucket = google_storage_bucket.operations["build-source"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.automation["build"].email}"
}
resource "google_project_iam_member" "migration_data" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.automation["migration"].email}"
}
resource "google_storage_bucket_iam_member" "migration_evidence_creator" {
  bucket = google_storage_bucket.operations["migration-evidence"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.automation["migration"].email}"
}
resource "google_storage_bucket_iam_member" "migration_evidence_reader" {
  bucket = google_storage_bucket.operations["migration-evidence"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.automation["migration"].email}"
}
resource "google_storage_bucket_iam_member" "migration_files_reader" {
  bucket = google_storage_bucket.client_documents.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.automation["migration"].email}"
}
resource "google_project_iam_member" "migration_backup" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.automation["migration"].email}"
}
# bootstrap.sh explicitly creates the Firestore service identity first.
resource "google_storage_bucket_iam_member" "firestore_backup_writer" {
  bucket = google_storage_bucket.operations["firestore-backups"].name
  role   = "roles/storage.admin"
  member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-firestore.iam.gserviceaccount.com"
}
resource "google_storage_bucket_iam_member" "migration_backup_reader" {
  bucket = google_storage_bucket.operations["firestore-backups"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.automation["migration"].email}"
}

resource "google_service_account_iam_member" "operator_migration" {
  for_each           = var.operator_members
  service_account_id = google_service_account.automation["migration"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}
resource "google_service_account_iam_member" "operator_runtime" {
  for_each           = var.operator_members
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.runtime_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
  depends_on         = [google_service_account.runtime]
}
