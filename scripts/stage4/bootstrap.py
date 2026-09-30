#!/usr/bin/env python3
"""One-time keyless production setup, from an authorized Cloud Shell/local session.
This does NOT deploy Cloud Run, change customer data, replace secrets, or apply
the platform Terraform. Review the JSON plan and approve its SHA-256 first.
"""
from __future__ import annotations
import argparse
import json
import re
from common import PROJECT, REPOSITORY, config, digest, require, run, private_bucket, record

ROLES={
 "terraform":["roles/serviceusage.serviceUsageAdmin","roles/resourcemanager.projectIamAdmin",
   "roles/iam.serviceAccountAdmin","roles/iam.workloadIdentityPoolAdmin","roles/iam.roleAdmin",
   "roles/storage.admin","roles/secretmanager.admin","roles/datastore.owner",
   "roles/artifactregistry.admin","roles/firebase.admin","roles/run.viewer",
   "roles/logging.viewer","roles/cloudbuild.builds.viewer"],
 "build":["roles/logging.logWriter","roles/serviceusage.serviceUsageConsumer"],
 "deploy":["roles/run.developer","roles/run.invoker","roles/cloudbuild.builds.editor",
   "roles/secretmanager.viewer","roles/artifactregistry.reader","roles/serviceusage.serviceUsageConsumer"],
 "migration":["roles/datastore.user","roles/datastore.importExportAdmin","roles/datastore.owner",
   "roles/serviceusage.serviceUsageConsumer"],
}
def setup_plan(c):
    t=c["terraform"]; p=c["production"]
    accounts={"terraform":t["terraform_service_account_email"],"build":p["buildIdentity"],
              "deploy":p["deployIdentity"],"migration":p["migrationIdentity"]}
    repository=p["imageRepository"].split("/")[2]
    pool=t.get("workload_identity_pool_id") or "proinspect-production"
    provider=t.get("workload_identity_pool_provider_id") or "github"
    return {"projectId":PROJECT,"sourceSha":c["sourceSha"],"configDigest":digest(c),
      "accounts":accounts,"roles":ROLES,
      "buckets":sorted({c["state"]["bucket"],p["evidenceBucket"],p["backupBucket"],p["buildSourceBucket"]}),
      "artifactRepository":repository,"region":t["region"],
      "workloadIdentityPool":pool,"workloadIdentityProvider":provider,
      "runtimeIdentity":t["runtime_service_account_email"],"operatorPrincipal":c["operatorPrincipal"],
      "providerCondition":"assertion.repository_id == '1390107826' && assertion.repository_owner_id == '235419395' && assertion.repository == '"+REPOSITORY+"' && assertion.sub == 'repo:info-rbp@235419395/ProInspect-Platform@1390107826:environment:production' && ((assertion.ref == 'refs/heads/release/platform-unification' && assertion.workflow_ref == '"+REPOSITORY+"/.github/workflows/stage4-production.yml@refs/heads/release/platform-unification') || (assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '"+REPOSITORY+"/.github/workflows/stage4-production.yml@refs/heads/main'))",
      "scope":"Supporting IAM/storage/build/federation only; no runtime service or customer data changes."}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--config",required=True);parser.add_argument("--approve")
    args=parser.parse_args();c=config(args.config);plan=setup_plan(c)
    print(json.dumps(plan,indent=2));print("Approval digest: "+digest(plan))
    if args.approve is None:return
    require(args.approve==digest(plan),"Approve the exact displayed bootstrap plan.")
    def g(*args,json_output=True):
        return run(["gcloud",*args,"--project="+PROJECT,"--quiet",*(["--format=json"] if json_output else [])],json_output=json_output)
    project=g("projects","describe",PROJECT)
    require(project.get("lifecycleState")=="ACTIVE" and g("billing","projects","describe",PROJECT).get("billingEnabled") is True,"Production project/billing is not active.")
    existing={x["email"] for x in g("iam","service-accounts","list")}
    require(plan["runtimeIdentity"] in existing,"Existing production runtime identity not found; refusing replacement.")
    g("services","enable","iam.googleapis.com","iamcredentials.googleapis.com","sts.googleapis.com",
      "cloudresourcemanager.googleapis.com","serviceusage.googleapis.com","storage.googleapis.com",
      "artifactregistry.googleapis.com","cloudbuild.googleapis.com","firestore.googleapis.com",
      "firebase.googleapis.com","firebaserules.googleapis.com","secretmanager.googleapis.com",
      "run.googleapis.com","identitytoolkit.googleapis.com","calendar-json.googleapis.com",json_output=False)
    for purpose,email in plan["accounts"].items():
        if email not in existing:g("iam","service-accounts","create",email.split("@")[0],"--display-name=ProInspect production "+purpose)
        for role in ROLES[purpose]:
            g("projects","add-iam-policy-binding",PROJECT,"--member=serviceAccount:"+email,"--role="+role,"--condition=None")
    terraform=plan["accounts"]["terraform"]; deploy=plan["accounts"]["deploy"]; build=plan["accounts"]["build"]
    for email in {*plan["accounts"].values(),plan["runtimeIdentity"]}:
        g("iam","service-accounts","add-iam-policy-binding",email,"--member=serviceAccount:"+terraform,"--role=roles/iam.serviceAccountTokenCreator")
    g("iam","service-accounts","add-iam-policy-binding",terraform,"--member="+plan["operatorPrincipal"],"--role=roles/iam.serviceAccountTokenCreator")
    for email in (build,plan["runtimeIdentity"]):
        g("iam","service-accounts","add-iam-policy-binding",email,"--member=serviceAccount:"+deploy,"--role=roles/iam.serviceAccountUser")
    buckets={b["name"].removeprefix("gs://") for b in g("storage","buckets","list")}
    for bucket in plan["buckets"]:
        if bucket not in buckets:
            require(c.get("bootstrapCreateSupportingResources") is True,"Explicit bootstrapCreateSupportingResources approval is required to create missing buckets.")
            g("storage","buckets","create","gs://"+bucket,"--location="+c["terraform"]["storage_location"],
              "--uniform-bucket-level-access","--public-access-prevention",json_output=False)
            g("storage","buckets","update","gs://"+bucket,"--versioning",json_output=False)
        private_bucket(c,bucket)
    for bucket in {c["production"]["buildSourceBucket"],c["production"]["evidenceBucket"]}:
        g("storage","buckets","add-iam-policy-binding","gs://"+bucket,"--member=serviceAccount:"+deploy,"--role=roles/storage.objectAdmin")
    g("storage","buckets","add-iam-policy-binding","gs://"+c["production"]["buildSourceBucket"],"--member=serviceAccount:"+build,"--role=roles/storage.objectViewer")
    backup=c["production"]["backupBucket"]
    for member in ("serviceAccount:"+plan["accounts"]["migration"],
                   "serviceAccount:service-"+str(project["projectNumber"])+"@gcp-sa-firestore.iam.gserviceaccount.com"):
        g("storage","buckets","add-iam-policy-binding","gs://"+backup,"--member="+member,"--role=roles/storage.objectAdmin")
    repository=plan["artifactRepository"];region=plan["region"]
    repos=g("artifacts","repositories","list","--location="+region)
    if not any(x["name"].endswith("/repositories/"+repository) for x in repos):
        require(c.get("bootstrapCreateSupportingResources") is True,"Missing repository requires explicit supporting-resource creation approval.")
        g("artifacts","repositories","create",repository,"--location="+region,"--repository-format=docker")
    g("artifacts","repositories","add-iam-policy-binding",repository,"--location="+region,"--member=serviceAccount:"+build,"--role=roles/artifactregistry.writer")
    number=str(project["projectNumber"]);pool=plan["workloadIdentityPool"];provider_id=plan["workloadIdentityProvider"]
    pools=g("iam","workload-identity-pools","list","--location=global")
    pool_name="projects/"+number+"/locations/global/workloadIdentityPools/"+pool
    if not any(x["name"]==pool_name for x in pools):
        require(c.get("bootstrapCreateSupportingResources") is True,"Selected Workload Identity Pool does not exist; review it before allowing bootstrap creation.")
        g("iam","workload-identity-pools","create",pool,"--location=global")
    providers=g("iam","workload-identity-pools","providers","list","--location=global","--workload-identity-pool="+pool)
    provider=next((x for x in providers if x["name"]==pool_name+"/providers/"+provider_id),None)
    if provider:
        require(provider.get("attributeCondition")==plan["providerCondition"] and provider.get("oidc",{}).get("issuerUri")=="https://token.actions.githubusercontent.com","Existing federation differs; inspect it instead of overwriting.")
    else:
        require(c.get("bootstrapCreateSupportingResources") is True,"Selected GitHub Workload Identity Provider does not exist; review it before allowing bootstrap creation.")
        g("iam","workload-identity-pools","providers","create-oidc",provider_id,"--location=global","--workload-identity-pool="+pool,
          "--issuer-uri=https://token.actions.githubusercontent.com","--attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref",
          "--attribute-condition="+plan["providerCondition"])
    g("iam","service-accounts","add-iam-policy-binding",terraform,"--role=roles/iam.workloadIdentityUser",
      "--member=principalSet://iam.googleapis.com/"+pool_name+"/attribute.repository_id/1390107826")
    print("Keyless provider: "+pool_name+"/providers/"+provider_id)
    print("Production runtime service and customer data were not modified.")

if __name__=="__main__":main()
