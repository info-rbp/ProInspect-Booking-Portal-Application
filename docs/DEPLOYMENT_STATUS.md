# Deployment status and source-merge policy

Updated 4 October 2026.

The owner explicitly authorized consolidating the Cloudflare application into `main` while deferring non-blocking fixes. This supersedes the former merge-after-live-only sequence for repository integration; it does NOT waive production authentication, backup, migration reconciliation, or acceptance requirements.

`main` is the source-of-truth branch. A successful source merge is not a claim of completed production migration. Production remains a separate, explicitly requested and protected operation on `release/cloudflare-platform`. Merging source does not change Cloudflare production DNS or run the legacy GCP deployment.

## Confirmed evidence

- The protected one-time workload federation bridge succeeded: GitHub Actions run 37169942417.
- Cloudflare source verification passed at 54aad8f3e139fd0ee6c3d6f84cd897d09bf003f1: run 37170777329.
- Cloudflare account readiness passed: run 37170931968. Readiness is not email delivery or deployment acceptance.
- Staging resources, D1 schema, maintenance Worker, keyless Google authentication and isolated runtime secrets were installed successfully: run 37170857412.
- Its direct Firestore REST read returned HTTP 200. The migration identity has the required datastore roles; the remaining source-export failure was in the SDK transport. A bounded REST snapshot implementation and regression tests replace that path.
- Inspected Cloud Build triggers in `global` were disabled, and the `europe-west1` inventory was empty. These are the inspected scopes, not a claim about unknown external integrations.

## Release requirements still to be evidenced

Full staging source export, D1 import and zero-write replay, R2 hash reconciliation, calendar import, deployed business-flow and transactional email checks; production resource bootstrap; legacy writer freeze; final backups; final production migration and reconciliation; real Public/Client/Tenant/Staff and Report Tool acceptance; custom domain and WAF cutover; controlled live transactions; observation and closure.

Do not turn the production acceptance receipt flags on without observed evidence. Do not describe a queued email as inbox delivery. Do not use staging test-session fixtures on production. Retain the Google source and backups until the rollback period is explicitly closed.

## Workflow ownership

`cloudflare-verify.yml` verifies both `main` and the release branch. The former GCP verification and Stage 4 controllers are archived in `.github/legacy/` for recovery review. Their active workflow filenames are credential-free manual reference stubs. The completed temporary WIF enabler and request files are omitted when joining main's bridge history into the Cloudflare release tree.
