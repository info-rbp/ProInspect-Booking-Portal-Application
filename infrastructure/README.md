# ProInspect combined-platform infrastructure

The canonical operating procedure is **[STAGE3_INFRASTRUCTURE.md](../STAGE3_INFRASTRUCTURE.md)**. Start there, not from the old Client-only cloudbuild instructions.

This directory generalises the frozen Client infrastructure at `67f6e3c8a3af02e2f2a98b300510aff4aff38449`. Original resource addresses (`google_storage_bucket.client_documents`, `google_secret_manager_secret.runtime`, API enablement and runtime IAM) remain stable so existing state can be reused. The historical `client_documents` name is an ownership address, not a separate portal database or storage authority.

Terraform owns APIs, private document/operations storage, Secret Manager containers and resource-scoped access, optional database/runtime identity adoption, canonical indexes, optional deny-all browser rules, Artifact Registry, separated build/deploy/migration identities and tightly scoped staging GitHub federation. It does **not** own the existing Cloud Run service, revisions, traffic or secret payload versions.

Use explicit environment/project/backend values. Production examples are inventory references, not assertions about live resources. Production bucket selection is mandatory: deriving a new empty bucket and switching the runtime is forbidden. Existing resources are imported before management; they are not recreated. Never initialise a second backend to manage the same production resources. Keep the existing production state prefix `booking-portal/production`; use a separate staging project and prefix.

`bootstrap.sh` creates only staging prerequisites, the Firestore service identity and protected state storage. `scripts/stage3/infra.mjs` provides inventory, reviewed imports, saved-plan inspection and staging-only apply. Delete/replace, authoritative IAM, public access, runtime-service ownership and secret-payload resources are rejected. A saved plan's approval hash and explicit target are required for apply. No production apply is implemented in the Stage 3 path.

The provider lockfile must be committed and checked using `terraform init -lockfile=readonly`. CI uses Terraform 1.10.5, Google provider 6.49.2 and mock-provider safety tests. Those tests do not authenticate to or mutate Google Cloud.
