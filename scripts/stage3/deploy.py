#!/usr/bin/env python3
"""Build and deploy staging only. Production service ownership remains unchanged."""
from __future__ import annotations
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request

from control import ROOT, cloud, digest, load_config, now, read, require, resolve_secrets, run, save, sha, workspace


def validate_manifest(config, manifest):
    require(manifest.get('schemaVersion') == 1 and manifest.get('environment') == 'staging', 'Only a staging runtime manifest is accepted.')
    for key in ('projectId', 'databaseId'):
        require(config[key] == manifest[key], 'Runtime manifest target mismatch: ' + key)
    require(manifest['service'] == config['terraform']['cloud_run_service_name'] and manifest['region'] == config['terraform']['region'], 'Manifest Cloud Run service or region mismatch.')
    require(manifest['runtimeIdentity'] == config['terraform']['runtime_service_account_email'], 'Runtime identity mismatch.')
    require(manifest['firebaseConfig']['projectId'] == config['projectId'], 'Browser Firebase project does not match staging.')
    env = manifest['runtimeEnvironment']
    require(env['FIREBASE_PROJECT_ID'] == config['projectId'] and env['FIRESTORE_DATABASE_ID'] == config['databaseId'], 'Runtime data target mismatch.')
    require(env['GOOGLE_CALENDAR_ID'] == config['terraform']['google_calendar_id'], 'Runtime Calendar mismatch.')
    require(manifest['documentBucket'] == env['FIREBASE_STORAGE_BUCKET'], 'Storage target mismatch.')
    require(env['PLATFORM_ENVIRONMENT'] == 'staging' and env['NODE_ENV'] == 'production', 'Staging must run the production server, with a staging platform boundary.')
    require(manifest['imageRepository'].startswith(manifest['region'] + '-docker.pkg.dev/' + config['projectId'] + '/'), 'Image repository is outside the staging project.')
    forbidden = {'FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'}
    require(not forbidden.intersection(env), 'Credential JSON and emulator settings must not be deployed.')


def verify_exact_ci(config):
    # Public repository metadata only. Never send cloud credentials to GitHub.
    source = sha()
    url = 'https://api.github.com/repos/info-rbp/ProInspect-Booking-Portal-Application/actions/runs?head_sha=' + source + '&per_page=100'
    headers = {'Accept':'application/vnd.github+json','User-Agent':'ProInspect-Stage3'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as response:
        runs = json.load(response)['workflow_runs']
    accepted = [r for r in runs if r['head_sha'] == source and r['name'] == 'Verify booking portal' and r['status'] == 'completed' and r['conclusion'] == 'success' and r['event'] in ('push','workflow_dispatch')]
    require(accepted, 'Normal exact-head verification has not passed; staging deployment is blocked.')
    return {'runId':accepted[0]['id'],'sourceSha':source}


def private_service(config, manifest):
    services = cloud(config, 'run', 'services', 'list', '--region=' + manifest['region'])
    existing = next((s for s in services if s.get('metadata',{}).get('name') == manifest['service']), None)
    if not existing:
        return None
    policy = cloud(config,'run','services','get-iam-policy',manifest['service'],'--region='+manifest['region'])
    members = [m for b in policy.get('bindings',[]) for m in b.get('members',[])]
    require(not {'allUsers','allAuthenticatedUsers'}.intersection(members), 'Existing staging service is public; restore private access before proceeding.')
    annotations = existing.get('metadata',{}).get('annotations',{})
    require(annotations.get('run.googleapis.com/invoker-iam-disabled') != 'true', 'Staging invoker IAM checking must be enabled.')
    return existing


def extract_archive(source, path):
    raw = subprocess.check_output(['git','archive','--format=tar',source],cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        archive.extractall(path, filter='data')


def build(config, manifest):
    require(not run(['git','status','--porcelain','--untracked-files=no']), 'Tracked source changes must be committed before building.')
    ci = verify_exact_ci(config)
    version_hash = digest(manifest['firebaseConfig'])[:16]
    tag = sha() + '-' + version_hash
    image = manifest['imageRepository'] + ':' + tag
    with tempfile.TemporaryDirectory(prefix='proinspect-staging-build-') as temp:
        context = Path(temp)
        extract_archive(sha(), context)
        # The existing front-end imports this file at build time. Never bundle
        # the repository's production Firebase configuration into staging.
        (context/'firebase-applet-config.json').write_text(json.dumps(manifest['firebaseConfig'],indent=2)+'\n')
        (context/'.gcloudignore').write_text('.git\nnode_modules\nprivate-evidence\n.env\n.env.*\n**/.terraform\n**/*.tfstate*\n**/*.tfplan\n')
        build_info = cloud(config, 'builds', 'submit', temp, '--config=' + str(context/'deploy/cloudbuild.staging.yaml'), '--service-account=projects/' + config['projectId'] + '/serviceAccounts/' + manifest['buildIdentity'], '--gcs-source-staging-dir=gs://' + manifest['buckets']['build-sources'] + '/source', '--substitutions=_IMAGE=' + image + ',_SOURCE_SHA=' + sha() + ',_CONFIG_SHA=' + version_hash)
    if isinstance(build_info,list):
        require(len(build_info)==1,'Unexpected build response.')
        build_info=build_info[0]
    require(build_info.get('status')=='SUCCESS','Staging image build did not succeed.')
    built = [i for i in build_info.get('results',{}).get('images',[]) if i.get('name')==image]
    require(len(built)==1 and re.fullmatch(r'sha256:[0-9a-f]{64}',built[0].get('digest','')), 'Build did not return an immutable image digest.')
    record = {'schemaVersion':1,'status':'passed','environment':'staging','projectId':config['projectId'],'databaseId':config['databaseId'],'sourceSha':sha(),'buildId':build_info['id'],'image':manifest['imageRepository']+'@'+built[0]['digest'],'firebaseConfigDigest':digest(manifest['firebaseConfig']),'ci':ci,'completedAt':now()}
    save(workspace(config)/'image.json',record)
    return record


def id_token(config, manifest, audience):
    return cloud(config,'auth','print-identity-token','--impersonate-service-account='+manifest['deployIdentity'],'--audiences='+audience,'--include-email',json_output=False)


def request(base, path, token, *, method='GET', body=None):
    headers={'X-Serverless-Authorization':'Bearer '+token}
    if body is not None:
        headers['Content-Type']='application/json'
    req=urllib.request.Request(base.rstrip('/')+path,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req,timeout=60) as response:
            return response.status,response.read()
    except urllib.error.HTTPError as error:
        return error.code,error.read()


def smoke(config, manifest, deployment):
    token=id_token(config,manifest,deployment['serviceUrl'])
    paths=['/','/book','/request-document','/client','/tenant','/admin']
    for path in paths:
        status,body=request(deployment['candidateUrl'],path,token)
        require(status==200 and b'<html' in body.lower(), 'Staging page check failed: '+path)
    for path in ['/api/health','/api/services']:
        status,body=request(deployment['candidateUrl'],path,token)
        require(status==200,'Staging API check failed: '+path)
        data=json.loads(body)
        if path=='/api/health': require(data.get('ok') is True and data.get('calendarConfigured') is True,'Health is not integration-ready.')
        else: require(isinstance(data.get('services'),list) and len(data['services'])>0,'Service catalogue is empty.')
    for path in ['/api/client/dashboard','/api/tenant/dashboard','/api/admin/bookings']:
        status,_=request(deployment['candidateUrl'],path,token)
        require(status in (401,403),'Portal endpoint did not enforce application authentication: '+path)
    status,_=request(deployment['candidateUrl'],'/api/integrations/reports',token,method='POST',body={})
    require(status in (401,403),'Report ingest did not reject an unauthenticated caller.')
    return {'pages':paths,'health':'passed','serviceCatalogue':'passed','portalBoundaries':'passed','reportIngestBoundary':'passed'}


def candidate(config, manifest):
    out=workspace(config)
    ci=verify_exact_ci(config)
    image=read(out/'image.json')
    require(image['sourceSha']==sha() and image['firebaseConfigDigest']==digest(manifest['firebaseConfig']),'Image was built from a different source or browser configuration.')
    require(image['projectId']==config['projectId'] and image['image'].startswith(manifest['imageRepository']+'@sha256:'),'Image target/digest mismatch.')
    infrastructure=read(out/'infrastructure-apply.json')
    require(infrastructure['status']=='passed' and infrastructure['sourceSha']==sha(),'An exact-source infrastructure apply is required.')
    bindings=resolve_secrets(config,manifest)
    previous=private_service(config,manifest)
    save(out/'previous-service.json',previous or {})
    env_path=out/'runtime-environment.json'; save(env_path,manifest['runtimeEnvironment'])
    tag='rc-'+sha()[:12]
    args=['run','deploy',manifest['service'],'--image='+image['image'],'--region='+manifest['region'],'--service-account='+manifest['runtimeIdentity'],'--env-vars-file='+str(env_path),'--set-secrets='+','.join(k+'='+v['secretId']+':'+v['version'] for k,v in sorted(bindings.items())),'--tag='+tag,'--no-traffic','--ingress=all','--max-instances=3','--min-instances=0','--cpu=1','--memory=1Gi','--timeout=300']
    cloud(config,*args)
    service=cloud(config,'run','services','describe',manifest['service'],'--region='+manifest['region'])
    private_service(config,manifest)
    revision=service['status']['latestReadyRevisionName']
    tagged=next((t for t in service['status'].get('traffic',[]) if t.get('tag')==tag and t.get('revisionName')==revision),None)
    require(tagged and tagged.get('url'),'The new revision is not ready at its candidate URL.')
    record={**image,'ci':ci,'status':'candidate','revision':revision,'candidateUrl':tagged['url'],'serviceUrl':service['status']['url'],'tag':tag,'secretVersions':bindings,'previousTraffic':(previous or {}).get('status',{}).get('traffic',[]),'createdAt':now()}
    save(out/'deployment.json',record)
    record['checks']=smoke(config,manifest,record)
    record['status']='passed'; record['completedAt']=now()
    save(out/'deployment.json',record)
    cloud(config,'storage','cp',str(out/'deployment.json'),'gs://'+manifest['buckets']['release-evidence']+'/'+sha()+'/deployment.json',json_output=False)
    print('Private staging candidate passed smoke checks. Previous traffic is unchanged; promotion is a separate command.')


def promote(config,manifest,approval):
    out=workspace(config); d=read(out/'deployment.json')
    require(d['status']=='passed' and d['sourceSha']==sha(),'Only the verified exact-source candidate may be promoted.')
    require(approval==d['revision'],'Explicit --approve <revision> is required.')
    for name in ['migration-apply','migration-repeat','migration-restore','integration-readiness']:
        evidence=read(out/(name+'.json')); target=evidence.get('target',evidence)
        require(evidence.get('status')=='passed' and evidence.get('sourceSha')==sha() and target.get('projectId')==config['projectId'] and target.get('environment')=='staging','Missing exact-source live evidence: '+name)
    private_service(config,manifest)
    cloud(config,'run','services','update-traffic',manifest['service'],'--region='+manifest['region'],'--to-revisions='+d['revision']+'=100')
    save(out/'promotion.json',{'status':'passed','sourceSha':sha(),'projectId':config['projectId'],'environment':'staging','revision':d['revision'],'completedAt':now()})


def rollback(config,manifest,approval):
    d=read(workspace(config)/'deployment.json')
    require(d['projectId']==config['projectId'] and approval==d['revision'],'Rollback target/revision approval mismatch.')
    traffic={t['revisionName']:t['percent'] for t in d['previousTraffic'] if t.get('percent',0)>0 and t.get('revisionName')}
    require(sum(traffic.values())==100,'No previous full traffic allocation exists. Retain the private service and investigate; no destructive rollback is attempted.')
    cloud(config,'run','services','update-traffic',manifest['service'],'--region='+manifest['region'],'--to-revisions='+','.join(r+'='+str(p) for r,p in traffic.items()))
    save(workspace(config)/'rollback.json',{'status':'passed','projectId':config['projectId'],'environment':'staging','sourceSha':sha(),'traffic':traffic,'completedAt':now()})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['build','candidate','promote','rollback'])
    parser.add_argument('--config',required=True); parser.add_argument('--approve')
    args=parser.parse_args(); config=load_config(args.config,mutate=True)
    manifest=read(workspace(config)/'runtime-manifest.json'); validate_manifest(config,manifest)
    if args.command=='build': return build(config,manifest)
    if args.command=='candidate': return candidate(config,manifest)
    if args.command=='promote': return promote(config,manifest,args.approve)
    return rollback(config,manifest,args.approve)

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,OSError,KeyError) as error:
        raise SystemExit('STAGING DEPLOYMENT BLOCKED: '+str(error))
