# Deployment status and source-merge policy

Updated 4 October 2026.

The owner explicitly authorized consolidating the Cloudflare application into `main` while deferring non-blocking fixes. This supersedes the former merge-after-live-only sequence for repository integration; it does NOT waive production authentication, backup, migration reconciliation, or acceptance requirements.

## Repository integration

PR #22 merged the Cloudflare application into `main` as `a3220e5ade96495d637852a686e32183a39962df`. Both its PR verification (37171224565) and post-merge verification (37171286378) passed. Follow-up deployment corrections are collected in PR #24.

`main` is the source-of-truth branch. Production remains a separate, explicitly requested and protected operation on `release/cloudflare-platform`. A source merge does not certify completed production migration or switch the production custom domain.

## Confirmed operational evidence

- The protected one-time workload federation bridge succeeded: run 37169942417.
- Cloudflare account capability readiness succeeded: run 37170931968. This is not email delivery or production acceptance.
- Run 37172010355 deployed and verified staging at exact source `e1df6c23ee233ff43cf8ea5eecc9baae5b420cf5`.
- The read-only Firestore export captured 45 source records across 36 approved collections twice, with matching content fingerprints. Canonical transformation occurred in memory; the Google source was not modified.
- Native scheduling imported four genuinely busy external calendar intervals; 63 cancelled or transparent entries were correctly excluded. All-day busy interval conversion is covered by Perth and daylight-saving tests; no non-transparent all-day interval was present in this run.
- The staging D1 migration completed and its repeated execution inserted zero additional records. Imported record hashes were reconciled by the migration runner.
- The referenced-storage migration step completed with zero objects because this source snapshot contained no referenced files. This does not constitute a live non-empty R2 upload/download acceptance test.
- The migrated staging Worker was deployed in live mode, and exact-source public catalogue, page and unauthenticated-portal checks passed.
- A controlled staging booking was created, its calendar invitation retrieved, and the booking cancelled. Email acceptance did not pass: the old polling loop hit the public management rate limit while waiting for delivery. The polling implementation, attachment mapping and private error-code diagnostics were subsequently corrected and require a fresh exact-source rehearsal.
- Inspected Cloud Build triggers in `global` were disabled, and `europe-west1` contained none. These are the inspected scopes, not a claim about unknown external integrations.

## Outstanding operational acceptance

The complete staging gate still requires verified transactional email and real browser/portal, non-empty R2 and Report Tool acceptance. Production bootstrap, legacy writer freeze, final backups, final D1/R2 migration, pre-traffic acceptance, WAF/custom-domain cutover, controlled live transactions, observation and closure remain separately gated. Track these in issue #23.

Do not set production acceptance flags without observed evidence. A queued message or provider response does not prove inbox delivery. Never use staging test-session fixtures on production. Retain the Google source and backups until the rollback period is explicitly closed.

## Deployment-controller corrections

The release includes a bounded consistent REST source export; narrow read-only Calendar OAuth scope; timed/all-day timezone handling; exact migration CLI entry detection; environment-matched storage configuration; exact deployed SHA checks with propagation retries; same-source staging control metadata validation; acceptance receipts loaded from their validated control commit; and correctly serialized failure statuses.

Production login and booking/email checks run at pre-traffic acceptance after the candidate exists, before custom-domain cutover. Real operator session or Turnstile evidence is required; credentials and acceptance receipts are not manufactured.

## Workflow ownership

`cloudflare-verify.yml` verifies `main` and the release branch. Former GCP verification and Stage 4 controllers are archived in `.github/legacy/` for recovery review. Their active filenames are credential-free manual reference stubs. Completed temporary WIF helper workflows and request files have been retired from main.
