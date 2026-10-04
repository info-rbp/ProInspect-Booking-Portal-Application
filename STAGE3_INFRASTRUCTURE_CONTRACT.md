# Stage 3 - Infrastructure and migration acceptance contract

## Status and boundary

This file defines **repository implementation acceptance**, not a claim that a
Google Cloud project has been provisioned or live staging has passed. Repository
acceptance requires the normal **Verify booking portal** workflow to pass at the
exact release-branch commit. Operational acceptance additionally requires the
private evidence described below. An emulator run is never live-cloud evidence.

Source baseline: Stage 2 `ceebc2f0d312aec6ab68b796a90e04219e771696`.
Production main baseline: `6a55131f5890b82047d8b78d2af2bdc6f140041f`.
Separate Report Tool: `info-rbp/Property-Report-Tool`, accepted companion
`247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707`.

No Stage 3 command merges main, deploys the production Cloud Run service, or
applies a production data migration. Production dry-run inspection remains
available with its explicit frozen project/database. Stage 4 owns cutover.

## Ownership and infrastructure

Terraform owns APIs, runtime/build/deploy/migration/gateway identities, private
versioned storage, secret **containers only**, canonical indexes, Firestore
rules, a protected PITR-enabled database and daily backups, Firebase web-app
configuration, Artifact Registry and constrained GitHub workload federation.
It does not own the existing Cloud Run application service definition.

The original Client infrastructure addresses are retained. Inventory is paged,
existing matching resources generate reviewed configuration imports, and
already-managed state addresses are not re-imported. Existing production state
must keep `booking-portal/production`; staging uses its own project, bucket and
`platform/staging` prefix. A resource may have only one Terraform state owner.
Explicit state moves/removals must be separately reviewed; this tooling does not
silently steal another state's objects.

Plans fail on unapproved deletion/replacement, protected-object destruction,
public bucket access, unprotected Firestore, secret payload resources, a
cross-project resource or competing Cloud Run service ownership. Apply uses the
saved binary plan, its exact approval digest, matching descriptor and source,
and a 24-hour age limit. There is no automatic production apply default.

## Authentication and secret handling

Runtime, Terraform, build, deployment, migration and gateway accounts are
separate. Operators impersonate the named identities; service-account JSON keys
are not deployed. Runtime gets self-signing permission for private document
signed URLs. The staging migration identity has database-owner capability for
scratch restore creation within its isolated project; remove that elevated
capability after rehearsal if ongoing restore automation is not needed.

Secret versions must be numeric, enabled and explicitly selected. Missing
required encryption, email, report handoff or report-ingest secrets block the
candidate. Optional payments require their webhook secret when checkout is
configured. No secret payload is written into Terraform variables/state,
repository files, build arguments or acceptance artifacts.

`auth.py` configures Google sign-in and tenant email links, authorized domains,
and the supplied Google OAuth client secret using the Identity Platform API.
The secret is fetched in memory from its configuration-only secret container;
it is not bound to the application runtime. Google OAuth client registration,
consent/test-user settings and any organization policy remain explicit external
inputs. Never invent those values or accept placeholder configuration.

Do not rotate `ACCESS_DATA_ENCRYPTION_KEY` by replacing it blindly: existing
ciphertext requires the old key. Re-encryption/key-ring migration needs a
separate reviewed procedure. Likewise coordinate both sides of the Report Tool
handoff/ingest key change and retain the prior enabled versions for rollback.

## Staging deployment and integrations

Builds use an exact accepted source SHA and a staging-specific Firebase browser
configuration. The resulting image digest and browser-config digest are recorded.
The new candidate is private and tagged. Existing service traffic stays on its
previous revisions; on first creation, only IAM-authorized callers can reach the
new private service. Page, health, catalogue, unauthenticated portal and invalid
report-ingest smoke checks run before deployment evidence is accepted.

The separate Cloudflare Report Tool cannot call a private Cloud Run service with
an application HMAC token alone. A **dedicated report-only gateway** bridges that
boundary. `deploy.py gateway` requires explicit staging-project approval, uses
the same immutable image with a separate entry point/account, and publishes
only `/api/integrations/reports` plus a minimal health endpoint. It authenticates
the report secret before parsing the body, limits PDF uploads, gets a short-lived
Google identity token, and forwards to the exact private core candidate. It does
not expose portal routes or receive database/storage/email credentials. Only this
separate gateway receives public invoker access; the core remains private.

Staging Resend notifications are redirected to one configured test mailbox.
Firebase authentication emails are not Resend notifications: use only authorized
synthetic test accounts in staging. A Resend submission ID proves provider
acceptance, not inbox delivery.

Live integration probes verify runtime Firestore and private storage CRUD,
private-download signing capability, canonical index readiness, Calendar
free/busy and event creation/update/deletion, authentication configuration,
secret format, email submission, and gateway-to-core report publication/retry.
An HTTP-200 Calendar response containing per-calendar errors is a failure.
The Calendar must be shared with the runtime account separately in Workspace.
Transient probe records/events are cleaned up; the staff-only synthetic issued
report and property are retained so their immutable audit history remains valid.

## Migration safety and recovery

The canonical migration runs against an isolated in-memory snapshot first.
Source ambiguity and resulting referential/access integrity are checked before
any Firestore writer is exposed. Missing roles default to viewer, not ownership;
revoked relationships do not regain access; conflicting Firebase identities,
property addresses and legacy document collisions stop the plan.

Apply requires the exact plan digest, source code, target, recent successful
managed export and verified restore. It rechecks source content and preimages
inside a single Firestore transaction, then commits all changes atomically.
Native timestamps, bytes, geo-points and references are preserved; references
cannot be silently redirected to another project/database. There are deliberate
rehearsal bounds: **20,000 scoped source documents, 400 changed documents and
7 MiB of serialized changes**. Larger datasets stop without partial writes and
need a separately reviewed partitioned migration; there is no unsafe batching
fallback. Subcollections/unknown collections are not transformed.

`rehearse.py backup` verifies an actual completed Firestore managed export and
unchanged source fingerprints. The export covers the entire database. Restore
imports into a **new uniquely named scratch database**, never over the application
database. Content hashes and counts are checked for the declared migration
collections. This is not a claim of content-by-content validation for undeclared
collections or subcollections. The scratch database is retained for inspection;
its later deletion is a separate explicit operator action.

Quiesce staging writers from dry-run through backup/restore/apply/repeat. This
includes background jobs and other administrators, not just Cloud Run traffic.
Any changed source invalidates the plan. Operational closure rejects an empty
rehearsal dataset and requires a zero-change repeat plan after successful apply.
Use a representative, de-identified dataset; do not publish real migration plans.

## Permanent repository gate

The normal workflow runs locked installation, dependency audit, TypeScript,
Stage 1/2 architecture gates, original emulator dry-run immutability, Stage 3
migration/integration/gateway tests, Python control-plane tests, Terraform
format/locked offline initialization/validation/mocked plan tests, production
Vite build and Docker build. It has read-only repository permissions and no cloud
credentials. All temporary port/review/workspace workflows are removed.

Only a fully successful run emits `stage3-repository-acceptance`; it is marked
`synthetic: true` and `liveCloudAcceptance: false`. No real state, plan, credential,
customer data or operational evidence is uploaded to public CI artifacts.

## Live closure gate

`control.py close` requires recent successful evidence for the **same source,
project, database and environment**: infrastructure apply; reviewed dry run;
managed-backup restore; atomic apply; zero-write repeat; immutable candidate;
report gateway; integration probes; create/manage/cancel booking smoke; and a
real separate Report Tool round trip. Revision IDs, image digests, migration
plan/hash links and integration check results must agree.

The Report Tool round trip is not replaced by the synthetic ingest probe.
An operator opens a real handoff in the isolated companion, finalizes its PDF
and records the receipt. `record-companion.ts` checks the actual canonical staff
handoff audit, property/report context, temporal order and issued PDF hash.
The separately deployed Cloudflare source SHA is **operator-attested**, supported
by a deployment evidence reference; this script does not query or certify a
Cloudflare deployment. That distinction remains in the saved evidence.

The resulting `stage3-acceptance.json` is a private operational record, not
production approval. Staging promotion invokes this complete gate. Rollback
restores the recorded prior staging traffic allocation; it never deletes data,
recreates infrastructure, or rolls a database back automatically.

See `infrastructure/README.md` for the execution sequence and remaining external
configuration inputs. Until those real operations pass, operational Stage 3 is
open even when repository CI is green.
