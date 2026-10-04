resource "google_project_service" "required" {
  for_each = var.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
