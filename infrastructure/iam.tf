resource "google_project_iam_member" "runtime_project_roles" {
  for_each = local.runtime_project_roles

  project = var.project_id
  role    = each.value
  member  = format("serviceAccount:%s", var.runtime_service_account_email)

  depends_on = [
    google_project_service.required,
    google_service_account.runtime,
  ]
}
