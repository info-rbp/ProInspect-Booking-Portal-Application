# All providers are mocked: these tests never provision resources.
mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_service_account" {
    defaults = { name = "projects/proinspect-staging-required/serviceAccounts/mock-service@proinspect-staging-required.iam.gserviceaccount.com", email = "mock-service@proinspect-staging-required.iam.gserviceaccount.com" }
  }
}
mock_provider "google-beta" {
  mock_resource "google_firebase_web_app" {
    defaults = { app_id = "1:123456789012:web:synthetic" }
  }
  mock_data "google_firebase_web_app_config" {
    defaults = { api_key = "synthetic-public-firebase-key", auth_domain = "proinspect-staging-required.firebaseapp.com", messaging_sender_id = "123456789012" }
  }
}
variables {
  project_id                      = "proinspect-staging-required"
  environment                     = "staging"
  region                          = "australia-southeast1"
  storage_location                = "australia-southeast1"
  firestore_location              = "australia-southeast1"
  runtime_service_account_email   = "proinspect-staging-runtime@proinspect-staging-required.iam.gserviceaccount.com"
  terraform_service_account_email = "proinspect-staging-terraform@proinspect-staging-required.iam.gserviceaccount.com"
  cloud_run_service_name          = "proinspect-platform-staging"
  firestore_database_id           = "platform-staging"
  client_documents_bucket_name    = "proinspect-staging-required-private-documents"
  additional_runtime_buckets      = []
  admin_emails                    = "qa@example.test"
  google_calendar_id              = "qa@example.test"
  app_url                         = "https://qa.example.test"
  report_tool_url                 = "https://qa.example.test"
  auth_support_email              = "qa@example.test"
  auth_authorized_domains         = ["qa.example.test"]
  address_validation_mode         = "optional"
  access_data_encryption_key_id   = "staging-v1"
  booking_email_from              = "qa@example.test"
  booking_email_reply_to          = "qa@example.test"
  document_request_notify_to      = "qa@example.test"
  payment_checkout_url_template   = ""
  enable_github_federation        = true
  operator_principal              = "user:qa@example.test"
  staging_email_recipient         = "qa@example.test"
}
run "isolated_private_platform" {
  command = plan
  assert {
    condition     = google_firestore_database.platform.delete_protection_state == "DELETE_PROTECTION_ENABLED" && google_firestore_database.platform.point_in_time_recovery_enablement == "POINT_IN_TIME_RECOVERY_ENABLED"
    error_message = "Firestore protection and PITR must remain enabled."
  }
  assert {
    condition     = google_storage_bucket.client_documents.public_access_prevention == "enforced" && google_storage_bucket.client_documents.uniform_bucket_level_access && !google_storage_bucket.client_documents.force_destroy
    error_message = "Document storage must remain private and non-destructive."
  }
  assert {
    condition     = alltrue([for b in google_storage_bucket.operations : b.public_access_prevention == "enforced" && b.uniform_bucket_level_access && !b.force_destroy && b.versioning[0].enabled])
    error_message = "Operations buckets must be private, protected and versioned."
  }
  assert {
    condition     = length(google_firestore_index.canonical) == length(local.index_file.indexes)
    error_message = "Every canonical index must be provisioned."
  }
  assert {
    condition     = local.stage3_runtime_environment.STAGING_EMAIL_RECIPIENT == "qa@example.test" && google_firebase_project.platform.project == var.project_id
    error_message = "Staging browser identity and notification sink must be isolated."
  }
  assert {
    condition     = contains(keys(local.secret_environment), "REPORT_HANDOFF_SIGNING_KEY") && contains(keys(local.secret_environment), "REPORT_INGEST_TOKEN")
    error_message = "Report integration secrets must be required, not silently skipped."
  }
  assert {
    condition     = length(google_iam_workload_identity_pool_provider.github) == 1 && length(google_service_account_iam_member.github_terraform) == 1 && length(google_service_account_iam_member.terraform_self_impersonation) == 1
    error_message = "Staging GitHub automation must use constrained Workload Identity Federation through the Terraform identity."
  }
}
run "reject_production_as_staging" {
  command = plan
  variables { project_id = "business-plan-applicatio-17047" }
  expect_failures = [var.environment]
}
run "reject_missing_email_sink" {
  command = plan
  variables { staging_email_recipient = "" }
  expect_failures = [var.staging_email_recipient]
}
run "reject_public_operator" {
  command = plan
  variables { operator_principal = "allUsers" }
  expect_failures = [var.operator_principal]
}

run "production_cutover_boundaries" {
  command = plan
  variables {
    project_id                      = "business-plan-applicatio-17047"
    environment                     = "production"
    runtime_service_account_email   = "proinspect-booking-runtime@business-plan-applicatio-17047.iam.gserviceaccount.com"
    terraform_service_account_email = "proinspect-prod-terraform@business-plan-applicatio-17047.iam.gserviceaccount.com"
    staging_email_recipient         = ""
    artifact_repository_id          = "existing-production-artifacts"
  }
  assert {
    condition     = length(google_service_account_iam_member.production_federation) == 1 && length(google_service_account_iam_member.github_terraform) == 0
    error_message = "Production and staging federation grants must be distinct."
  }
  assert {
    condition     = contains(keys(local.secret_environment), "PRODUCTION_RELEASE_TOKEN") && local.stage3_runtime_environment.STAGING_EMAIL_RECIPIENT == ""
    error_message = "Production candidates must be guarded without redirecting real customer notifications."
  }
  assert {
    condition     = google_artifact_registry_repository.platform.repository_id == "existing-production-artifacts"
    error_message = "Preserve the reviewed existing production artifact repository."
  }
  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "stage4-production.yml") && strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.environment == 'production'")
    error_message = "Production OIDC must be bound to the dedicated workflow and environment."
  }
}
