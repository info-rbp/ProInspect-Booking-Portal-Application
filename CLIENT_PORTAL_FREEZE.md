# Client Portal - Stage 1 branch freeze

Scope: isolated `client-portal` code readiness for Stage 2 integration. This is not production deployment approval and does not assert that the other portal schemas are already compatible.

## Acceptance gate

The freeze input is the exact commit recorded by the successful `Verify booking portal` run and its `client-stage1-evidence/stage1-source-sha.txt` artifact. Any later change invalidates that input until the full gate passes again. No broad feature work after acceptance; only tested defects, integration compatibility fixes and deployment corrections are permitted.

Permanent CI now includes TypeScript, production assets, Docker, runtime dependency audit, offline Terraform validation, a read-only migration-audit regression, and real HTTP/Auth/Firestore emulator tests. No production credentials, Calendar calls, live emails, infrastructure applies or production data writes are used by these tests.

## Reviewed branch-local repairs

- Concurrent initial sign-ins create one organisation/membership, not duplicates.
- Disabled identities and revoked memberships cannot be recreated by signing in.
- Sensitive writes re-read active membership/role authority within their transaction.
- Historical bookings are not automatically claimed by matching email. A claim requires the secret management token and matching verified identity.
- Attachment links and draft/approval publication use transactional updates; expired generation leases cannot release or publish a newer worker's lease.
- Approval decisions are scoped and single-winner.
- Archived files and cross-organisation file relationships are denied.
- Authenticated responses use no-store; normal responses omit management tokens and internal storage paths.

See `scripts/verify-stage1.ts` for executable security and concurrency cases. The temporary source-archive and write-enabled repair workflows have been removed. Normal verification has read-only repository permission.

## Migration readiness

Run the read-only inventory with explicit project/database arguments in staging:

```
FIREBASE_PROJECT_ID=STAGING_PROJECT FIRESTORE_DATABASE_ID='(default)' npx tsx scripts/audit-client-migration.ts --read-only --project STAGING_PROJECT --database '(default)' --report client-migration-audit.json
```

The tool paginates all eight relevant collections and fails on orphan or cross-organisation relationships. It never changes Firestore. Review the resulting identifiers privately. No production dataset has been inventoried by this Stage 1 change.

Stage 2 must map `clientOrganisations` to canonical `clients`, `clientProperties` to `properties` plus `clientPropertyLinks`, and `clientDocuments` to `propertyDocuments`. Preserve source IDs in a mapping ledger, user roles, revocations, attachment references and original object locations/bucket names. Matching an email or address must never create a new access grant. Keep ambiguous duplicate properties and legacy ownership claims for explicit resolution. Do not run independent Admin and Tenant migrations consecutively without first reconciling their contracts.

## Remaining release gates belong to Stages 2-4

Cross-portal schema convergence; combined UI/routing; Google Cloud staging/production configuration and migration rehearsal; Calendar/Workspace permissions; actual storage IAM; final Sheets/Apps Script delivery; and report-tool handoff are not performed by Stage 1. The existing application must continue accepting public bookings and management links. Production `main` remains unchanged.
