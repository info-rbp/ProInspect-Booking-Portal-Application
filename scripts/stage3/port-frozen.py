"""One-time source port; removed after permanent Stage 3 acceptance is installed."""
import json
import pathlib
import subprocess

root = pathlib.Path('.')
frozen = '67f6e3c8a3af02e2f2a98b300510aff4aff38449'
base = '401817592cc186259940e46aa3459fa5a511ee1f'
def read(ref, path):
    return subprocess.check_output(['git', 'show', f'{ref}:{path}'], text=True)
for name in subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', frozen, 'infrastructure'], text=True).splitlines():
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(read(frozen, name))
p = root / 'infrastructure/variables.tf'
text = p.read_text()
for default in ['production', 'europe-west1', 'australia-southeast1']:
    text = text.replace(f'  default     = "{default}"\n', '')
text = text.replace('variable "environment" {', '''variable "environment" {
  validation {
    condition = contains(["staging", "production"], var.environment) && (var.environment != "staging" || var.project_id != "business-plan-applicatio-17047")
    error_message = "Choose an environment explicitly; staging must use a separate project."
  }''')
p.write_text(text)
for name in ['storage.tf', 'secrets.tf']:
    p = root / 'infrastructure' / name
    text = p.read_text().replace('  depends_on = [', '  lifecycle { prevent_destroy = true }\n\n  depends_on = [', 1)
    text = text.replace('  member = format("serviceAccount:%s", var.runtime_service_account_email)', '  member = format("serviceAccount:%s", var.runtime_service_account_email)\n  depends_on = [google_service_account.runtime]')
    p.write_text(text)
p = root / 'infrastructure/iam.tf'
p.write_text(p.read_text().replace('  depends_on = [', '  depends_on = [\n    google_service_account.runtime,'))
p = root / 'infrastructure/platform.tf'
p.write_text(p.read_text().replace('replication { auto {} }', 'replication {\n    auto {}\n  }'))
(root / 'infrastructure/versions.tf').write_text('''terraform {
  required_version = ">= 1.10.5, < 2.0"
  required_providers {
    google = { source = "hashicorp/google", version = "6.49.2" }
  }
  backend "gcs" {}
}
''')
(root / 'infrastructure/bootstrap.sh').write_text('#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/.."\nexec python3 scripts/stage3/control.py bootstrap "$@"\n')
p = root / 'infrastructure/environments/production.tfvars'
p.rename(p.with_suffix('.tfvars.reference'))
(root / 'infrastructure/backend.hcl.example').write_text('# Use an explicit reviewed environment descriptor. Production retains booking-portal/production.\n')
text = read(base, 'scripts/migrate-unified-portal.ts')
text = text.replace("import { adminDb } from '../src/server/firebaseAdmin.js';", "import { runMigration } from './stage3/migration-engine.js';\nimport { pathToFileURL } from 'node:url';")
text = text.replace("const apply = process.argv.includes('--apply');", "// Only the private planning database is exposed to transform.\nconst apply = true;")
text = text.replace('async function main() {', 'export async function transform(adminDb: any) {\n  const legacyPropertyIds = new Map<string, string>();')
text = text.replace('normalise(property.state).toUpperCase()', "normalise(property.state || 'WA').toUpperCase()")
text = text.replace('    dryRun: !apply,', "    dryRun: !process.argv.includes('--apply'),")
text = text.replace("  if (!apply) {\n    console.log('Dry run only.", "  if (!process.argv.includes('--apply')) {\n    console.log('Dry run only.")
text = text.replace('main().catch((error) => {', "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMigration(transform).catch((error) => {")
text = text.replace('const user = doc.data() as any;', 'const user = (await doc.ref.get()).data() as any;')
text = text.replace("nextRoles[clientId] = index === 0 ? 'owner' : 'member';", "nextRoles[clientId] = 'viewer'; // Never infer ownership from array position.")
text = text.replace('      if (!membershipDoc.exists) {', "      const matchingMembership = (await adminDb.collection('clientMemberships').get()).docs.find((m: any) => { const d = m.data(); return d.clientId === clientId && d.clientUserId === doc.id; });\n      if (!membershipDoc.exists && !matchingMembership) {")
text = text.replace('    const nextClientIds = Array.from(new Set([...currentIds, clientId]));', "    const nextClientIds = status === 'active' ? Array.from(new Set([...currentIds, clientId])) : currentIds.filter(id => id !== clientId);")
text = text.replace('    const nextRoles = { ...currentRoles, [clientId]: role };', "    const nextRoles = { ...currentRoles };\n    if (status === 'active') nextRoles[clientId] = role; else delete nextRoles[clientId];")
text = text.replace("active: status === 'active' && current.active !== false,", 'active: nextClientIds.length > 0 && current.active !== false,')
text = text.replace('    const propertyId = propertiesByAddress.get(key) || old.id || doc.id;', '    const propertyId = propertiesByAddress.get(key) || old.id || doc.id;\n    legacyPropertyIds.set(doc.id, propertyId);')
text = text.replace('          propertyId: rawPropertyId,', '          propertyId: legacyPropertyIds.get(rawPropertyId) || rawPropertyId,')
text = text.replace('membershipSnapshot.docs.filter((doc) =>', 'membershipSnapshot.docs.filter((doc: any) =>')
text = text.replace('clientSnapshot.docs.map((doc) =>', 'clientSnapshot.docs.map((doc: any) =>')
(root / 'scripts/migrate-unified-portal.ts').write_text(text)
text = read(base, 'scripts/verify-tenant-migration-preflight.ts')
text = text.replace('  await batch.commit();', "  batch.set(adminDb.collection('clientPropertyLinks').doc('fixture-property-link'), {clientId:'client-existing', propertyId:'property-existing', role:'owner', active:true});\n  await batch.commit();")
(root / 'scripts/verify-tenant-migration-preflight.ts').write_text(text)
(root / '.gitignore').write_text(read(base, '.gitignore') + '\nprivate-evidence/\n**/.terraform/\n*.tfstate\n*.tfstate.*\n*.tfplan\n*.auto.tfvars*\n**/imports.generated.tf\ninfrastructure/environments/*.local.json\ngha-creds-*.json\n')
data = json.loads(read(base, 'package.json'))
data['scripts']['stage3:test'] = 'node --import tsx --test scripts/stage3/tests/*.test.ts'
data['scripts']['stage3:check'] = 'python3 scripts/stage3/control.py check-repository'
(root / 'package.json').write_text(json.dumps(data, indent=2) + '\n')
