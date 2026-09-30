#!/usr/bin/env python3
"""Read-only Stage 4 production discovery. Never reads secret payloads or mutates GCP."""
from __future__ import annotations
import argparse, copy, json, re, subprocess, urllib.request
from pathlib import Path

PROJECT="business-plan-applicatio-17047"
PROJECT_NUMBER="696236368989"
DATABASE="ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a"
SERVICE="proinspect-booking-portal-application"
REGION="europe-west1"
REPOSITORY="info-rbp/ProInspect-Platform"
REPOSITORY_ID="1390107826"
OWNER_ID="235419395"

def command(args, *, allow_fail=False):
    p=subprocess.run(["gcloud",*args,"--project="+PROJECT,"--quiet","--format=json"],
                     text=True,capture_output=True)
    if p.returncode and not allow_fail:
        raise RuntimeError("Read-only gcloud discovery failed for: "+" ".join(args))
    if p.returncode:return None
    raw=p.stdout.strip()
    return json.loads(raw) if raw else None

def token():
    return subprocess.run(["gcloud","auth","print-access-token"],text=True,capture_output=True,check=True).stdout.strip()

def firebase_apps():
    req=urllib.request.Request("https://firebase.googleapis.com/v1beta1/projects/"+PROJECT+"/webApps?pageSize=100",
                               headers={"Authorization":"Bearer "+token()})
    try:
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response).get("apps",[])
    except Exception:return []

def env_map(service):
    containers=service.get("spec",{}).get("template",{}).get("spec",{}).get("containers",[])
    return {x.get("name"):x for x in (containers[0].get("env",[]) if containers else []) if x.get("name")}

def enabled_version(secret_id):
    versions=command(["secrets","versions","list",secret_id,"--filter=state:enabled"],allow_fail=True) or []
    numeric=[]
    for item in versions:
        value=str(item.get("name","")).rsplit("/",1)[-1]
        if value.isdigit():numeric.append(int(value))
    return str(max(numeric)) if numeric else None

def state_candidates(buckets,prefix):
    target=prefix.strip("/")+"/default.tfstate";result=[]
    for item in buckets:
        name=str(item.get("name","")).removeprefix("gs://")
        if not name:continue
        p=subprocess.run(["gcloud","storage","ls","gs://"+name+"/"+target,"--project="+PROJECT],
                         text=True,capture_output=True)
        if p.returncode==0 and p.stdout.strip():result.append(name)
    return result

def verify_federation(terraform_sa,wif_provider):
    m=re.fullmatch(r"projects/(\d+)/locations/global/workloadIdentityPools/([^/]+)/providers/([^/]+)",wif_provider)
    if not m or m.group(1)!=PROJECT_NUMBER:raise RuntimeError("WIF provider is not in the frozen production project.")
    _,pool,provider_id=m.groups()
    provider=command(["iam","workload-identity-pools","providers","describe",provider_id,
                      "--workload-identity-pool="+pool,"--location=global"])
    if provider.get("oidc",{}).get("issuerUri")!="https://token.actions.githubusercontent.com":
        raise RuntimeError("WIF provider issuer is not GitHub Actions.")
    condition=provider.get("attributeCondition","")
    required=[f"assertion.repository_id == '{REPOSITORY_ID}'",f"assertion.repository_owner_id == '{OWNER_ID}'",
              f"assertion.repository == '{REPOSITORY}'",
              "assertion.sub == 'repo:info-rbp@235419395/ProInspect-Platform@1390107826:environment:production'",
              "stage4-production.yml","refs/heads/release/platform-unification","refs/heads/main"]
    if any(value not in condition for value in required):
        raise RuntimeError("WIF provider condition does not contain the exact repository, production environment, workflow and branch restrictions.")
    mapping=provider.get("attributeMapping",{})
    for key in ("google.subject","attribute.repository_id","attribute.repository_owner_id","attribute.repository",
                "attribute.ref","attribute.workflow_ref"):
        if key not in mapping:raise RuntimeError("WIF provider is missing required attribute mapping: "+key)
    policy=command(["iam","service-accounts","get-iam-policy",terraform_sa])
    repo_member="/workloadIdentityPools/"+pool+"/attribute.repository_id/"+REPOSITORY_ID
    workload_ok=any(b.get("role")=="roles/iam.workloadIdentityUser" and
                    any(repo_member in x for x in b.get("members",[])) for b in policy.get("bindings",[]))
    self_member="serviceAccount:"+terraform_sa
    self_token_ok=any(b.get("role")=="roles/iam.serviceAccountTokenCreator" and
                      self_member in b.get("members",[]) for b in policy.get("bindings",[]))
    if not workload_ok:raise RuntimeError("Terraform service account lacks the repository-scoped Workload Identity User binding.")
    if not self_token_ok:raise RuntimeError("Terraform service account lacks the self Token Creator binding required by the Stage 4 control plane.")
    return {"poolId":pool,"providerId":provider_id,"issuer":"https://token.actions.githubusercontent.com",
            "repositoryScopedWorkloadIdentityUser":True,"selfTokenCreator":True}

def main():
    p=argparse.ArgumentParser();p.add_argument("--template",required=True);p.add_argument("--output",required=True)
    p.add_argument("--source-sha",required=True);p.add_argument("--release-id",required=True)
    p.add_argument("--terraform-sa",required=True);p.add_argument("--wif-provider",required=True)
    a=p.parse_args()
    federation=verify_federation(a.terraform_sa,a.wif_provider)
    template=json.loads(Path(a.template).read_text());draft=copy.deepcopy(template)
    draft["sourceSha"]=a.source_sha;draft["releaseId"]=a.release_id
    draft["terraform"]["terraform_service_account_email"]=a.terraform_sa
    draft["terraform"]["workload_identity_pool_id"]=federation["poolId"]
    draft["terraform"]["workload_identity_pool_provider_id"]=federation["providerId"]

    project=command(["projects","describe",PROJECT])
    if str(project.get("projectNumber"))!=PROJECT_NUMBER:raise RuntimeError("Production project number mismatch.")
    database=command(["firestore","databases","describe","--database="+DATABASE])
    service=command(["run","services","describe",SERVICE,"--region="+REGION])
    buckets=command(["storage","buckets","list"]) or []
    accounts=command(["iam","service-accounts","list"]) or []
    repos=command(["artifacts","repositories","list","--location="+REGION],allow_fail=True) or []
    secrets=command(["secrets","list"]) or []
    builds=command(["builds","list","--limit=20","--sort-by=~createTime"],allow_fail=True) or []
    triggers=[]
    for region in ("global",REGION):
        for item in command(["builds","triggers","list","--region="+region],allow_fail=True) or []:
            triggers.append({"region":region,"id":item.get("id"),"name":item.get("name"),
                             "disabled":bool(item.get("disabled"))})
    apps=firebase_apps();runtime=env_map(service)
    runtime_sa=service.get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName")
    if runtime_sa:draft["terraform"]["runtime_service_account_email"]=runtime_sa
    mapping={"GOOGLE_CALENDAR_ID":"google_calendar_id","ADMIN_EMAILS":"admin_emails","APP_URL":"app_url",
      "ADDRESS_VALIDATION_MODE":"address_validation_mode","ACCESS_DATA_ENCRYPTION_KEY_ID":"access_data_encryption_key_id",
      "BOOKING_EMAIL_FROM":"booking_email_from","BOOKING_EMAIL_REPLY_TO":"booking_email_reply_to",
      "DOCUMENT_REQUEST_NOTIFY_TO":"document_request_notify_to","REPORT_TOOL_URL":"report_tool_url",
      "FIREBASE_STORAGE_BUCKET":"client_documents_bucket_name"}
    for env_name,field in mapping.items():
        value=runtime.get(env_name,{}).get("value")
        if value:draft["terraform"][field]=value
    if database.get("locationId"):draft["terraform"]["firestore_location"]=database["locationId"]

    secret_ids={str(x.get("name","")).rsplit("/",1)[-1] for x in secrets}
    for key in list(draft["secretBindings"]):
        ref=runtime.get(key,{}).get("valueFrom",{}).get("secretKeyRef",{})
        secret_id=ref.get("name") or draft["secretBindings"][key]
        if secret_id in secret_ids:
            draft["secretBindings"][key]=secret_id
            version=str(ref.get("key",""))
            if version.isdigit():draft["secretVersions"][key]=version
            else:
                resolved=enabled_version(secret_id)
                if resolved:draft["secretVersions"][key]=resolved

    containers=service.get("spec",{}).get("template",{}).get("spec",{}).get("containers",[])
    image=containers[0].get("image","") if containers else ""
    match=re.match(r"^"+re.escape(REGION)+r"-docker\.pkg\.dev/"+re.escape(PROJECT)+r"/([^/]+)/",image)
    if match:
        repo_id=match.group(1);draft["terraform"]["artifact_repository_id"]=repo_id
        draft["production"]["imageRepository"]=REGION+"-docker.pkg.dev/"+PROJECT+"/"+repo_id+"/platform"

    states=state_candidates(buckets,draft["state"]["prefix"])
    if len(states)==1:draft["state"]["bucket"]=states[0]
    build_source=[]
    for item in builds:
        value=(item.get("source",{}).get("storageSource",{}) or {}).get("bucket")
        if value and value not in build_source:build_source.append(value)

    existing_accounts={x.get("email") for x in accounts}
    planned={k:draft["production"][k] for k in ("buildIdentity","deployIdentity","migrationIdentity")}
    manual=[]
    def unresolved(path,value):
        if isinstance(value,str) and value.startswith("REQUIRED_"):manual.append(path)
    unresolved("operatorPrincipal",draft.get("operatorPrincipal"));unresolved("state.bucket",draft["state"].get("bucket"))
    unresolved("terraform.client_documents_bucket_name",draft["terraform"].get("client_documents_bucket_name"))
    unresolved("terraform.artifact_repository_id",draft["terraform"].get("artifact_repository_id"))
    for key,value in draft["terraform"]["operations_bucket_names"].items():unresolved("terraform.operations_bucket_names."+key,value)
    for key,value in draft["secretVersions"].items():unresolved("secretVersions."+key,value)
    unresolved("testEmail",draft.get("testEmail"))
    for key,value in draft["bookingTest"].items():unresolved("bookingTest."+key,value)

    inventory={"federation":federation,
      "project":{"projectId":project.get("projectId"),"projectNumber":str(project.get("projectNumber",""))},
      "database":{"name":database.get("name"),"locationId":database.get("locationId"),"type":database.get("type")},
      "cloudRun":{"service":service.get("metadata",{}).get("name"),"runtimeServiceAccount":runtime_sa,
                  "url":service.get("status",{}).get("url"),"currentImage":image,
                  "runtimeEnvironmentNames":sorted(runtime.keys())},
      "firebaseWebApps":[{"appId":x.get("appId"),"displayName":x.get("displayName")} for x in apps],
      "buckets":[{"name":str(x.get("name","")).removeprefix("gs://"),"location":x.get("location")} for x in buckets],
      "stateBucketCandidates":states,
      "artifactRepositories":[{"name":x.get("name"),"format":x.get("format")} for x in repos],
      "serviceAccounts":{"plannedStage4":planned,"plannedStage4Present":{k:v in existing_accounts for k,v in planned.items()}},
      "requiredSecretsPresent":{k:(v in secret_ids) for k,v in draft["secretBindings"].items()},
      "resolvedSecretVersions":{k:v for k,v in draft["secretVersions"].items() if str(v).isdigit()},
      "activeBuildTriggers":[x for x in triggers if not x["disabled"]],
      "buildSourceBucketCandidates":build_source,"manualRequired":sorted(manual),
      "notes":["No secret payloads were read.","Ownership review flags remain false.",
               "Active build triggers are reported but not automatically approved."]}
    Path(a.output).write_text(json.dumps({"schemaVersion":1,"mode":"read-only-production-discovery",
      "sourceSha":a.source_sha,"releaseId":a.release_id,"descriptorDraft":draft,"inventory":inventory},indent=2)+"\n")
    print("Read-only production discovery completed.")
    print("Manual descriptor fields remaining:",", ".join(inventory["manualRequired"]) or "none")
if __name__=="__main__":main()
