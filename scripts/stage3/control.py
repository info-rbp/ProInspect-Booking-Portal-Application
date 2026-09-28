#!/usr/bin/env python3
"""Stage 3 control plane. All cloud commands require an explicit environment file.

No command deploys or migrates production. Plans, state and data-bearing evidence
are private files; only synthetic verification artifacts belong in public CI.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_PROJECT = 'business-plan-applicatio-17047'
PRODUCTION_DATABASE = 'ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a'
BASE_SHA = 'ceebc2f0d312aec6ab68b796a90e04219e771696'
REPO = 'info-rbp/ProInspect-Booking-Portal-Application'
STATEFUL = {'google_storage_bucket', 'google_firestore_database', 'google_secret_manager_secret', 'google_artifact_registry_repository', 'google_service_account', 'google_firebase_web_app'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(value):
    raw = value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(json.dumps(value, indent=2, sort_keys=True) + '\n')
    os.chmod(path, 0o600)


def run(args, *, data=None, env=None, json_output=False):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, input=data, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        # Never print argv/stdin: some future commands may contain secret payloads.
        raise RuntimeError(f'{args[0]} failed with exit {result.returncode}: {result.stderr[-1800:]}')
    return json.loads(result.stdout) if json_output else result.stdout.strip()


def sha():
    return run(['git', 'rev-parse', 'HEAD'])


def cloud(config, *args, json_output=True, data=None):
    return run(['gcloud', *args, '--project=' + config['projectId'], '--quiet', *(['--format=json'] if json_output else [])], json_output=json_output, data=data)


def api(config, url, *, optional=False):
    token = cloud(config, 'auth', 'print-access-token', json_output=False)
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if optional and error.code == 404:
            return None
        raise RuntimeError(f'Cloud inventory API failed with HTTP {error.code}; inventory is incomplete.') from None


def validate_config(c, *, mutate=False, allow_placeholders=False):
    require(c.get('schemaVersion') == 1, 'Environment schemaVersion must be 1.')
    require(c.get('environment') in ('staging', 'production'), 'Explicit staging or production environment required.')
    require(re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', c.get('projectId', '')), 'Invalid explicit project ID.')
    require(c.get('databaseId'), 'Explicit databaseId required.')
    t = c.get('terraform', {})
    require(t.get('project_id') == c['projectId'] and t.get('environment') == c['environment'] and t.get('firestore_database_id') == c['databaseId'], 'Descriptor/Terraform target mismatch.')
    require(c.get('state', {}).get('bucket') and c['state'].get('prefix'), 'Explicit state bucket and prefix required.')
    if c['environment'] == 'staging':
        require(c['projectId'] != PRODUCTION_PROJECT, 'Staging cannot use the production project.')
        require(c['state']['bucket'] != PRODUCTION_PROJECT + '-proinspect-terraform-state', 'Staging cannot share the production state bucket.')
        require(c['state']['prefix'] == 'platform/staging', 'Use the isolated platform/staging state prefix.')
        require(t.get('google_calendar_id') != 'c_4bf5fc54ee54bf60371059cf824ec7e018fb6c43ca66bbdd4051fafaa74e3c32@group.calendar.google.com', 'Staging cannot use the production Calendar.')
        require(t.get('report_tool_url', '').rstrip('/') != 'https://report.creation.proinspect.systems', 'Staging cannot call the production Report Tool.')
    elif c['projectId'] == PRODUCTION_PROJECT:
        require(c['databaseId'] == PRODUCTION_DATABASE, 'Production database does not match the frozen baseline.')
        require(c['state']['prefix'] == 'booking-portal/production', 'Preserve existing production state ownership; do not create a competing state prefix.')
    require(not mutate or c['environment'] == 'staging', 'Stage 3 blocks production mutation; Stage 4 owns cutover approval.')
    if not allow_placeholders:
        require('REQUIRED_' not in json.dumps(c) and 'CHANGE_ME' not in json.dumps(c), 'Complete the environment descriptor; placeholders cannot target cloud resources.')
    for key in ('runtime_service_account_email', 'terraform_service_account_email'):
        require(str(t.get(key, '')).endswith('@' + c['projectId'] + '.iam.gserviceaccount.com'), key + ' must belong to the selected project.')
    for address, resource_id in c.get('imports', {}).items():
        require(re.fullmatch(r'google_[a-z0-9_]+\.[a-z0-9_]+(?:\[(?:[0-9]+|"[a-zA-Z0-9_./@()-]+")\])?', address), 'Invalid Terraform import address.')
        require(isinstance(resource_id, str) and resource_id, 'Invalid resource import ID.')
    return c


def load_config(path, *, mutate=False):
    require(path, '--config is required; there is no production default.')
    return validate_config(read(path), mutate=mutate)


def workspace(config):
    path = ROOT / 'private-evidence' / 'stage3' / config['environment']
    path.mkdir(parents=True, exist_ok=True)
    return path


def tf(config, *args, json_output=False):
    env = {**os.environ, 'TF_DATA_DIR': str(workspace(config) / 'terraform-data'), 'GOOGLE_IMPERSONATE_SERVICE_ACCOUNT': config['terraform']['terraform_service_account_email']}
    return run(['terraform', '-chdir=infrastructure', *args], env=env, json_output=json_output)


def init(config):
    tf(config, 'init', '-input=false', '-reconfigure', '-lockfile=readonly', '-backend-config=bucket=' + config['state']['bucket'], '-backend-config=prefix=' + config['state']['prefix'], '-backend-config=impersonate_service_account=' + config['terraform']['terraform_service_account_email'])


def bootstrap(config, approval):
    require(approval == config['projectId'], '--approve must equal the staging project ID for one-time bootstrap.')
    project = cloud(config, 'projects', 'describe', config['projectId'])
    require(project.get('lifecycleState') == 'ACTIVE', 'Target project must exist, be active and have billing enabled.')
    apis = ['serviceusage.googleapis.com','cloudresourcemanager.googleapis.com','iam.googleapis.com','iamcredentials.googleapis.com','storage.googleapis.com','cloudbuild.googleapis.com','firestore.googleapis.com','firebase.googleapis.com','firebaserules.googleapis.com','secretmanager.googleapis.com','artifactregistry.googleapis.com','run.googleapis.com','identitytoolkit.googleapis.com','sts.googleapis.com']
    cloud(config, 'services', 'enable', *apis, json_output=False)
    existing = {a['email'] for a in cloud(config, 'iam', 'service-accounts', 'list')}
    for key in ('runtime_service_account_email', 'terraform_service_account_email'):
        email = config['terraform'][key]
        if email not in existing:
            cloud(config, 'iam', 'service-accounts', 'create', email.split('@')[0], '--display-name=ProInspect ' + config['environment'])
    buckets = {b['name'].removeprefix('gs://') for b in cloud(config, 'storage', 'buckets', 'list')}
    bucket = config['state']['bucket']
    if bucket not in buckets:
        cloud(config, 'storage', 'buckets', 'create', 'gs://' + bucket, '--location=' + config['terraform']['storage_location'], '--uniform-bucket-level-access', '--public-access-prevention', json_output=False)
    cloud(config, 'storage', 'buckets', 'update', 'gs://' + bucket, '--versioning', '--uniform-bucket-level-access', '--public-access-prevention', json_output=False)
    identity = config['terraform']['terraform_service_account_email']
    cloud(config, 'storage', 'buckets', 'add-iam-policy-binding', 'gs://' + bucket, '--member=serviceAccount:' + identity, '--role=roles/storage.objectAdmin')
    for role in ['roles/serviceusage.serviceUsageAdmin','roles/resourcemanager.projectIamAdmin','roles/iam.serviceAccountAdmin','roles/iam.workloadIdentityPoolAdmin','roles/storage.admin','roles/secretmanager.admin','roles/datastore.owner','roles/artifactregistry.admin','roles/firebase.admin']:
        cloud(config, 'projects', 'add-iam-policy-binding', config['projectId'], '--member=serviceAccount:' + identity, '--role=' + role, '--condition=None')
    principal = config.get('operatorPrincipal', '')
    require(principal.startswith(('user:', 'serviceAccount:')), 'Explicit operatorPrincipal required for Terraform impersonation.')
    cloud(config, 'iam', 'service-accounts', 'add-iam-policy-binding', identity, '--member=' + principal, '--role=roles/iam.serviceAccountTokenCreator')
    save(workspace(config) / 'bootstrap.json', {'status':'passed','projectId':config['projectId'],'environment':config['environment'],'completedAt':now(),'sourceSha':sha()})


def inventory(config):
    p = config['projectId']; database = config['databaseId']; region = config['terraform']['region']
    result = {'schemaVersion':1, 'projectId':p, 'databaseId':database, 'environment':config['environment'], 'capturedAt':now(), 'sourceSha':sha()}
    commands = {
        'project': ('projects','describe',p),
        'services': ('services','list','--enabled'),
        'buckets': ('storage','buckets','list'),
        'accounts': ('iam','service-accounts','list'),
        'secrets': ('secrets','list'),
        'databases': ('firestore','databases','list'),
        'repositories': ('artifacts','repositories','list','--location='+region),
        'cloudRun': ('run','services','list','--region='+region),
    }
    for key, command in commands.items():
        result[key] = cloud(config, *command)
    base = f'https://firestore.googleapis.com/v1/projects/{p}/databases/{database}'
    exists = any(d.get('name','').endswith('/databases/'+database) for d in result['databases'])
    result['indexes'] = api(config, base + '/collectionGroups/-/indexes').get('indexes',[]) if exists else []
    result['backupSchedules'] = api(config, base + '/backupSchedules').get('backupSchedules',[]) if exists else []
    result['firebaseProject'] = api(config, f'https://firebase.googleapis.com/v1beta1/projects/{p}', optional=True)
    result['webApps'] = api(config, f'https://firebase.googleapis.com/v1beta1/projects/{p}/webApps').get('apps',[]) if result['firebaseProject'] else []
    save(workspace(config) / 'inventory.json', result)
    print('Inventory captured. Review current state ownership before planning imports.')
    return result


def adoption_imports(config, inv, existing_addresses):
    p = config['projectId']; t = config['terraform']; env = config['environment']; prefix = 'proinspect-' + env
    result = dict(config.get('imports', {}))
    def add(address, rid):
        if address not in existing_addresses:
            result.setdefault(address, rid)
    enabled = {a.get('config',{}).get('name') for a in inv['services']}
    required = t.get('required_apis', ['addressvalidation.googleapis.com','artifactregistry.googleapis.com','calendar-json.googleapis.com','cloudbuild.googleapis.com','cloudresourcemanager.googleapis.com','firestore.googleapis.com','firebase.googleapis.com','iam.googleapis.com','iamcredentials.googleapis.com','identitytoolkit.googleapis.com','places.googleapis.com','run.googleapis.com','secretmanager.googleapis.com','serviceusage.googleapis.com','storage.googleapis.com'])
    for service in required:
        if service in enabled: add(f'google_project_service.required["{service}"]', p+'/'+service)
    for service in ['firebaserules.googleapis.com','sts.googleapis.com','logging.googleapis.com']:
        if service in enabled: add(f'google_project_service.stage3["{service}"]', p+'/'+service)
    for account in inv['accounts']:
        email = account['email']
        if email == t['runtime_service_account_email']: add('google_service_account.runtime', account['name'])
        for role in ['build','deploy','migration']:
            if email == f'{prefix}-{role}@{p}.iam.gserviceaccount.com': add(f'google_service_account.platform["{role}"]', account['name'])
    doc_bucket = t.get('client_documents_bucket_name') or f'proinspect-client-docs-{inv["project"]["projectNumber"]}-{env}'
    for b in inv['buckets']:
        name = b['name'].removeprefix('gs://')
        if name == doc_bucket: add('google_storage_bucket.client_documents', name)
        for role in ['release-evidence','migration-backups','build-sources']:
            if name == f'{p}-proinspect-{role}': add(f'google_storage_bucket.operations["{role}"]', name)
    for secret in inv['secrets']:
        for key in ['access_data_encryption_key','resend_api_key','google_maps_api_key','report_handoff_signing_key','report_ingest_token','payment_webhook_token']:
            if secret['name'].endswith('/'+prefix+'-'+key.replace('_','-')):
                resource = 'runtime' if key in ['access_data_encryption_key','resend_api_key','google_maps_api_key'] else 'integration'
                add(f'google_secret_manager_secret.{resource}["{key}"]', secret['name'])
    for d in inv['databases']:
        if d['name'].endswith('/databases/'+config['databaseId']): add('google_firestore_database.platform', d['name'])
    for r in inv['repositories']:
        if r['name'].endswith('/repositories/'+prefix): add('google_artifact_registry_repository.platform', r['name'])
    if inv.get('firebaseProject'): add('google_firebase_project.platform', p)
    web_id = config.get('existingFirebaseWebAppId')
    if web_id:
        require(any(a['appId']==web_id for a in inv['webApps']), 'Configured Firebase web app was not found in inventory.')
        add('google_firebase_web_app.platform', f'projects/{p}/webApps/{web_id}')
    else:
        matches = [a for a in inv['webApps'] if a.get('displayName') == f'ProInspect {env} portal']
        require(len(matches)<=1, 'Ambiguous existing Firebase web apps.')
        if matches: add('google_firebase_web_app.platform', f'projects/{p}/webApps/{matches[0]["appId"]}')
    daily = [b for b in inv['backupSchedules'] if 'dailyRecurrence' in b]
    require(len(daily)<=1, 'Multiple daily backup schedules require explicit adoption review.')
    if daily: add('google_firestore_backup_schedule.daily', daily[0]['name'])
    for idx in read(ROOT/'firestore.indexes.json')['indexes']:
        desired_fields = idx['fields']
        matches = [i for i in inv['indexes'] if i['name'].split('/collectionGroups/')[1].split('/')[0] == idx['collectionGroup'] and i.get('queryScope') == idx['queryScope'] and [f for f in i['fields'] if f['fieldPath']!='__name__'] == [f for f in desired_fields if f['fieldPath']!='__name__']]
        require(len(matches)<=1, 'Duplicate matching Firestore indexes require reconciliation.')
        if matches: add(f'google_firestore_index.canonical["{digest(idx)[:20]}"]', matches[0]['name'])
    return {a:i for a,i in result.items() if a not in existing_addresses}


def guard_plan(plan, config):
    changes = plan.get('resource_changes', [])
    for resource in changes:
        if resource.get('mode') == 'data': continue
        kind = resource['type']; actions = resource['change']['actions']
        require(kind not in ('google_cloud_run_service','google_cloud_run_v2_service'), 'Terraform must not own the application Cloud Run service.')
        require(kind != 'google_secret_manager_secret_version', 'Secret payloads must not enter Terraform state.')
        if 'delete' in actions:
            require(kind not in STATEFUL and resource['address'] in config.get('approvedEphemeralReplacements', []), 'Unapproved deletion/replacement: ' + resource['address'])
        after = resource['change'].get('after') or {}
        require(after.get('member') not in ('allUsers','allAuthenticatedUsers'), 'Public IAM grants are not allowed.')
        if kind == 'google_storage_bucket':
            require(after.get('public_access_prevention') == 'enforced' and after.get('uniform_bucket_level_access') is True, 'Buckets must remain private with uniform access.')
        if kind == 'google_firestore_database':
            require(after.get('delete_protection_state') == 'DELETE_PROTECTION_ENABLED', 'Database deletion protection is required.')
    return {'resources':len(changes), 'creates':sum('create' in r['change']['actions'] for r in changes), 'imports':sum(bool(r['change'].get('importing')) for r in changes)}


def plan(config):
    require(config.get('stateOwnershipReviewed') is True, 'Review existing state ownership, then explicitly set stateOwnershipReviewed=true. Do not import an object managed by another state.')
    init(config)
    inv = inventory(config)
    existing = set(tf(config, 'state', 'list').splitlines())
    imports = adoption_imports(config, inv, existing)
    validate_config({**config, 'imports': imports})
    import_path = ROOT/'infrastructure/imports.generated.tf'
    import_path.write_text(''.join(f'import {{\n  to = {address}\n  id = {json.dumps(rid)}\n}}\n' for address,rid in imports.items()))
    out = workspace(config)
    var_path = out/'inputs.auto.tfvars.json'; save(var_path,config['terraform'])
    tf(config, 'fmt', '-check')
    tf(config, 'validate')
    tf(config, 'plan', '-input=false', '-lock-timeout=5m', '-var-file='+str(var_path), '-out='+str(out/'infrastructure.tfplan'))
    parsed = tf(config, 'show', '-json', out/'infrastructure.tfplan', json_output=True)
    save(out/'infrastructure-plan.json',parsed)
    summary = guard_plan(parsed, config)
    record = {'schemaVersion':1,'status':'review-required','sourceSha':sha(),'projectId':config['projectId'],'environment':config['environment'],'databaseId':config['databaseId'],'configDigest':digest(config),'planDigest':digest((out/'infrastructure.tfplan').read_bytes()),'createdAt':now(),'summary':summary,'imports':imports}
    save(out/'infrastructure-review.json',record)
    print(json.dumps({'summary':summary, 'approvalDigest':record['planDigest']},indent=2))


def apply(config, approval):
    out = workspace(config); record = read(out/'infrastructure-review.json')
    require(record['sourceSha']==sha() and record['configDigest']==digest(config), 'Source or environment changed after planning.')
    require(approval and approval==record['planDigest']==digest((out/'infrastructure.tfplan').read_bytes()), 'Explicit approval of the exact saved plan digest is required.')
    age = dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(record['createdAt'])
    require(dt.timedelta(0)<=age<=dt.timedelta(hours=24), 'Infrastructure plan has expired.')
    init(config)
    guard_plan(tf(config,'show','-json',out/'infrastructure.tfplan',json_output=True),config)
    tf(config,'apply','-input=false','-lock-timeout=5m',out/'infrastructure.tfplan')
    manifest = tf(config,'output','-json','stage3_manifest',json_output=True)
    save(out/'runtime-manifest.json',manifest)
    save(out/'infrastructure-apply.json',{**record,'status':'passed','completedAt':now(),'runtimeManifestDigest':digest(manifest)})
    print('Reviewed staging infrastructure plan applied; runtime manifest written privately. No Cloud Run revision was changed.')


def resolve_secrets(config, manifest):
    resolved = {}
    versions = config.get('secretVersions',{})
    for key in manifest['requiredSecrets']:
        require(key in versions, 'Required secret version missing: '+key)
    for key, version in versions.items():
        require(key in manifest['secretBindings'], 'Unknown secret binding: '+key)
        require(re.fullmatch(r'[1-9][0-9]*',str(version)), 'Pin numeric secret versions; latest/aliases are prohibited.')
        secret = manifest['secretBindings'][key]
        data = cloud(config,'secrets','versions','describe',str(version),'--secret='+secret)
        require(data.get('state')=='ENABLED','Pinned secret is not enabled: '+key)
        resolved[key]={'secretId':secret,'version':str(version)}
    save(workspace(config)/'resolved-secrets.json',{'projectId':config['projectId'],'environment':config['environment'],'bindings':resolved,'resolvedAt':now()})
    return resolved


def close_stage3(config):
    out = workspace(config)
    required = ['infrastructure-apply','migration-apply','migration-repeat','migration-restore','deployment','integration-readiness']
    evidence = {}
    for name in required:
        path = out/(name+'.json')
        require(path.exists(),'Stage 3 remains open: missing '+name+' evidence.')
        item = read(path)
        require(item.get('status')=='passed' and not item.get('synthetic',False),'Evidence has not passed live acceptance: '+name)
        target = item.get('target',item)
        require(target.get('projectId')==config['projectId'] and target.get('environment')=='staging','Evidence target mismatch: '+name)
        require(item.get('sourceSha')==sha(),'Evidence does not match the current exact commit: '+name)
        evidence[name]=digest(item)
    repeat=read(out/'migration-repeat.json')
    require(repeat.get('changes')==0,'Repeat migration must propose zero writes.')
    deployed=read(out/'deployment.json')
    require('@sha256:' in deployed.get('image','') and deployed.get('revision'),'Deployment evidence must identify immutable image and revision.')
    report={'schemaVersion':1,'status':'passed','environment':'staging','projectId':config['projectId'],'databaseId':config['databaseId'],'sourceSha':sha(),'evidenceDigests':evidence,'closedAt':now(),'productionTouched':False}
    save(out/'stage3-acceptance.json',report)
    print(json.dumps(report,indent=2))


def check_repository():
    require(run(['git','merge-base','--is-ancestor',BASE_SHA,'HEAD']) == '', 'Stage 3 must descend from the accepted Stage 2 commit.')
    required=['infrastructure/platform.tf','infrastructure/.terraform.lock.hcl','scripts/stage3/migration-engine.ts','scripts/stage3/deploy.py','scripts/stage3/integrations.ts','scripts/stage3/tests/migration.test.ts','STAGE3_INFRASTRUCTURE_CONTRACT.md','.github/workflows/verify.yml']
    for path in required: require((ROOT/path).is_file(),'Missing Stage 3 file: '+path)
    source=(ROOT/'scripts/migrate-unified-portal.ts').read_text()
    require('runMigration(transform)' in source and "from '../src/server/firebaseAdmin.js'" not in source,'Migration must use the planning engine, not a direct database writer.')
    for path in (ROOT/'infrastructure').glob('*.tf'):
        text=path.read_text()
        require(not re.search(r'resource\s+"google_cloud_run(?:_v2)?_service"',text),'Competing Cloud Run ownership detected.')
        require('resource "google_secret_manager_secret_version"' not in text,'Secret values must stay outside Terraform state.')
    require('stage3:test' in (ROOT/'package.json').read_text(),'Stage 3 tests are not wired.')
    require('private-evidence/' in (ROOT/'.gitignore').read_text(),'Private evidence is not excluded from Git.')
    for path in ['.github/workflows/stage3-workspace.yml','.github/workflows/stage3-port.yml','scripts/stage3/port-frozen.py']:
        require(not (ROOT/path).exists(),'Temporary Stage 3 tooling must be removed before closure: '+path)
    print('Stage 3 repository contract passed. This does not certify live cloud acceptance.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['bootstrap','inventory','plan','apply','resolve-secrets','close','check-repository'])
    parser.add_argument('--config'); parser.add_argument('--approve')
    args=parser.parse_args()
    if args.command=='check-repository': return check_repository()
    config=load_config(args.config,mutate=args.command in ('bootstrap','apply'))
    if args.command=='bootstrap': return bootstrap(config,args.approve)
    if args.command=='inventory': return inventory(config)
    if args.command=='plan': return plan(config)
    if args.command=='apply': return apply(config,args.approve)
    if args.command=='resolve-secrets': return resolve_secrets(config,read(workspace(config)/'runtime-manifest.json'))
    if args.command=='close': return close_stage3(config)

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,OSError,KeyError) as error:
        print('STAGE 3 BLOCKED: '+str(error),file=sys.stderr)
        sys.exit(1)
