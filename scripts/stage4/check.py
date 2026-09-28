from pathlib import Path
import json
import subprocess
root=Path(__file__).resolve().parents[2]
files=["scripts/stage4/release.py","scripts/stage4/common.py","scripts/stage4/migrate.ts",
 "scripts/stage4/checkpoints.py","scripts/stage4/integrations.ts","scripts/stage4/record-companion.ts",
 "scripts/stage4/bootstrap.py","scripts/stage4/request.py","src/server/productionReleaseGate.ts",
 "src/server/productionMaintenance.ts",".github/workflows/stage4-production.yml",
 "infrastructure/stage4.tf","infrastructure/environments/production.example.json",
 "STAGE4_PRODUCTION_CONTRACT.md","docs/STAGE4_PRODUCTION_RUNBOOK.md"]
for name in files:
    if not (root/name).is_file():raise SystemExit("Missing production implementation: "+name)
s=(root/"scripts/stage3/migration-engine.ts").read_text()
if "validateTarget(target, true);" not in s or "Production apply is locked in Stage 3" not in s:
    raise SystemExit("The original Stage 3 production guard must remain intact.")
workflow=(root/".github/workflows/stage4-production.yml").read_text()
for expected in ["environment: production","id-token: write","actions: read","stage4/request.py",
                 "STAGE4_PRODUCTION_CONFIG_B64","GCP_WORKLOAD_IDENTITY_PROVIDER"]:
    if expected not in workflow:raise SystemExit("Missing workflow policy: "+expected)
for forbidden in ["credentials_json:","pull_request_target:","contents: write"]:
    if forbidden in workflow:raise SystemExit("Unsafe production workflow permission/credential/trigger.")
verify=(root/".github/workflows/verify.yml").read_text()
for name in ["stage4:check","stage4:test:controls","stage4:test"]:
    if name not in verify:raise SystemExit("Production tests missing from permanent CI.")
if "PRODUCTION_RELEASE_ID" not in (root/"server.ts").read_text():
    raise SystemExit("Production startup must not seed before acceptance.")
subprocess.run(["git","merge-base","--is-ancestor","ceebc2f0d312aec6ab68b796a90e04219e771696","HEAD"],cwd=root,check=True)
print("Stage 4 repository contract passed. This is not live production acceptance.")
