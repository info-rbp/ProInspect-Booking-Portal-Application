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
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_PROJECT = 'business-plan-applicatio-17047'
PRODUCTION_DATABASE = 'ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a'
BASE_SHA = 'ceebc2f0d312aec6ab68b796a90e04219e771696'
REPO = 'info-rbp/ProInspect-Platform'
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
        raise RuntimeError(f'{args[0]} failed with exit {result.returncode}. Inspect the command locally; stderr is suppressed to protect credentials.')
    return json.loads(result.stdout) if json_output else result.stdout.strip()


def sha():
    return run(['git', 'rev-parse', 'HEAD'])


def cloud(config, *args, json_output=True, data=None):
    identity = config.get('_identity')
    impersonate = ['--impersonate-service-account=' + identity] if identity and not any(str(a).startswith('--impersonate-service-account=') for a in args) else []
    return run(['gcloud', *args, *impersonate, '--project=' + config['projectId'], '--quiet', *(['--format=json'] if json_output else [])], json_output=json_output, data=data)


def api(config, url, *, optional=False, method="GET", body=None):
    token = cloud(config, 'auth', 'print-access-token', json_output=False)
    require(urllib.parse.urlparse(url).hostname in {'firestore.googleapis.com','firebase.googleapis.com','identitytoolkit.googleapis.com','iam.googleapis.com','firebaserules.googleapis.com'}, 'Unexpected authenticated API host.')
    request = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type':'application/json'})
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
    require(re.fullmatch(r'[a-z][a-z0-9-]{2,62}|\(default\)', c.get('databaseId','')), 'Invalid explicit databaseId.')
    t = c.get('terraform', {})
    require(t.get('project_id') == c['projectId'] and t.get('environment') == c['environment'] and t.get('firestore_database_id') == c['databaseId'], 'Descriptor/Terraform target mismatch.')
    require(c.get('state', {}).get('bucket') and c['state'].get('prefix'), 'Explicit state bucket and prefix required.')
    if c['environment'] == 'staging':
        require(c['projectId'] != PRODUCTION_PROJECT, 'Staging cannot use the production project.')
        require(c['state']['bucket'] != PRODUCTION_PROJECT + '-proinspect-terraform-state', 'Staging cannot share the production state bucket.')
        require(c['state']['prefix'] == 'platform/staging', 'Use the isolated platform/staging state prefix.')
        require(t.get('google_calendar_id') != 'c_4bf5fc54ee54bf60371059cf824ec7e018fb6c43ca66bbdd4051fafaa74e3c32@group.calendar.google.com', 'Staging cannot use the production Calendar.')
        require(t.get('report_tool_url', '').rstrip('/') != 'https://report.creation.proinspect.systems', 'Staging cannot call the production Report Tool.')
    else:
        require(c['projectId'] == PRODUCTION_PROJECT, 'Production descriptor must match the frozen production project.')
        require(c['databaseId'] == PRODUCTION_DATABASE, 'Production database does not match the frozen baseline.')
        require(c['state']['prefix'] == 'booking-portal/production', 'Preserve existing production state ownership; do not create a competing state prefix.')
    require(not mutate or c['environment'] == 'staging', 'Stage 3 blocks production mutation; Stage 4 owns cutover approval.')
    if not allow_placeholders:
        require('REQUIRED_' not in json.dumps(c) and 'CHANGE_ME' not in json.dumps(c), 'Complete the environment descriptor; placeholders cannot target cloud resources.')
    require(t.get('operator_principal') == c.get('operatorPrincipal'), 'Operator identity must match Terraform inputs.')
    if c['environment'] == 'staging':
        require(t.get('staging_email_recipient') == c.get('testEmail') and c.get('testEmail'), 'Staging requires one explicit testEmail/email sink.')
    require(t.get('runtime_service_account_email') != t.get('terraform_service_account_email'), 'Runtime and Terraform must use different identities.')
    for key in ('runtime_service_account_email', 'terraform_service_account_email'):
        require(str(t.get(key, '')).endswith('@' + c['projectId'] + '.iam.gserviceaccount.com'), key + ' must belong to the selected project.')
    for address, resource_id in c.get('imports', {}).items():
        require(re.fullmatch(r'google_[a-z0-9_]+\.[a-z0-9_]+(?:\[(?:[0-9]+|"[a-zA-Z0-9_./@()-]+")\])?', address), 'Invalid Terraform import address.')
        require(isinstance(resource_id, str) and resource_id, 'Invalid resource import ID.')
    require(not os.environ.get('FIRESTORE_EMULATOR_HOST') and not os.environ.get('FIREBASE_AUTH_EMULATOR_HOST'), 'Live control-plane commands cannot use emulator configuration.')
    return c


def load_config(path, *, mutate=False):
    require(path, '--config is required; there is no production default.')
    return validate_config(read(path), mutate=mutate)


def ensure_clean():
    require(not run(['git','status','--porcelain','--untracked-files=no']), 'Commit tracked source before issuing live Stage 3 evidence.')

def config_digest(config):
    return digest({k:v for k,v in config.items() if not k.startswith('_')})


def fresh(value, label, hours=24):
    try:
        stamp=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        age=dt.datetime.now(dt.timezone.utc)-stamp
        require(dt.timedelta(0) <= age <= dt.timedelta(hours=hours), label+' is expired or future-dated.')
    except (TypeError, AttributeError, ValueError):
        raise ValueError(label+' must contain a valid, recent UTC timestamp.') from None


def validate_evidence(item, config, label):
    require(item.get('schemaVersion') == 1 and item.get('status') == 'passed' and item.get('synthetic') is not True, 'Missing successful live evidence: '+label)
    target=item.get('target',item)
    require(all(target.get(k)==config[k] for k in ('projectId','databaseId','environment')), 'Evidence target mismatch: '+label)
    require(item.get('sourceSha') == sha(), 'Evidence source mismatch: '+label)
    fresh(item.get('completedAt'), label)
    return item


def workspace(config):
    path = ROOT / 'private-evidence' / 'stage3' / config['environment'] / config['projectId'] / config['databaseId']
    path.mkdir(parents=True, exist_ok=True)
    return path


def tf(config, *args, json_output=False):
    env = {**os.environ, 'TF_DATA_DIR': str(workspace(config) / 'terraform-data'), 'GOOGLE_IMPERSONATE_SERVICE_ACCOUNT': config['terraform']['terraform_service_account_email']}
    return run(['terraform', '-chdir=infrastructure', *args], env=env, json_output=json_output)


def init(config):
    tf(config, 'init', '-input=false', '-reconfigure', '-lockfile=readonly', '-backend-config=bucket=' + config['state']['bucket'], '-backend-config=prefix=' + config['state']['prefix'], '-backend-config=impersonate_service_account=' + config['terraform']['terraform_service_account_email'])


def bootstrap(config, approval):
    validate_config(config, mutate=True)
    require(approval == config['projectId'], '--approve must equal the staging project ID for one-time bootstrap.')
    project = cloud(config, 'projects', 'describe', config['projectId'])
    require(project.get('lifecycleState') == 'ACTIVE', 'Target project must exist and be active.')
    require(cloud(config,'billing','projects','describe',config['projectId']).get('billingEnabled') is True,'Enable billing on the explicitly selected staging project before bootstrap.')
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
    for role in ['roles/serviceusage.serviceUsageAdmin','roles/resourcemanager.projectIamAdmin','roles/iam.serviceAccountAdmin','roles/iam.workloadIdentityPoolAdmin','roles/iam.roleAdmin','roles/storage.admin','roles/secretmanager.admin','roles/datastore.owner','roles/artifactregistry.admin','roles/firebase.admin','roles/run.viewer','roles/logging.viewer']:
        cloud(config, 'projects', 'add-iam-policy-binding', config['projectId'], '--member=serviceAccount:' + identity, '--role=' + role, '--condition=None')
    principal = config.get('operatorPrincipal', '')
    require(principal.startswith(('user:', 'serviceAccount:')), 'Explicit operatorPrincipal required for Terraform impersonation.')
    cloud(config, 'iam', 'service-accounts', 'add-iam-policy-binding', identity, '--member=' + principal, '--role=roles/iam.serviceAccountTokenCreator')
    save(workspace(config) / 'bootstrap.json', {'status':'passed','projectId':config['projectId'],'environment':config['environment'],'completedAt':now(),'sourceSha':sha()})


def api_list(config, url, field, optional=False):
    result=[]; seen=set()
    while True:
        page=api(config,url,optional=optional)
        if page is None: return []
        result.extend(page.get(field,[]))
        token=page.get('nextPageToken')
        if not token: return result
        require(token not in seen,'Inventory pagination repeated a token; refusing incomplete inventory.')
        seen.add(token)
        parsed=urllib.parse.urlsplit(url)
        query=dict(urllib.parse.parse_qsl(parsed.query)); query['pageToken']=token
        url=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def inventory(config):
    config={**config, "_identity":config["terraform"]["terraform_service_account_email"]}
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
    result['indexes'] = api_list(config, base + '/collectionGroups/-/indexes','indexes') if exists else []
    result['backupSchedules'] = api_list(config, base + '/backupSchedules','backupSchedules') if exists else []
    result['firebaseProject'] = api(config, f'https://firebase.googleapis.com/v1beta1/projects/{p}', optional=True)
    result['webApps'] = api_list(config, f'https://firebase.googleapis.com/v1beta1/projects/{p}/webApps','apps') if result['firebaseProject'] else []
    pool_id=config.get('terraform',{}).get('workload_identity_pool_id') or f'proinspect-{config["environment"]}'
    provider_id=config.get('terraform',{}).get('workload_identity_pool_provider_id') or 'github'
    pool=f'projects/{result["project"]["projectNumber"]}/locations/global/workloadIdentityPools/{pool_id}'
    result['identityPool']=api(config,'https://iam.googleapis.com/v1/'+pool,optional=True)
    result['identityProvider']=api(config,'https://iam.googleapis.com/v1/'+pool+'/providers/'+provider_id,optional=True) if result['identityPool'] else None
    release='cloud.firestore' if database=='(default)' else 'cloud.firestore/'+database
    result['rulesRelease']=api(config,f'https://firebaserules.googleapis.com/v1/projects/{p}/releases/'+release,optional=True) if result['firebaseProject'] else None
    result['gatewayRole']=api(config,f'https://iam.googleapis.com/v1/projects/{p}/roles/proinspectGatewayPolicy',optional=True)
    if exists:
        field_filters=('indexConfig.usesAncestorConfig:false','ttlConfig:*')
        field_overrides={}
        for field_filter in field_filters:
            url=base+'/collectionGroups/-/fields?'+urllib.parse.urlencode({'filter':field_filter})
            for field in api_list(config,url,'fields'):
                name=field.get('name')
                if name: field_overrides[name]=field
        result['fieldOverrides']=list(field_overrides.values())
    else:
        result['fieldOverrides']=[]
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
        for role in ['build','deploy','migration','gateway']:
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
                add(f'google_secret_manager_secret.{resource}["{key}"]', secret['name'].rsplit('/',1)[-1])
    for secret in inv['secrets']:
        if secret['name'].endswith('/proinspect-'+env+'-google-signin-client-secret'): add('google_secret_manager_secret.auth_client',secret['name'].rsplit('/',1)[-1])
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
    for kind, resource in [('identityPool','google_iam_workload_identity_pool.github[0]'),('identityProvider','google_iam_workload_identity_pool_provider.github[0]')]:
        if t.get('enable_github_federation',True) and inv.get(kind): add(resource,inv[kind]['name'])
    if inv.get('rulesRelease'): add('google_firebaserules_release.firestore',inv['rulesRelease']['name'])
    if inv.get('gatewayRole'): add('google_project_iam_custom_role.gateway_policy',inv['gatewayRole']['name'])
    for field in read(ROOT/'firestore.indexes.json').get('fieldOverrides',[]):
        suffix='/collectionGroups/'+field['collectionGroup']+'/fields/'+field['fieldPath']
        matches=[f for f in inv.get('fieldOverrides',[]) if f['name'].endswith(suffix)]
        require(len(matches)<=1,'Ambiguous field override inventory.')
        if matches: add('google_firestore_field.canonical["'+field['collectionGroup']+'/'+field['fieldPath']+'"]',matches[0]['name'])
    return {a:i for a,i in result.items() if a not in existing_addresses}


def guard_plan(plan, config):
    require(not plan.get('errored',False), 'Terraform plan contains errors.')
    changes = plan.get('resource_changes', [])
    for resource in changes:
        if resource.get('mode') == 'data': continue
        kind = resource['type']; actions = resource['change']['actions']
        require(kind not in ('google_cloud_run_service','google_cloud_run_v2_service'), 'Terraform must not own the application Cloud Run service.')
        require(kind != 'google_secret_manager_secret_version', 'Secret payloads must not enter Terraform state.')
        if 'delete' in actions:
            require(kind not in STATEFUL and resource['address'] in config.get('approvedEphemeralReplacements', []), 'Unapproved deletion/replacement: ' + resource['address'])
        after = resource['change'].get('after') or {}
        require(after.get('project',config['projectId']) == config['projectId'], 'Resource plan crosses the selected project.')
        public={'allUsers','allAuthenticatedUsers'}
        require(after.get('member') not in public and not public.intersection(after.get('members',[])), 'Public IAM grants are not allowed.')
        if after.get('policy_data'):
            policy=json.loads(after['policy_data'])
            require(not any(public.intersection(b.get('members',[])) for b in policy.get('bindings',[])), 'Public IAM policy grants are not allowed.')
        if kind == 'google_storage_bucket':
            require(after.get('force_destroy') is not True and after.get('public_access_prevention') == 'enforced' and after.get('uniform_bucket_level_access') is True, 'Buckets must remain private with uniform access.')
        if kind == 'google_firestore_database':
            require(after.get('delete_protection_state') == 'DELETE_PROTECTION_ENABLED', 'Database deletion protection is required.')
    return {'resources':len(changes), 'creates':sum('create' in r['change']['actions'] for r in changes), 'imports':sum(bool(r['change'].get('importing')) for r in changes)}


def plan(config):
    ensure_clean()
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
    tf(config, 'fmt', 'imports.generated.tf')
    tf(config, 'fmt', '-check')
    tf(config, 'validate')
    tf(config, 'plan', '-input=false', '-lock-timeout=5m', '-var-file='+str(var_path), '-out='+str(out/'infrastructure.tfplan'))
    parsed = tf(config, 'show', '-json', out/'infrastructure.tfplan', json_output=True)
    save(out/'infrastructure-plan.json',parsed)
    summary = guard_plan(parsed, config)
    record = {'schemaVersion':1,'status':'review-required','sourceSha':sha(),'projectId':config['projectId'],'environment':config['environment'],'databaseId':config['databaseId'],'configDigest':config_digest(config),'planDigest':digest((out/'infrastructure.tfplan').read_bytes()),'createdAt':now(),'summary':summary,'imports':imports}
    save(out/'infrastructure-review.json',record)
    print(json.dumps({'summary':summary, 'approvalDigest':record['planDigest']},indent=2))


def apply(config, approval):
    ensure_clean()
    validate_config(config, mutate=True)
    out = workspace(config); record = read(out/'infrastructure-review.json')
    require(record['status']=='review-required' and all(record.get(k)==config[k] for k in ('projectId','databaseId','environment')) and record['sourceSha']==sha() and record['configDigest']==config_digest(config), 'Source or environment changed after planning.')
    require(approval and approval==record['planDigest']==digest((out/'infrastructure.tfplan').read_bytes()), 'Explicit approval of the exact saved plan digest is required.')
    fresh(record['createdAt'],'Infrastructure plan')
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
    validate_config(config, mutate=True)
    ensure_clean()
    out = workspace(config)
    required = ['infrastructure-apply','migration-dry','migration-apply','migration-repeat','migration-restore','deployment','integration-readiness','booking-smoke','report-gateway','report-companion']
    evidence={}
    for name in required:
        path=out/(name+'.json')
        require(path.exists(),'Stage 3 remains open: missing '+name+' evidence.')
        evidence[name]=validate_evidence(read(path),config,name)
    require(sum(evidence['migration-dry'].get('beforeCounts',{}).values())>0,'An empty database is not a representative migration rehearsal.')
    require(evidence['migration-repeat'].get('changes') == 0 and evidence['migration-repeat'].get('dryRun') is True,'Repeat migration must propose zero writes.')
    require(evidence['migration-restore'].get('verifiedContent') is True,'Restore contents were not verified.')
    applied=evidence['migration-apply']; repeat=evidence['migration-repeat']
    require(applied['databaseHash'] == repeat['sourceHash'], 'Database changed between migration apply and zero-write rerun.')
    require(evidence['migration-dry']['planDigest'] == applied['planDigest'], 'Applied migration differs from the reviewed dry-run plan.')
    deployed=evidence['deployment']; integrations=evidence['integration-readiness']
    require(re.fullmatch(r'.+@sha256:[0-9a-f]{64}',deployed.get('image','')) and deployed.get('revision'),'Deployment requires an immutable image and revision.')
    require(integrations.get('revision') == deployed['revision'] and evidence['booking-smoke'].get('revision') == deployed['revision'],'Runtime checks must target the accepted revision.')
    required_checks={'firestore','indexes','storage','calendar','emailSubmission','reportIngest','authentication'}
    require(required_checks.issubset(integrations.get('checks',{})) and all(integrations['checks'][k]=='passed' for k in required_checks),'Integration checks are incomplete.')
    require(evidence['report-gateway'].get('coreRevision')==deployed['revision'],'Report gateway targets a different core revision.')
    companion=evidence['report-companion']
    require(companion.get('companionSourceSha')=='247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707' and companion.get('deploymentVerification')=='operator-attested' and companion.get('deploymentEvidenceReference') and companion.get('handoffVerified') is True and companion.get('publicationVerified') is True and companion.get('revision')==deployed['revision'] and companion.get('reportToolUrl')==config['terraform']['report_tool_url'],'Report Tool companion round-trip is unverified.')
    report={'schemaVersion':1,'status':'passed','environment':'staging','projectId':config['projectId'],'databaseId':config['databaseId'],'sourceSha':sha(),'evidenceDigests':{k:digest(v) for k,v in evidence.items()},'completedAt':now(),'productionTouched':False}
    save(out/'stage3-acceptance.json',report)
    print(json.dumps(report,indent=2))


def check_repository():
    require(run(['git','merge-base','--is-ancestor',BASE_SHA,'HEAD']) == '', 'Stage 3 must descend from the accepted Stage 2 commit.')
    required=['infrastructure/platform.tf','infrastructure/.terraform.lock.hcl','scripts/stage3/migration-engine.ts','scripts/stage3/deploy.py','scripts/stage3/integrations.ts','scripts/stage3/rehearse.py','scripts/stage3/auth.py','scripts/stage3/record-companion.ts','src/server/reportGateway.ts','scripts/stage3/tests/migration.test.ts','scripts/stage3/tests/test_control.py','STAGE3_INFRASTRUCTURE_CONTRACT.md','.github/workflows/verify.yml']
    for path in required: require((ROOT/path).is_file(),'Missing Stage 3 file: '+path)
    source=(ROOT/'scripts/migrate-unified-portal.ts').read_text()
    require('runMigration(transform)' in source and "from '../src/server/firebaseAdmin.js'" not in source,'Migration must use the planning engine, not a direct database writer.')
    for path in (ROOT/'infrastructure').glob('*.tf'):
        text=path.read_text()
        require(not re.search(r'resource\s+"google_cloud_run(?:_v2)?_service"',text),'Competing Cloud Run ownership detected.')
        require('resource "google_secret_manager_secret_version"' not in text,'Secret values must stay outside Terraform state.')
    require('stage3:test' in (ROOT/'package.json').read_text(),'Stage 3 tests are not wired.')
    require('private-evidence/' in (ROOT/'.gitignore').read_text(),'Private evidence is not excluded from Git.')
    for path in ['.github/workflows/stage3-workspace.yml','.github/workflows/stage3-port.yml','.github/workflows/stage3-review.yml','scripts/stage3/port-frozen.py']:
        require(not (ROOT/path).exists(),'Temporary Stage 3 tooling must be removed before closure: '+path)
    workflow=(ROOT/'.github/workflows/verify.yml').read_text()
    for command in ['stage3:check','stage3:test','stage3:test:controls','terraform -chdir=infrastructure validate','terraform -chdir=infrastructure test']:
        require(command in workflow,'Permanent acceptance gate missing: '+command)
    print('Stage 3 repository contract passed. This does not certify live cloud acceptance.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['bootstrap','inventory','plan','apply','resolve-secrets','close','check-repository','validate-config'])
    parser.add_argument('--config'); parser.add_argument('--approve')
    args=parser.parse_args()
    if args.command=='check-repository': return check_repository()
    config=load_config(args.config,mutate=args.command in ('bootstrap','apply'))
    if args.command=='validate-config': return print('Explicit environment configuration validated.')
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
