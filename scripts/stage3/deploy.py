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

from control import ROOT, cloud, digest, load_config, now, read, require, resolve_secrets, run, save, sha, workspace, validate_evidence, fresh, ensure_clean


def validate_manifest(config, manifest):
    require(manifest.get('schemaVersion') == 1 and manifest.get('environment') == 'staging', 'Only a staging runtime manifest is accepted.')
    for key in ('projectId', 'databaseId'):
        require(config[key] == manifest[key], 'Runtime manifest target mismatch: ' + key)
    require(manifest['service'] == config['terraform']['cloud_run_service_name'] and manifest['region'] == config['terraform']['region'], 'Manifest Cloud Run service or region mismatch.')
    require(manifest['runtimeIdentity'] == config['terraform']['runtime_service_account_email'], 'Runtime identity mismatch.')
    require(manifest['firebaseConfig']['projectId'] == config['projectId'], 'Browser Firebase project does not match staging.')
    env = manifest['runtimeEnvironment']
    require(env['FIREBASE_PROJECT_ID'] == config['projectId'] and env['FIRESTORE_DATABASE_ID'] == config['databaseId'], 'Runtime data target mismatch.')
    require(env.get('STAGING_EMAIL_RECIPIENT') == config['testEmail'],'Staging email sink mismatch.')
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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def request(base, path, token, *, method='GET', body=None):
    headers=({'X-Serverless-Authorization':'Bearer '+token} if token else {})
    if body is not None:
        headers['Content-Type']='application/json'
    req=urllib.request.Request(base.rstrip('/')+path,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=60) as response:
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
    image=validate_evidence(read(out/'image.json'),config,'image')
    require(image['sourceSha']==sha() and image['firebaseConfigDigest']==digest(manifest['firebaseConfig']),'Image was built from a different source or browser configuration.')
    require(image['projectId']==config['projectId'] and image['image'].startswith(manifest['imageRepository']+'@sha256:'),'Image target/digest mismatch.')
    infrastructure=validate_evidence(read(out/'infrastructure-apply.json'),config,'infrastructure-apply')
    require(infrastructure.get('runtimeManifestDigest')==digest(manifest),'Runtime manifest differs from reviewed Terraform outputs.')
    require(infrastructure['status']=='passed' and infrastructure['sourceSha']==sha(),'An exact-source infrastructure apply is required.')
    bindings=resolve_secrets(config,manifest)
    previous=private_service(config,manifest)
    save(out/'previous-service.json',previous or {})
    env_path=out/'runtime-environment.json'; save(env_path,manifest['runtimeEnvironment'])
    tag='rc-'+sha()[:12]
    args=['run','deploy',manifest['service'],'--image='+image['image'],'--region='+manifest['region'],'--service-account='+manifest['runtimeIdentity'],'--env-vars-file='+str(env_path),'--set-secrets='+','.join(k+'='+v['secretId']+':'+v['version'] for k,v in sorted(bindings.items())),'--tag='+tag,*(['--no-traffic'] if previous else []),'--ingress=all','--max-instances=3','--min-instances=0','--cpu=1','--memory=1Gi','--timeout=300']
    cloud(config,*args)
    service=cloud(config,'run','services','describe',manifest['service'],'--region='+manifest['region'])
    private_service(config,manifest)
    if previous:
        allocation=lambda s: sorted((t['revisionName'],t['percent']) for t in s.get('status',{}).get('traffic',[]) if t.get('percent',0)>0)
        require(allocation(previous)==allocation(service),'Candidate deployment changed previous traffic unexpectedly.')
    revision=service['status']['latestReadyRevisionName']
    tagged=next((t for t in service['status'].get('traffic',[]) if t.get('tag')==tag and t.get('revisionName')==revision),None)
    require(tagged and tagged.get('url'),'The new revision is not ready at its candidate URL.')
    record={**image,'ci':ci,'status':'candidate','revision':revision,'candidateUrl':tagged['url'],'serviceUrl':service['status']['url'],'tag':tag,'secretVersions':bindings,'previousTraffic':(previous or {}).get('status',{}).get('traffic',[]),'initialPrivateService':previous is None,'createdAt':now()}
    save(out/'deployment.json',record)
    record['checks']=smoke(config,manifest,record)
    record['status']='passed'; record['completedAt']=now()
    save(out/'deployment.json',record)
    cloud(config,'storage','cp',str(out/'deployment.json'),'gs://'+manifest['buckets']['release-evidence']+'/'+sha()+'/deployment.json',json_output=False)
    print('Private staging candidate passed smoke checks. Existing-service traffic was preserved; a first private service serves only IAM-authorised testers.')


def promote(config,manifest,approval):
    out=workspace(config); d=read(out/'deployment.json')
    require(d['status']=='passed' and d['sourceSha']==sha(),'Only the verified exact-source candidate may be promoted.')
    require(approval==d['revision'],'Explicit --approve <revision> is required.')
    from control import close_stage3
    close_stage3(config)
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


def booking_test(config,manifest,approval):
    require(approval==config['projectId'],'Booking smoke creates and cancels a synthetic booking; approve the staging project explicitly.')
    out=workspace(config); deployment=validate_evidence(read(out/'deployment.json'),config,'deployment')
    test=config.get('bookingTest',{})
    require(all(test.get(k) for k in ['streetAddress','suburb','postcode','phone','serviceId']),'Complete bookingTest fields in the staging descriptor.')
    env={**os.environ,'E2E_BASE_URL':deployment['candidateUrl'],'E2E_CLOUD_RUN_ID_TOKEN':id_token(config,manifest,deployment['serviceUrl']),'E2E_ALLOW_LIVE_WRITE':'YES','E2E_STREET_ADDRESS':test['streetAddress'],'E2E_SUBURB':test['suburb'],'E2E_POSTCODE':test['postcode'],'E2E_TEST_PHONE':test['phone'],'E2E_SERVICE_ID':test['serviceId'],'E2E_TEST_EMAIL':config['testEmail']}
    result=run(['node','scripts/e2e-booking-smoke.mjs'],env=env,json_output=True)
    require(result.get('success') is True and result.get('finalStatus')=='cancelled','Booking smoke did not complete and cancel successfully.')
    require(result.get('confirmationEmailStatus')=='sent','Booking email was not accepted by its configured provider.')
    save(out/'booking-smoke.json',{'schemaVersion':1,'status':'passed',**{k:config[k] for k in ('environment','projectId','databaseId')},'sourceSha':sha(),'revision':deployment['revision'],'completedAt':now(),'checks':result['checks'],'bookingReference':result['bookingReference'],'finalStatus':'cancelled'})



def gateway(config,manifest,approval):
    require(approval==config['projectId'],'Publishing the report-only gateway requires --approve <staging-project>.')
    out=workspace(config); d=validate_evidence(read(out/'deployment.json'),config,'deployment')
    name=manifest['gatewayService']
    require(name==manifest['service']+'-reports' and name!=manifest['service'],'Gateway must not replace the core service.')
    existing=cloud(config,'run','services','list','--region='+manifest['region'])
    old=next((x for x in existing if x.get('metadata',{}).get('name')==name),None)
    require(old is None or old.get('metadata',{}).get('labels',{}).get('proinspect-purpose')=='report-ingest-gateway','Refusing to replace an unrelated existing service.')
    binding=d['secretVersions']['REPORT_INGEST_TOKEN']
    require(binding['secretId']==manifest['secretBindings']['REPORT_INGEST_TOKEN'] and re.fullmatch(r'[1-9][0-9]*',str(binding['version'])),'Gateway requires the exact pinned ingest secret.')
    env={'PLATFORM_ENVIRONMENT':'staging','NODE_ENV':'production','CORE_REPORT_INGEST_URL':d['candidateUrl']+'/api/integrations/reports','CORE_REPORT_INGEST_AUDIENCE':d['serviceUrl']}
    save(out/'gateway-env.json',env)
    cloud(config,'run','deploy',name,'--image='+d['image'],'--region='+manifest['region'],'--service-account='+manifest['gatewayIdentity'],'--command=node','--args=--import,tsx,src/server/reportGateway.ts','--env-vars-file='+str(out/'gateway-env.json'),'--set-secrets=REPORT_INGEST_TOKEN='+binding['secretId']+':'+str(binding['version']),'--labels=proinspect-purpose=report-ingest-gateway','--max-instances=2','--min-instances=0','--memory=512Mi','--timeout=120','--ingress=all')
    cloud(config,'run','services','add-iam-policy-binding',name,'--region='+manifest['region'],'--member=allUsers','--role=roles/run.invoker')
    service=cloud(config,'run','services','describe',name,'--region='+manifest['region'])
    url=service['status']['url']
    status,_=request(url,'/api/integrations/reports','',method='POST',body={})
    require(status==401,'Public report gateway did not reject an unauthenticated request.')
    require(request(url,'/admin','')[0]==404,'Gateway unexpectedly exposes a portal route.')
    private_service(config,manifest)
    save(out/'report-gateway.json',evidence_for_gateway(config,d,url,service['status']['latestReadyRevisionName']))
    print('Report-only gateway published. Configure the isolated Report Tool ingest endpoint: '+url+'/api/integrations/reports')


def evidence_for_gateway(config,deployment,url,revision):
    return {'schemaVersion':1,'status':'passed',**{k:config[k] for k in ('environment','projectId','databaseId')},'sourceSha':sha(),'coreRevision':deployment['revision'],'gatewayRevision':revision,'url':url,'completedAt':now(),'coreRemainsPrivate':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['build','candidate','promote','rollback','booking-test','gateway'])
    parser.add_argument('--config',required=True); parser.add_argument('--approve')
    args=parser.parse_args(); config=load_config(args.config,mutate=True)
    ensure_clean()
    manifest=read(workspace(config)/'runtime-manifest.json'); validate_manifest(config,manifest)
    infrastructure=validate_evidence(read(workspace(config)/'infrastructure-apply.json'),config,'infrastructure-apply')
    require(infrastructure.get('runtimeManifestDigest')==digest(manifest),'Unapproved runtime manifest.')
    config['_identity']=manifest['deployIdentity']
    if args.command=='gateway': return gateway(config,manifest,args.approve)
    if args.command=='booking-test': return booking_test(config,manifest,args.approve)
    if args.command=='build': return build(config,manifest)
    if args.command=='candidate': return candidate(config,manifest)
    if args.command=='promote': return promote(config,manifest,args.approve)
    return rollback(config,manifest,args.approve)

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,OSError,KeyError) as error:
        raise SystemExit('STAGING DEPLOYMENT BLOCKED: '+str(error))
