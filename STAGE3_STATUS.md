# Stage 3 implementation and acceptance status

Date: 28 September 2026

## Repository implementation

Implementation branch: `stage3/infrastructure-rehearsal`.

Accepted Stage 2 core: `ceebc2f0d312aec6ab68b796a90e04219e771696`.
Accepted independent Report Tool companion: `247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707`.
Source implementation commit: `181ae59c4640f903fc43711bef96957a631c61a4`.

The source was recorded only after implementation verification run **36428116787** passed application regressions, 36 unit/runtime safety tests, Terraform 1.10.5/provider 6.49.2 validation, four Terraform mock tests, a real Firestore-emulator migration rehearsal and production Vite/Docker builds. The initial timestamp test incorrectly expected sub-microsecond precision from persisted Firestore data; it was corrected to compare the persisted source timestamp before and after migration. The migration code did not lose stored timestamp precision.

The permanent **Verify booking portal** workflow now additionally runs these Stage 3 gates at each accepted source commit. Its exact-head result, not the implementation-run result alone, is required for repository acceptance. The checked-in Terraform provider lock is used read-only. Stage 2 architecture, security, dry-run immutability, build and container gates remain in force.

`STAGE3_INFRASTRUCTURE.md` contains the ownership/import plan, bootstrap and environment contract, numeric secret provisioning/rotation, staging deployment, Workspace configuration, migration/reconciliation/rollback commands and full operational acceptance checklist.

## Concurrent integration branch changes

The release branch advanced from `401817592cc186259940e46aa3459fa5a511ee1f` to `638d8f17f7c091991b73c6a53ce1fab1e6008a26` during this implementation, including a separate infrastructure and migration implementation. A non-fast-forward update was rejected. No force push was used and that work was not overwritten.

This branch therefore remains a separate proposal for review/reconciliation into `release/platform-unification`; it is not a declaration that the release branch contains these changes. Reconcile the overlapping infrastructure, migration command and temporary port-workflow ownership explicitly, then run the permanent gate at the exact combined head. Do not preserve two authoritative migration engines or two owners of the same Terraform resources. No merge into production `main` is authorised.

## Real-environment acceptance: NOT EXECUTED

The following need real, approved cloud configuration and evidence, not example IDs or emulator results:

- Existing-resource inventory/import, sole Terraform state ownership, reviewed staging plan/apply, ready indexes and drift/privacy/IAM checks.
- Dedicated staging Firebase Auth providers/domains, actual numeric secret versions, runtime impersonation and Workspace Calendar Writer sharing.
- Repeatable private staging Cloud Run deployment and authenticated portal, booking, file and Calendar journeys without customer email/payment side effects.
- Representative staging data migration with approved mappings, fresh export, exact count/content reconciliation, file-reference validation and zero-write rerun evidence.
- Separate Report Tool staging Worker/D1/R2, paired secrets and an IAM-compatible callback path; finalise/publish/retry acceptance.

The scripts do not contact or mutate a real cloud project during CI. Production infrastructure apply and migration writes are locked pending the separately approved release/cutover stage. A passing repository build does not close the real-environment checklist. Stage 3 as an operational stage remains open until that evidence exists.
