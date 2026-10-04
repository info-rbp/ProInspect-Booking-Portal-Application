#!/usr/bin/env python3
"""Configure staging Google sign-in and tenant email links without secret Terraform variables."""
import argparse
import re
from control import api, cloud, load_config, now, read, require, save, sha, workspace, validate_config, validate_evidence, digest, ensure_clean


def configure(config, approval):
    validate_config(config,mutate=True)
    ensure_clean()
    require(approval==config['projectId'],'Explicit staging project approval is required.')
    config={**config,'_identity':config['terraform']['terraform_service_account_email']}
    project=config['projectId']; manifest=read(workspace(config)/'runtime-manifest.json')
    infra=validate_evidence(read(workspace(config)/'infrastructure-apply.json'),config,'infrastructure-apply')
    require(infra.get('runtimeManifestDigest')==digest(manifest),'Unapproved authentication manifest.')
    secret=config['googleSignInSecret']
    require(secret['secretId']=='proinspect-staging-google-signin-client-secret','Use the Terraform-managed staging OAuth secret.')
    require(re.fullmatch(r'[1-9][0-9]*',str(secret['version'])),'Pin the enabled OAuth client secret version.')
    require(cloud(config,'secrets','versions','describe',str(secret['version']),'--secret='+secret['secretId']).get('state')=='ENABLED','OAuth secret version is not enabled.')
    url='https://identitytoolkit.googleapis.com/admin/v2/projects/'+project
    current=api(config,url+'/config',optional=True)
    if current is None:
        api(config,'https://identitytoolkit.googleapis.com/v2/projects/'+project+'/identityPlatform:initializeAuth',method='POST',body={})
    domains=sorted(set(manifest['authDomains']+[manifest['firebaseConfig']['authDomain']]))
    require(all(re.fullmatch(r'[a-z0-9][a-z0-9.-]+',d) for d in domains),'Auth domains must be bare hostnames.')
    api(config,url+'/config?updateMask=authorizedDomains,signIn.email,signIn.allowDuplicateEmails',method='PATCH',body={'authorizedDomains':domains,'signIn':{'email':{'enabled':True,'passwordRequired':False},'allowDuplicateEmails':False}})
    provider_url=url+'/defaultSupportedIdpConfigs/google.com'
    exists=api(config,provider_url,optional=True)
    value=cloud(config,'secrets','versions','access',str(secret['version']),'--secret='+secret['secretId'],json_output=False)
    require(value,'OAuth secret payload is empty.')
    client_id=config['googleSignInClientId']
    require(client_id.endswith('.apps.googleusercontent.com'),'A Google OAuth web client ID is required.')
    body={'enabled':True,'clientId':client_id,'clientSecret':value}
    if exists is None:
        api(config,url+'/defaultSupportedIdpConfigs?idpId=google.com',method='POST',body=body)
    else:
        api(config,provider_url+'?updateMask=enabled,clientId,clientSecret',method='PATCH',body=body)
    # Never persist the provider API response: it may contain clientSecret.
    save(workspace(config)/'auth-configuration.json',{'schemaVersion':1,'status':'passed',**{k:config[k] for k in ('environment','projectId','databaseId')},'sourceSha':sha(),'domains':domains,'googleProviderEnabled':True,'emailLinksEnabled':True,'secretVersion':str(secret['version']),'completedAt':now()})
    print('Staging Google sign-in and tenant email-link configuration applied; no OAuth secret written to state or logs.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--config',required=True); parser.add_argument('--approve',required=True)
    args=parser.parse_args()
    try: configure(load_config(args.config,mutate=True),args.approve)
    except (ValueError,RuntimeError,OSError,KeyError) as error: raise SystemExit('AUTH CONFIGURATION BLOCKED: '+str(error))
