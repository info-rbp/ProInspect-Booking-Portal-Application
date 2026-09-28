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
    access_data_encryption_key     = format("%s-access-data-encryption-key", local.resource_prefix)
    resend_api_key                 = format("%s-resend-api-key", local.resource_prefix)
    google_maps_api_key            = format("%s-google-maps-api-key", local.resource_prefix)
    access_data_encryption_keyring = format("%s-access-data-encryption-keyring", local.resource_prefix)
    report_ingest_token            = format("%s-report-ingest-token", local.resource_prefix)
    report_handoff_signing_key     = format("%s-report-handoff-signing-key", local.resource_prefix)
    payment_webhook_token          = format("%s-payment-webhook-token", local.resource_prefix)
  }

  runtime_environment = {
    APP_URL                       = var.app_url
    PLATFORM_ENVIRONMENT          = var.environment
    EMAIL_DELIVERY_MODE           = var.email_delivery_mode
    STAGING_CALENDAR_IDS          = join(",", var.staging_calendar_ids)
    REPORT_TOOL_URL               = var.report_tool_url
    PAYMENT_CHECKOUT_URL_TEMPLATE = var.payment_checkout_url_template
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

locals {
  labels = { application = "proinspect", environment = var.environment, managed-by = "terraform" }
  secret_env_names = {
    access_data_encryption_key     = "ACCESS_DATA_ENCRYPTION_KEY"
    access_data_encryption_keyring = "ACCESS_DATA_ENCRYPTION_KEYRING"
    resend_api_key                 = "RESEND_API_KEY"
    google_maps_api_key            = "GOOGLE_MAPS_API_KEY"
    report_ingest_token            = "REPORT_INGEST_TOKEN"
    report_handoff_signing_key     = "REPORT_HANDOFF_SIGNING_KEY"
    payment_webhook_token          = "PAYMENT_WEBHOOK_TOKEN"
  }
  canonical_indexes = {
    for index in jsondecode(file("${path.module}/../firestore.indexes.json")).indexes :
    "${index.collectionGroup}-${substr(sha1(jsonencode(index)), 0, 12)}" => index
  }
}
