locals {
  resource_prefix = format("proinspect-%s", var.environment)

  client_documents_bucket_name = (
    trimspace(var.client_documents_bucket_name) != ""
    ? var.client_documents_bucket_name
    : format("proinspect-client-docs-%s-%s", data.google_project.current.number, var.environment)
  )

  runtime_project_roles = toset([
    "roles/datastore.user",
    "roles/identitytoolkit.viewer",
    "roles/serviceusage.serviceUsageConsumer",
  ])

  secret_ids = {
    access_data_encryption_key = format("%s-access-data-encryption-key", local.resource_prefix)
    resend_api_key             = format("%s-resend-api-key", local.resource_prefix)
    google_maps_api_key        = format("%s-google-maps-api-key", local.resource_prefix)
  }

  runtime_environment = {
    APP_URL                       = var.app_url
    FIREBASE_PROJECT_ID           = var.project_id
    FIRESTORE_DATABASE_ID         = var.firestore_database_id
    FIREBASE_STORAGE_BUCKET       = local.client_documents_bucket_name
    ADMIN_EMAILS                  = var.admin_emails
    GOOGLE_CALENDAR_ID            = var.google_calendar_id
    ADDRESS_VALIDATION_MODE       = var.address_validation_mode
    ACCESS_DATA_ENCRYPTION_KEY_ID = var.access_data_encryption_key_id
    BOOKING_EMAIL_FROM            = var.booking_email_from
    BOOKING_EMAIL_REPLY_TO        = var.booking_email_reply_to
    DOCUMENT_REQUEST_NOTIFY_TO    = var.document_request_notify_to
  }
}
