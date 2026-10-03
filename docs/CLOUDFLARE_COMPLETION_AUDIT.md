# Cloudflare Completion Audit

This is the finite backlog against the approved 50-point completion plan. “Implemented” means the repository capability exists and permanent CI exercises it; it does **not** mean production acceptance has happened.

| # | Plan item | Status |
|---:|---|---|
| 1 | Freeze GCP cutover | Complete — legacy Stage 3/4 deployment workflows are legacy-only; no GCP maintenance approval is part of the Cloudflare path. |
| 2 | Dedicated Cloudflare branch | Complete — `release/cloudflare-platform`. |
| 3 | Lock V1 contract | Complete — `CLOUDFLARE_V1_CONTRACT.md`. |
| 4 | Product/route audit | Complete at source level; obsolete sign-in placeholder removed. Real-browser acceptance remains item 32/41. |
| 5 | Cloudflare foundation | Implemented — Wrangler, Worker, Vite assets, bindings and environment generators. |
| 6 | Port API runtime | Implemented — reviewed Express API is bundled behind the Worker with Cloudflare adapters. |
| 7 | D1 schema | Implemented — canonical per-domain D1 tables, relationship columns, indexes and auth/outbox/migration tables. |
| 8 | Remove Firestore runtime coupling | Implemented — D1 compatibility data layer replaces Firebase Admin inside the Worker bundle. |
| 9 | Transactional scheduling | Implemented — D1 plus BookingCoordinator Durable Object. |
| 10 | Remove Google Calendar system-of-record | Implemented — native scheduling plus ICS; legacy external busy periods are imported during migration. |
| 11 | Replace Google Maps dependency | Implemented — structured/manual Australian address handling. |
| 12 | Replace Firebase Auth | Implemented — D1 identities, one-time email sessions, HTTP-only cookies, Turnstile; Access optional for Staff. |
| 13 | Staff RBAC | Implemented and security-tested. |
| 14 | Firebase Storage -> R2 runtime | Implemented — separate ordinary/sensitive bindings and authenticated downloads. |
| 15 | Application encryption | Implemented with key IDs and backward key-version support. |
| 16 | Public booking | Implemented/local acceptance passed; real production transaction outstanding (#43). |
| 17 | Document Request product | Implemented; staging/production acceptance outstanding (#32/#41/#43). |
| 18 | Client Portal | Implemented; production authentication/business acceptance outstanding. |
| 19 | Tenant Portal | Implemented; production authentication/business acceptance outstanding. |
| 20 | WA statutory workflows | Implemented; automated isolation/approval coverage exists; production acceptance outstanding. |
| 21 | Maintenance/work orders | Implemented; automated canonical lifecycle coverage added. |
| 22 | Approvals | Implemented; automated work-order and statutory approval propagation coverage added. |
| 23 | Report Tool | Implemented; authenticated idempotent PDF/R2/audience coverage added; live round-trip outstanding. |
| 24 | Queues | Implemented for transactional email/retries. |
| 25 | Workflows | Deferred by V1 contract — no launch-critical process currently requires a new orchestration subsystem. |
| 26 | Email architecture | Code complete; Cloudflare Email Sending permission/onboarding is an external blocker. |
| 27 | Payment boundaries | Implemented/provider-neutral; authenticated status webhook plus Client/Staff visibility covered in CI. |
| 28 | Cloudflare security | Worker headers/CSP/origin limits/body limits/rate limits/CSRF/Turnstile/secrets/audit implemented. Zone WAF activation remains account/custom-domain work. |
| 29 | Staging/production isolation | Repository support complete; actual staging resources/deployment remain token-blocked. |
| 30 | Replace GCP CI/CD | Cloudflare verify/production workflows implemented; legacy GCP controls retained only for rollback evidence until acceptance. |
| 31 | Expanded automated testing | Unit/API/Worker coverage strong; browser-level staging flows remain outstanding. |
| 32 | Full staging acceptance | Outstanding — requires isolated Cloudflare staging resources and valid D1/R2/Email token permissions. |
| 33 | Firestore -> D1 engine | Implemented with deterministic digest/reconciliation. |
| 34 | Storage -> R2 engine | Implemented with MIME preservation and SHA-256 round-trip verification. |
| 35 | Rehearsal migrations | Outstanding — staging-resource blocked. |
| 36 | Backup/rollback | Repository controls implemented/hardened; execution awaits production resources and cutover. |
| 37 | Prepare production resources | Outstanding execution — current token lacks D1, R2 and Email permissions. |
| 38 | Freeze legacy writes | Not executed by design; first final-migration action after Cloudflare acceptance. |
| 39 | Final GCP backup | Not executed; belongs immediately after freeze. |
| 40 | Final migration | Not executed; workflow implementation exists. |
| 41 | Pre-traffic production acceptance | Outstanding. |
| 42 | Custom-domain cutover | Outstanding. Current `workers.dev` URL is not accepted `bookings.proinspect.systems` cutover. |
| 43 | Controlled live transactions | Outstanding. |
| 44 | Initial observation | Outstanding and necessarily post-live. |
| 45 | Cloudflare system of record | Outstanding until live acceptance. |
| 46 | Merge accepted release to main | Outstanding; must not occur before production acceptance. |
| 47 | Remove obsolete GCP code | Post-acceptance only. |
| 48 | Retire GCP infrastructure | Post-rollback-window only. |
| 49 | Production documentation | Repository documentation complete; legacy GCP docs are retained as rollback evidence until #47. |
| 50 | Declare V1 complete | Outstanding final gate. |

## Active blockers

1. GitHub `CLOUDFLARE_API_TOKEN` currently cannot access D1, R2 or Email Sending.
2. Isolated staging has not yet been provisioned or accepted.
3. Production data has not been frozen/backed up/migrated.
4. No pre-traffic production user acceptance or controlled live transaction has occurred.
5. `main` still represents the legacy production architecture.

Everything after #37 is intentionally blocked from execution until the earlier gates pass.
