mock_provider "google" {}
override_data {
  target = data.google_project.current
  values = { number = "123456789012" }
}
variables {
  project_id                    = "proinspect-ci-staging"
  environment                   = "staging"
  runtime_service_account_email = "proinspect-staging-runtime@proinspect-ci-staging.iam.gserviceaccount.com"
  cloud_run_service_name        = "proinspect-staging"
  firestore_database_id         = "proinspect-staging"
  admin_emails                  = "test@example.invalid"
  google_calendar_id            = "test-calendar"
  app_url                       = "https://staging.example.invalid"
  booking_email_from            = "test@example.invalid"
  booking_email_reply_to        = "test@example.invalid"
  document_request_notify_to    = "test@example.invalid"
  manage_database               = true
}
run "private_supporting_infrastructure" {
  command = plan
  assert {
    condition     = google_storage_bucket.client_documents.public_access_prevention == "enforced" && google_storage_bucket.client_documents.uniform_bucket_level_access
    error_message = "Platform documents must be private."
  }
  assert {
    condition     = google_firestore_database.platform[0].delete_protection_state == "DELETE_PROTECTION_ENABLED"
    error_message = "Database deletion protection is required."
  }
  assert {
    condition     = length(google_firestore_index.canonical) == 8
    error_message = "Every canonical index must be provisioned."
  }
  assert {
    condition     = length(google_secret_manager_secret.runtime) == 7
    error_message = "Every runtime integration secret container must be present."
  }
}
run "reject_production_project_for_staging" {
  command = plan
  variables { project_id = "business-plan-applicatio-17047" }
  expect_failures = [var.production_project_id]
}
run "reject_live_staging_email" {
  command = plan
  variables { email_delivery_mode = "live" }
  expect_failures = [var.email_delivery_mode]
}
run "reject_unpinned_secrets" {
  command = plan
  variables { runtime_secret_versions = { resend_api_key = "latest" } }
  expect_failures = [var.runtime_secret_versions]
}
