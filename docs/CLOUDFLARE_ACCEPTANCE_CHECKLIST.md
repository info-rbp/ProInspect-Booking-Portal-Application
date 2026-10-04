# Cloudflare V1 Acceptance Checklist

A release cannot be called complete because it builds or because the landing page loads.

## Source gate
- [ ] Exact release SHA passed `cloudflare-verify.yml`.
- [ ] Worker bundle audit reports zero Firebase/Google runtime inputs.
- [ ] D1 schema checksum matches reviewed manifest.
- [ ] No placeholder/dead production route is reachable.

## Staging
- [ ] Distinct staging D1/R2/Queues/Worker/secrets exist.
- [ ] Rehearsal Firestore->D1 migration succeeds twice; second pass writes zero records.
- [ ] Rehearsal Storage->R2 hashes reconcile.
- [ ] Public booking create/manage/cancel passes.
- [ ] Document request passes.
- [ ] Client sign-in/dashboard/request/document/approval/payment passes.
- [ ] Tenant sign-in/request/attachment/document/inspection passes.
- [ ] Forms 24–27, bond workflows and PCR pass.
- [ ] Form 2 restricted evidence is invisible to Client/ordinary operations.
- [ ] Staff RBAC role matrix passes.
- [ ] Work order/contractor/approval lifecycle passes.
- [ ] Report Tool round-trip passes.
- [ ] Queue/email delivery through the native Worker `send_email` binding reaches `sent` and the controlled staging sink receives the message.

## Production pre-traffic
- [ ] Cloudflare readiness passes D1/R2/Queues/Turnstile/Worker route/WAF capability gates, and exact-source staging has already proven Worker-bound email delivery.
- [ ] Production bootstrap deploys full Worker in maintenance mode.
- [ ] Legacy writer is frozen only after Cloudflare maintenance is verified.
- [ ] Final Firestore backup/export evidence exists.
- [ ] Final Firebase Storage inventory/hash evidence exists.
- [ ] Pre-migration D1 bookmark recorded.
- [ ] Final D1 migration reconciles counts/digest.
- [ ] Second D1 migration pass writes zero records.
- [ ] R2 SHA-256 reconciliation passes.
- [ ] External Google Calendar busy periods are represented in native scheduling.
- [ ] Post-migration D1 evidence recorded.
- [ ] Public/Client/Tenant/Staff production-resource acceptance passes before public traffic.

## Live
- [ ] `bookings.proinspect.systems` points to the accepted Worker.
- [ ] Controlled booking created, email/ICS received, booking managed and cancelled.
- [ ] Controlled document request processed.
- [ ] Controlled Client login/actions pass.
- [ ] Controlled Tenant login/actions pass.
- [ ] Controlled Staff login/actions pass.
- [ ] Controlled Report Tool PDF round-trip passes.
- [ ] Sensitive Form 2 isolation rechecked.
- [ ] Initial operational observation contains no unresolved severity-1/2 issue.

## Closure
- [ ] Cloudflare is the only writable application system of record.
- [ ] Legacy GCP is read-only rollback evidence.
- [ ] Accepted release is merged to `main`.
- [ ] `main` matches accepted production content.
- [ ] Legacy GCP code removal happens after acceptance.
- [ ] GCP infrastructure retirement happens only after the agreed rollback period.
