#!/usr/bin/env python3
"""Approved production cutover; never infer resource IDs, silently migrate, or merge main."""
from __future__ import annotations
import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
import uuid
from common import *
from checkpoints import session

def checkpoint(c,name):
    return workspace(c)/(name+".json")


def migration(c,path,action,*,output,extra=()):
    run(["node","--import","tsx","scripts/stage4/migrate.ts","--config",str(path),
         "--action",action,"--output",str(checkpoint(c,output)),*extra])
    return read(checkpoint(c,output))


def capture(c,path,name="pre-infrastructure-capture",database=None):
    return migration(c,path,"capture",output=name,
        extra=(["--database",database] if database else []))


def secret(c,key):
    sid=c["secretBindings"][key]; version=str(c["secretVersions"][key])
    require(cloud(c,"secrets","versions","describe",version,"--secret="+sid).get("state")=="ENABLED",
            "Required Secret Manager version is not enabled: "+key)
    return cloud(c,"secrets","versions","access",version,"--secret="+sid,json_output=False)


def encryption_fingerprint(value):
    raw=value.strip().removeprefix("base64:")
    try: decoded=base64.b64decode(raw,validate=True)
    except Exception: raise ValueError("Invalid encryption key encoding.") from None
    require(len(decoded)==32,"Production encryption key must be exactly 32 bytes.")
    return digest(decoded)


def encryption_baseline(c, env):
    current=env.get("ACCESS_DATA_ENCRYPTION_KEY")
    if current:
        if "value" in current:
            current_key=current["value"]
        else:
            ref=current["valueFrom"]["secretKeyRef"]
            require(re.fullmatch(r"[A-Za-z0-9_-]+",ref["name"]),
                    "Inspect cross-project/aliased secret bindings manually.")
            current_key=cloud(c,"secrets","versions","access",ref["key"],
                              "--secret="+ref["name"],json_output=False)
        key_hash=encryption_fingerprint(current_key)
        require(encryption_fingerprint(secret(c,"ACCESS_DATA_ENCRYPTION_KEY"))==key_hash,
                "Encryption-key rotation is not part of this cutover.")
        require(env.get("ACCESS_DATA_ENCRYPTION_KEY_ID",{}).get("value","v1")
                ==c["terraform"]["access_data_encryption_key_id"],
                "Preserve the current encryption key ID.")
        return key_hash,"existing"

    root="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/"+DATABASE+"/documents/"
    for collection in ("bookingAccessSecrets","documentRequestSecrets"):
        page=api(c,root+collection+"?pageSize=1&mask.fieldPaths=keyId")
        require(not page.get("documents"),
                "Encrypted access records exist but the running production revision has no encryption-key binding; recover the existing key before continuing.")
    require(c["terraform"]["access_data_encryption_key_id"]=="v1",
            "A first production encryption key must start at key ID v1.")
    return encryption_fingerprint(secret(c,"ACCESS_DATA_ENCRYPTION_KEY")),"initial"


def tf(c,*args,json_output=False):
    env={**os.environ,"TF_DATA_DIR":str(workspace(c)/"terraform-data"),
         "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT":c["terraform"]["terraform_service_account_email"]}
    return run(["terraform","-chdir=infrastructure",*args],env=env,json_output=json_output)


def init(c):
    tf(c,"init","-input=false","-reconfigure","-lockfile=readonly",
       "-backend-config=bucket="+c["state"]["bucket"],
       "-backend-config=prefix="+c["state"]["prefix"],
       "-backend-config=impersonate_service_account="+c["terraform"]["terraform_service_account_email"])


FIRESTORE_RULESET_ADDRESS="google_firebaserules_ruleset.firestore"
FIRESTORE_RULES_RELEASE_ADDRESS="google_firebaserules_release.firestore"


def expected_firestore_rules_release_name(c):
    return "cloud.firestore" if c["databaseId"]=="(default)" else "cloud.firestore/"+c["databaseId"]


def expected_firestore_ruleset_replacement(resource,c):
    if resource.get("type")!="google_firebaserules_ruleset" or resource.get("address")!=FIRESTORE_RULESET_ADDRESS:
        return False
    change=resource.get("change",{})
    actions=change.get("actions",[])
    if actions!=["create","delete"]:
        return False
    before=change.get("before") or {}
    after=change.get("after") or {}
    if before.get("project")!=c["projectId"] or after.get("project")!=c["projectId"]:
        return False
    ruleset_prefix="projects/"+c["projectId"]+"/rulesets/"
    before_name=before.get("name")
    if not isinstance(before_name,str) or not before_name.startswith(ruleset_prefix):
        return False
    after_name=after.get("name")
    after_name_unknown=(change.get("after_unknown") or {}).get("name") is True
    if not after_name_unknown and (not isinstance(after_name,str) or not after_name.startswith(ruleset_prefix)):
        return False
    source=after.get("source")
    if not isinstance(source,list) or len(source)!=1:
        return False
    files=source[0].get("files")
    if not isinstance(files,list) or len(files)!=1 or files[0].get("name")!="firestore.rules":
        return False
    replace_paths=change.get("replace_paths") or []
    return bool(replace_paths) and all(path and path[0]=="source" for path in replace_paths)


def expected_firestore_rules_release_replacement(resource,c):
    if resource.get("type")!="google_firebaserules_release" or resource.get("address")!=FIRESTORE_RULES_RELEASE_ADDRESS:
        return False
    change=resource.get("change",{})
    actions=change.get("actions",[])
    if len(actions)!=2 or set(actions)!={"create","delete"}:
        return False
    before=change.get("before") or {}
    after=change.get("after") or {}
    expected_name=expected_firestore_rules_release_name(c)
    if before.get("project")!=c["projectId"] or after.get("project")!=c["projectId"]:
        return False
    if before.get("name")!=expected_name or after.get("name")!=expected_name:
        return False
    ruleset_prefix="projects/"+c["projectId"]+"/rulesets/"
    before_ruleset=before.get("ruleset_name")
    if not isinstance(before_ruleset,str) or not before_ruleset.startswith(ruleset_prefix):
        return False
    after_unknown=(change.get("after_unknown") or {}).get("ruleset_name") is True
    after_ruleset=after.get("ruleset_name")
    if not after_unknown and (not isinstance(after_ruleset,str) or not after_ruleset.startswith(ruleset_prefix)):
        return False
    return change.get("replace_paths")==[["ruleset_name"]]


def expected_firestore_rules_transition(resource,c):
    return expected_firestore_ruleset_replacement(resource,c) or expected_firestore_rules_release_replacement(resource,c)


def production_plan_guard(plan,c):
    require(plan.get("complete",True) is not False,"Incomplete/deferred Terraform plan cannot be applied.")
    changes=plan.get("resource_changes",[])
    unexpected=[]
    for r in changes:
        if r.get("mode")=="data":
            continue
        actions=(r.get("change") or {}).get("actions",[])
        if {"delete","forget"}.intersection(actions) and (
            "forget" in actions or not expected_firestore_rules_transition(r,c)
        ):
            unexpected.append(r.get("address","<unknown>"))
    require(not unexpected,
            "Production plan contains unapproved destructive changes: "+", ".join(sorted(set(unexpected))))
    approved=[
        r.get("address") for r in changes
        if expected_firestore_rules_transition(r,c)
    ]
    stage3.guard_plan(plan,{**c,"approvedEphemeralReplacements":approved})
    for r in changes:
        if r.get("mode")=="data": continue
        kind=r["type"]; ch=r["change"]
        destructive={"delete","forget"}.intersection(ch["actions"])
        if destructive:
            require(
                "forget" not in ch["actions"] and expected_firestore_rules_transition(r,c),
                "Production deletions, replacements and forgetting state are prohibited except the canonical Firestore ruleset/release transition."
            )
        require(not kind.endswith(("_iam_policy","_iam_binding")),"Authoritative IAM updates can remove unrelated permissions.")
        if kind in ("google_firestore_database","google_firebase_project","google_firebase_web_app"):
            require("create" not in ch["actions"] or ch.get("importing"),"Existing production data/auth resources must be imported, never recreated.")
        if kind=="google_firestore_field":
            require(not (ch.get("after") or {}).get("ttl_config"),"TTL activation requires a separate data-deletion review.")


def inventory(c):
    ci=verify_ci(c["sourceSha"])
    private_bucket(c,c["state"]["bucket"])
    private_bucket(c,c["production"]["backupBucket"])
    current=service(c)
    require(current.get("metadata",{}).get("name")==SERVICE,"Wrong Cloud Run service.")
    spec=current["spec"]["template"]["spec"]
    require(spec.get("serviceAccountName")==c["terraform"]["runtime_service_account_email"],
            "Production runtime identity differs from reviewed descriptor.")
    live_db=cloud(c,"firestore","databases","describe","--database="+DATABASE)
    require(live_db.get("locationId")==c["terraform"]["firestore_location"],"Firestore location mismatch; do not relocate or recreate.")
    iam=cloud(c,"run","services","get-iam-policy",SERVICE,"--region="+REGION)
    env={x["name"]:x for x in spec["containers"][0].get("env",[])}
    key_hash,encryption_mode=encryption_baseline(c,env)
    inv=stage3.inventory(c)
    require(c.get("deploymentOwnershipReviewed") is True,
            "Review/disable competing production build and deployment triggers before continuing.")
    triggers=[]
    for region in sorted(set(["global",REGION,*c.get("buildTriggerRegions",[])])):
        triggers.extend(cloud(c,"builds","triggers","list","--region="+region))
    # Retain names/IDs only. Secret-valued substitutions must never enter evidence.
    active=[{"id":x.get("id"),"name":x.get("name")} for x in triggers if not x.get("disabled")]
    require({x["id"] for x in active} <= set(c.get("reviewedUnrelatedTriggerIds",[])),
            "Unreviewed active Cloud Build triggers could compete with the release.")
    existing=checkpoint(c,"baseline")
    proposed={"allocation":traffic(current),
      "tags":[{"tag":x["tag"],"revisionName":x["revisionName"]} for x in current["status"].get("traffic",[]) if x.get("tag")],
      "serviceUrl":current["status"]["url"],"iamDigest":digest(iam),
      "encryptionFingerprint":key_hash,"encryptionMode":encryption_mode,
      "drainSeconds":int(spec.get("timeoutSeconds",300))+10}
    if existing.exists():
        base=evidence(c,"baseline")
        require(base["allocation"]==proposed["allocation"],"Baseline cannot be overwritten after traffic moves.")
    else: record(c,"baseline",**proposed)
    record(c,"inventory",resources=inv,reviewedUnrelatedTriggers=active,ciRun=ci)
    return inv


def plan(c):
    inv=inventory(c)
    init(c)
    addresses=set(tf(c,"state","list").splitlines())
    imports=stage3.adoption_imports(c,inv,addresses)
    accounts={r:c["production"][r+"Identity"] for r in ("build","deploy","migration")}
    accounts["gateway"]="proinspect-prod-gateway@"+PROJECT+".iam.gserviceaccount.com"
    for purpose,email in accounts.items():
        address='google_service_account.platform["'+purpose+'"]'
        found=[a for a in inv["accounts"] if a["email"]==email]
        if found and address not in addresses: imports[address]=found[0]["name"]
    for purpose,name in c["terraform"].get("operations_bucket_names",{}).items():
        address='google_storage_bucket.operations["'+purpose+'"]'
        if address not in addresses and any(b["name"].removeprefix("gs://")==name for b in inv["buckets"]):
            imports[address]=name
    repository=c["terraform"].get("artifact_repository_id","") or "proinspect-production"
    if "google_artifact_registry_repository.platform" not in addresses:
        match=[r for r in inv["repositories"] if r["name"].endswith("/repositories/"+repository)]
        if match: imports["google_artifact_registry_repository.platform"]=match[0]["name"]
    if "google_secret_manager_secret.production_release_token[0]" not in addresses:
        found=[x for x in inv["secrets"] if x["name"].endswith("/proinspect-production-release-token")]
        if found: imports["google_secret_manager_secret.production_release_token[0]"]=found[0]["name"].rsplit("/",1)[-1]
    generated="".join('import {\n  to = '+a+'\n  id = '+json.dumps(v)+'\n}\n' for a,v in imports.items())
    path=workspace(c)/"imports.generated.tf"; path.write_text(generated)
    (ROOT/"infrastructure/imports.generated.tf").write_text(generated)
    variables=workspace(c)/"inputs.auto.tfvars.json"; save(variables,c["terraform"])
    tf(c,"fmt","imports.generated.tf")
    path.write_text((ROOT/"infrastructure/imports.generated.tf").read_text())
    tf(c,"validate")
    tf(c,"plan","-input=false","-lock-timeout=5m","-var-file="+str(variables),
       "-out="+str(workspace(c)/"infrastructure.tfplan"))
    parsed=tf(c,"show","-json",workspace(c)/"infrastructure.tfplan",json_output=True)
    production_plan_guard(parsed,c); save(checkpoint(c,"infrastructure-plan"),parsed)
    record(c,"infrastructure-review",planDigest=digest((workspace(c)/"infrastructure.tfplan").read_bytes()),
           imports=imports)
    print("Production plan is ready for review; no resources were applied.")


def runtime_env(c):
    t=c["terraform"]
    return {"NODE_ENV":"production","PLATFORM_ENVIRONMENT":"production",
      "FIREBASE_PROJECT_ID":PROJECT,"FIRESTORE_DATABASE_ID":DATABASE,
      "APP_URL":APP_URL,"FIREBASE_STORAGE_BUCKET":t["client_documents_bucket_name"],
      "ADMIN_EMAILS":t["admin_emails"],"GOOGLE_CALENDAR_ID":t["google_calendar_id"],
      "ADDRESS_VALIDATION_MODE":t["address_validation_mode"],
      "ACCESS_DATA_ENCRYPTION_KEY_ID":t["access_data_encryption_key_id"],
      "BOOKING_EMAIL_FROM":t["booking_email_from"],"BOOKING_EMAIL_REPLY_TO":t["booking_email_reply_to"],
      "DOCUMENT_REQUEST_NOTIFY_TO":t["document_request_notify_to"],
      "TENANT_EMAIL_FROM":t["booking_email_from"],"TENANT_EMAIL_REPLY_TO":t["booking_email_reply_to"],
      "REPORT_TOOL_URL":t["report_tool_url"],
      "PAYMENT_CHECKOUT_URL_TEMPLATE":t.get("payment_checkout_url_template",""),
      "STAGING_EMAIL_RECIPIENT":"","PRODUCTION_RELEASE_ID":c["releaseId"],
      "PRODUCTION_SOURCE_SHA":c["sourceSha"]}


def build(c):
    verify_ci(c["sourceSha"]); evidence(c,"inventory")
    p=c["production"]
    with tempfile.TemporaryDirectory(prefix="proinspect-production-") as temp:
        raw=subprocess.check_output(["git","archive","--format=tar",c["sourceSha"]],cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive: archive.extractall(temp,filter="data")
        context=Path(temp)
        (context/"firebase-applet-config.json").write_text(json.dumps(c["firebaseConfig"]))
        image=p["imageRepository"]+":"+c["sourceSha"]+"-"+digest(c["firebaseConfig"])[:12]
        result=cloud(c,"builds","submit",temp,"--config="+str(context/"deploy/cloudbuild.production.yaml"),
            "--service-account=projects/"+PROJECT+"/serviceAccounts/"+p["buildIdentity"],
            "--gcs-source-staging-dir=gs://"+p["buildSourceBucket"]+"/source",
            "--substitutions=_IMAGE="+image+",_SOURCE_SHA="+c["sourceSha"],
            identity=p["deployIdentity"])
    if isinstance(result,list):
        require(len(result)==1,"Unexpected Cloud Build response."); result=result[0]
    require(result.get("status")=="SUCCESS","Cloud Build did not succeed.")
    images=[x for x in result.get("results",{}).get("images",[]) if x.get("name")==image]
    require(len(images)==1 and re.fullmatch(r"sha256:[a-f0-9]{64}",images[0].get("digest","")),"No immutable image digest.")
    record(c,"image",image=p["imageRepository"]+"@"+images[0]["digest"],
           buildId=result["id"],firebaseConfigDigest=digest(c["firebaseConfig"]))


def http(c,url,path,*,token="",method="GET",body=None,expected_revision=None):
    require(url.startswith("https://") and (urllib.parse.urlparse(url).hostname.endswith(".run.app") or url==APP_URL),
            "Production smoke must target the recorded Cloud Run origin.")
    headers={}
    if urllib.parse.urlparse(url).hostname.endswith(".run.app"):
        audience=evidence(c,"baseline")["serviceUrl"]
        identity_token=cloud(c,"auth","print-identity-token","--audiences="+audience,"--include-email",
            identity=c["production"]["deployIdentity"],json_output=False)
        headers["X-Serverless-Authorization"]="Bearer "+identity_token
    if token: headers["X-ProInspect-Release-Token"]=token
    if body is not None: headers["Content-Type"]="application/json"
    req=urllib.request.Request(url.rstrip("/")+path,method=method,headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=60) as response:
            if expected_revision is not None:
                require(response.headers.get("X-ProInspect-Release")==c["sourceSha"] and
                    response.headers.get("X-ProInspect-Revision")==expected_revision,
                    "Application origin is not serving the accepted source/revision.")
            return response.status,response.read()
    except urllib.error.HTTPError as error: return error.code,error.read()


def assert_policy(c):
    require(digest(cloud(c,"run","services","get-iam-policy",SERVICE,"--region="+REGION))==
            evidence(c,"baseline")["iamDigest"],"Cloud Run IAM changed unexpectedly.")


def maintenance(c,approve):
    approval(approve,"FREEZE:"+c["sourceSha"])
    base=evidence(c,"baseline"); image=evidence(c,"image")
    current=service(c)
    require(traffic(current)==base["allocation"],"Production traffic drifted before maintenance.")
    # Empty environment and secrets for a minimal server that imports no application modules.
    env=workspace(c)/"maintenance-env.private.json"
    save(env,{"NODE_ENV":"production","PRODUCTION_SOURCE_SHA":c["sourceSha"],"PRODUCTION_RELEASE_ID":c["releaseId"]})
    cloud(c,"run","deploy",SERVICE,"--region="+REGION,"--image="+image["image"],
          "--command=node","--args=--import,tsx,src/server/productionMaintenance.ts",
          "--env-vars-file="+str(env),"--clear-secrets","--no-traffic","--tag=stage4-maint",
          identity=c["production"]["deployIdentity"])
    live=service(c); revision=live["status"]["latestReadyRevisionName"]
    require(traffic(live)==base["allocation"],"Deploying maintenance unexpectedly changed customer traffic.")
    url=next(x["url"] for x in live["status"]["traffic"] if x.get("tag")=="stage4-maint" and x.get("revisionName")==revision)
    code,body=http(c,url,"/healthz")
    require(code==200 and json.loads(body).get("maintenance") is True,"Maintenance revision failed readiness.")
    require(http(c,url,"/api/bookings/create",method="POST",body={})[0]==503,"Maintenance revision allowed a booking mutation.")
    assert_policy(c)
    # Remove old revision tags as well: they can otherwise still reach legacy writers.
    cloud(c,"run","services","update-traffic",SERVICE,"--region="+REGION,
          "--to-revisions="+revision+"=100","--set-tags=stage4-maint="+revision,
          identity=c["production"]["deployIdentity"])
    record(c,"maintenance",revision=revision,url=url,activatedAt=now(),drainSeconds=base["drainSeconds"])
    print("Production is in maintenance. Writes stay paused until migration and acceptance pass.")


def assert_frozen(c,attestation):
    m=evidence(c,"maintenance")
    current=service(c)
    require(traffic(current)=={m["revision"]:100} and all(
      not x.get("tag") or x.get("revisionName")==m["revision"] for x in current["status"].get("traffic",[])),
      "Production maintenance/old-tag isolation is no longer intact.")
    a=attestation
    require(a.get("sourceSha")==c["sourceSha"] and a.get("releaseId")==c["releaseId"] and
            a.get("projectId")==PROJECT and a.get("operatorPrincipal")==c["operatorPrincipal"],
            "Write-freeze attestation belongs to another release/operator.")
    require(a.get("externalWritersPaused") is True and a.get("evidenceReference"),
            "Explicit external/background writer pause evidence is required.")
    fresh(a.get("completedAt"),"External writer freeze",hours=4)
    elapsed=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(m["activatedAt"])).total_seconds()
    remaining=m["drainSeconds"]-elapsed
    if remaining>0: time.sleep(remaining)
    record(c,"freeze",maintenanceRevision=m["revision"],externalWritersPaused=True,
           evidenceReference=a["evidenceReference"],drainedAt=now(),
           externalWriterVerification="operator-attested")
    return evidence(c,"freeze")


def operation(c,path,op,db):
    name=op.get("name","")
    require(name.startswith("projects/"+PROJECT+"/databases/"+db+"/operations/"),"Managed operation targets another database.")
    save(checkpoint(c,path),op) # Persist the real operation ID before polling.
    until=time.monotonic()+1800
    while not op.get("done"):
        require(time.monotonic()<until,"Managed operation still running; inspect its retained ID before retrying.")
        time.sleep(5)
        op=api(c,"https://firestore.googleapis.com/v1/"+name,identity=c["production"]["migrationIdentity"])
    require(not op.get("error") and op.get("metadata",{}).get("operationState")=="SUCCESSFUL",
            "Managed export/restore did not complete successfully.")
    save(checkpoint(c,path),op)
    return op


def backup(c,path,attestation):
    assert_frozen(c,attestation)
    # The reviewed migration plan must be generated AFTER the last writer has drained.
    draft=migration(c,path,"plan",output="migration-plan")
    before=capture(c,path)
    require(before["sourceHash"]==draft["sourceHash"],"Production changed during the frozen dry run.")
    prefix="gs://"+c["production"]["backupBucket"]+"/stage4/"+c["releaseId"]+"/"+uuid.uuid4().hex
    endpoint="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/"+DATABASE
    require(not checkpoint(c,"export-operation").exists(),"An export operation is already recorded. Inspect/recover that operation rather than repeat blindly.")
    op=operation(c,"export-operation",api(c,endpoint+":exportDocuments",method="POST",
        body={"outputUriPrefix":prefix},identity=c["production"]["migrationIdentity"]),DATABASE)
    require(op["metadata"].get("outputUriPrefix")==prefix,"Unexpected export destination.")
    after=capture(c,path)
    require(before==after or (before["sourceHash"]==after["sourceHash"] and before["counts"]==after["counts"]),"Writes occurred during managed backup.")
    record(c,"backup",status="SUCCESSFUL",operation=op["name"],outputUriPrefix=prefix,
           sourceHash=before["sourceHash"],counts=before["counts"])
    scratch="stage4-restore-"+uuid.uuid4().hex[:16]
    record(c,"restore",status="running",scratchDatabase=scratch,backupOperation=op["name"])
    cloud(c,"firestore","databases","create","--database="+scratch,
          "--location="+c["terraform"]["firestore_location"],"--type=firestore-native",
          identity=c["production"]["migrationIdentity"])
    empty=capture(c,path,"restore-empty.private",scratch)
    require(not any(empty["counts"].values()),"Restore-check database is not empty.")
    root="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/"+scratch
    restored=operation(c,"restore-operation",api(c,root+":importDocuments",method="POST",
        body={"inputUriPrefix":prefix},identity=c["production"]["migrationIdentity"]),scratch)
    sample=capture(c,path,"restore-fingerprint.private",scratch)
    require(sample["counts"]==before["counts"] and sample["sourceHash"]==before["sourceHash"],"Restored migration scope does not match the backup.")
    record(c,"restore",scratchDatabase=scratch,backupOperation=op["name"],restoreOperation=restored["name"],
           sourceHash=before["sourceHash"],counts=sample["counts"],verifiedContent=True,
           scope="declared migration collections; not a full subcollection audit",scratchRetained=True)
    print("Production backup and scratch restore passed. Migration plan requires separate digest approval.")


def verify_backup(c):
    b=read(checkpoint(c,"backup"))
    require(b.get("status")=="SUCCESSFUL" and all(b.get(k)==v for k,v in binding(c).items()) and b.get("configDigest")==digest(c),"Wrong backup evidence.")
    fresh(b.get("completedAt"),"Production backup")
    restored=evidence(c,"restore")
    require(restored.get("verifiedContent") is True and restored["sourceHash"]==b["sourceHash"] and restored["backupOperation"]==b["operation"],"Backup has not been restored and verified.")
    live=api(c,"https://firestore.googleapis.com/v1/"+b["operation"],identity=c["production"]["migrationIdentity"])
    require(live.get("done") and not live.get("error") and live.get("metadata",{}).get("operationState")=="SUCCESSFUL" and live["metadata"].get("outputUriPrefix")==b["outputUriPrefix"],"Backup operation is not successful.")
    return b,restored


def apply_infrastructure(c,path,approve,attestation):
    assert_frozen(c,attestation)
    b,_=verify_backup(c)
    require(capture(c,path)["sourceHash"]==b["sourceHash"],"Production changed since backup.")
    reviewed=evidence(c,"infrastructure-review")
    approval(approve,reviewed["planDigest"])
    saved=workspace(c)/"infrastructure.tfplan"
    require(digest(saved.read_bytes())==approve,"Saved binary plan changed.")
    (ROOT/"infrastructure/imports.generated.tf").write_bytes((workspace(c)/"imports.generated.tf").read_bytes())
    init(c)
    production_plan_guard(tf(c,"show","-json",saved,json_output=True),c)
    tf(c,"apply","-input=false","-lock-timeout=5m",saved)
    manifest=tf(c,"output","-json","stage3_manifest",json_output=True)
    require(manifest["projectId"]==PROJECT and manifest["databaseId"]==DATABASE and manifest["environment"]=="production","Terraform output target mismatch.")
    require(manifest["firebaseConfig"]["appId"]==c["existingFirebaseWebAppId"],"Firebase browser identity changed.")
    save(checkpoint(c,"runtime-manifest"),manifest)
    record(c,"infrastructure-apply",planDigest=approve,runtimeManifestDigest=digest(manifest))


def migrate(c,path,approve,attestation):
    freeze=assert_frozen(c,attestation); b,r=verify_backup(c)
    evidence(c,"infrastructure-apply")
    plan=read(checkpoint(c,"migration-plan")); approval(approve,plan["digest"])
    require(plan["sourceHash"]==b["sourceHash"],"Approved migration differs from backed-up data.")
    permit={"schemaVersion":1,"stage":4,"status":"approved",**binding(c),"createdAt":now(),
            "configFileHash":digest(Path(path).read_bytes()),"approvedDigest":approve,
            "sourceHash":plan["sourceHash"],"backup":b,"restore":r,"freeze":freeze}
    p=workspace(c)/"migration-permit.private.json"; save(p,permit)
    result=migration(c,path,"apply",output="migration-result.private",extra=[
        "--plan",str(checkpoint(c,"migration-plan")),"--approve",approve,"--permit",str(p)])
    record(c,"migration-apply",planDigest=approve,changedDocuments=result["changedDocuments"],
           counts=result["counts"],databaseHash=result["databaseHash"],integrity=result["integrity"])
    repeat=migration(c,path,"repeat",output="repeat-plan.private")
    require(repeat["changes"]==[] and repeat["sourceHash"]==result["databaseHash"],"Migration repeat was not an unchanged zero-write result.")
    record(c,"migration-repeat",changes=0,databaseHash=result["databaseHash"],planDigest=approve)
    print("Production migration committed atomically and repeated with zero writes. Maintenance remains active.")


def candidate(c):
    image=evidence(c,"image"); evidence(c,"migration-repeat")
    manifest=read(checkpoint(c,"runtime-manifest"))
    require(evidence(c,"infrastructure-apply")["runtimeManifestDigest"]==digest(manifest),"Runtime manifest changed after infrastructure apply.")
    require(manifest["documentBucket"]==c["terraform"]["client_documents_bucket_name"],"Document bucket differs from descriptor.")
    require(all(manifest["secretBindings"].get(k)==v for k,v in c["secretBindings"].items()),
            "Secret container names differ from the reviewed Terraform manifest.")
    require(manifest["imageRepository"]==c["production"]["imageRepository"],"Build repository differs from Terraform outputs.")
    require(manifest["runtimeEnvironment"]=={k:v for k,v in runtime_env(c).items() if k not in ("PRODUCTION_RELEASE_ID","PRODUCTION_SOURCE_SHA")},
            "Runtime environment differs from the reviewed infrastructure outputs.")
    require(encryption_fingerprint(secret(c,"ACCESS_DATA_ENCRYPTION_KEY"))==evidence(c,"baseline")["encryptionFingerprint"],"Production encryption key changed.")
    for key in c["secretBindings"]: secret(c,key)  # Validate versions without writing payloads.
    require(image["firebaseConfigDigest"]==digest(c["firebaseConfig"]),"Image has another Firebase browser config.")
    m=evidence(c,"maintenance"); require(traffic(service(c))=={m["revision"]:100},"Production must still be in maintenance.")
    env=workspace(c)/"runtime-env.private.json"; save(env,runtime_env(c))
    bindings=",".join(k+"="+v+":"+str(c["secretVersions"][k]) for k,v in sorted(c["secretBindings"].items()))
    cloud(c,"run","deploy",SERVICE,"--region="+REGION,"--image="+image["image"],
          "--command=node","--args=--import,tsx,server.ts","--env-vars-file="+str(env),
          "--set-secrets="+bindings,"--service-account="+c["terraform"]["runtime_service_account_email"],
          "--no-traffic","--tag=stage4-rc",identity=c["production"]["deployIdentity"])
    live=service(c); revision=live["status"]["latestReadyRevisionName"]
    require(traffic(live)=={m["revision"]:100},"Candidate changed production traffic.")
    tag=next(x for x in live["status"]["traffic"] if x.get("tag")=="stage4-rc" and x.get("revisionName")==revision)
    assert_policy(c)
    require(http(c,tag["url"],"/book")[0]==503,"Unauthenticated users can reach the candidate before acceptance.")
    code,raw=http(c,tag["url"],"/api/release/health",token=secret(c,"PRODUCTION_RELEASE_TOKEN"))
    health=json.loads(raw)
    require(code==200 and health.get("sourceSha")==c["sourceSha"] and health.get("revision")==revision,"Candidate source/revision mismatch.")
    record(c,"candidate",revision=revision,url=tag["url"],image=image["image"],serviceUrl=live["status"]["url"],
        secretVersions={k:{"secretId":v,"version":str(c["secretVersions"][k])} for k,v in c["secretBindings"].items()})


def phase(c,value):
    require(value in ("testing","live","closed"),"Invalid release phase.")
    root="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/"+DATABASE+"/documents/_releaseControl/active"
    existing=api(c,root,optional=True)
    query=("currentDocument.updateTime="+urllib.parse.quote(existing["updateTime"],safe="")) if existing else "currentDocument.exists=false"
    data={"fields":{k:{"stringValue":v} for k,v in
        {"releaseId":c["releaseId"],"sourceSha":c["sourceSha"],"phase":value,"updatedAt":now()}.items()}}
    api(c,root+"?"+query,method="PATCH",body=data,identity=c["production"]["migrationIdentity"])


def probes(c,path,approve):
    d=evidence(c,"candidate"); evidence(c,"migration-repeat")
    approval(approve,"TEST:"+d["revision"])
    phase(c,"testing")
    token=secret(c,"PRODUCTION_RELEASE_TOKEN")
    for route in ("/","/book","/request-document","/client","/tenant","/admin"):
        status,body=http(c,d["url"],route,token=token)
        require(status==200 and b"<html" in body.lower(),"Candidate page check failed.")
    for route in ("/api/client/dashboard","/api/tenant/dashboard","/api/admin/bookings"):
        require(http(c,d["url"],route,token=token)[0] in (401,403),"Application authentication boundary failed.")
    run(["node","--import","tsx","scripts/stage4/integrations.ts","--config",str(path),"--approve",c["projectId"]])
    raw=read(checkpoint(c,"integration-readiness"))
    require(raw.get("status")=="passed" and raw.get("revision")==d["revision"],"Production integration probes did not pass.")
    record(c,"integration-readiness",revision=d["revision"],checks=raw["checks"],details=raw.get("details",{}))
    test=c["bookingTest"]
    env={**os.environ,"E2E_BASE_URL":d["url"],"E2E_ALLOW_LIVE_WRITE":"YES",
      "E2E_PRODUCTION_RELEASE_TOKEN":token,
      "E2E_CLOUD_RUN_ID_TOKEN":cloud(c,"auth","print-identity-token","--audiences="+d["serviceUrl"],"--include-email",
        identity=c["production"]["deployIdentity"],json_output=False),"E2E_STREET_ADDRESS":test["streetAddress"],
      "E2E_SUBURB":test["suburb"],"E2E_POSTCODE":test["postcode"],
      "E2E_TEST_PHONE":test["phone"],"E2E_TEST_EMAIL":c["testEmail"],"E2E_SERVICE_ID":test["serviceId"]}
    result=run(["node","scripts/e2e-booking-smoke.mjs"],env=env,json_output=True)
    require(result.get("success") is True and result.get("finalStatus")=="cancelled" and
        result.get("confirmationEmailStatus")=="sent","Synthetic booking/email/cancellation check failed.")
    record(c,"booking-smoke",revision=d["revision"],checks=result["checks"],bookingReference=result["bookingReference"])


def accept(c,path,receipt):
    d=evidence(c,"candidate")
    require(receipt.get("operatorPrincipal")==c["operatorPrincipal"] and receipt.get("sourceSha")==c["sourceSha"] and
      receipt.get("releaseId")==c["releaseId"] and receipt.get("revision")==d["revision"],
      "Acceptance receipt targets another source/revision/operator.")
    fresh(receipt.get("completedAt"),"Operator acceptance")
    for key in ("clientSignIn","tenantSignIn","adminSignIn","documentDownload","reportRoundTrip"):
        require(receipt.get("checks",{}).get(key)=="passed","Real portal/companion acceptance missing: "+key)
    require(receipt.get("evidenceReference"),"Retain a real acceptance evidence reference.")
    p=workspace(c)/"companion-receipt.private.json"; save(p,receipt["companion"])
    run(["node","--import","tsx","scripts/stage4/record-companion.ts","--config",str(path),"--receipt",str(p)])
    raw=read(checkpoint(c,"report-companion"))
    require(raw.get("status")=="passed" and raw.get("revision")==d["revision"],"Separate companion report is unverified.")
    record(c,"report-companion",revision=d["revision"],details=raw)
    record(c,"operator-acceptance",revision=d["revision"],checks=receipt["checks"],
      evidenceReference=receipt["evidenceReference"],verification="operator-attested",
      priorRevisionCompatible=receipt.get("priorRevisionCompatible") is True,
      rollbackEvidenceReference=receipt.get("rollbackEvidenceReference",""))


def accepted(c):
    d=evidence(c,"candidate")
    for name in ("infrastructure-apply","migration-apply","migration-repeat","integration-readiness",
                 "booking-smoke","report-companion","operator-acceptance"):
        item=evidence(c,name)
        if "revision" in item: require(item["revision"]==d["revision"],"Acceptance revision mismatch: "+name)
    verify_backup(c)
    checks=evidence(c,"integration-readiness")["checks"]
    require(all(checks.get(k)=="passed" for k in ("firestore","indexes","storage","storageSigning","calendar","authentication","emailSubmission","reportIngest","cleanup")),
            "Incomplete production integration acceptance.")
    require(evidence(c,"migration-repeat")["changes"]==0,"Migration repeat proposed writes.")
    return d


def post_release(c):
    d=evidence(c,"candidate")
    require(traffic(service(c))=={d["revision"]:100},"Production is not serving the accepted revision.")
    code,body=http(c,d["serviceUrl"],"/api/health",expected_revision=d["revision"])
    require(code==200 and json.loads(body).get("ok") is True,"Production health failed after traffic promotion.")
    require(http(c,d["serviceUrl"],"/book",expected_revision=d["revision"])[0]==200,"Public booking page failed after promotion.")
    public_code,public_health=http(c,APP_URL,"/api/health",expected_revision=d["revision"])
    require(public_code==200 and json.loads(public_health).get("ok") is True,"Public application domain failed after promotion.")
    assert_policy(c)
    record(c,"post-release",revision=d["revision"],checks={"health":"passed","publicBooking":"passed","traffic":"passed"})


def promote(c,approve):
    d=accepted(c); approval(approve,"PROMOTE:"+d["revision"])
    m=evidence(c,"maintenance")
    require(traffic(service(c))=={m["revision"]:100},"Unexpected traffic before promotion.")
    assert_policy(c)
    cloud(c,"run","services","update-traffic",SERVICE,"--region="+REGION,
        "--to-revisions="+d["revision"]+"=100",identity=c["production"]["deployIdentity"])
    phase(c,"live")
    record(c,"promotion",revision=d["revision"])
    try: post_release(c)
    except Exception:
        # The old application might not understand migrated data. Fail to maintenance, not data loss.
        phase(c,"closed")
        cloud(c,"run","services","update-traffic",SERVICE,"--region="+REGION,
            "--to-revisions="+m["revision"]+"=100",identity=c["production"]["deployIdentity"])
        record(c,"promotion",status="failed",revision=d["revision"],fallback="maintenance")
        raise
    print("Production traffic moved to the accepted revision and post-release checks passed.")


def contain(c,approve):
    d=evidence(c,"candidate"); approval(approve,"CONTAIN:"+d["revision"])
    m=evidence(c,"maintenance")
    require(traffic(service(c)) in ({d["revision"]:100},{m["revision"]:100}),"Refusing to overwrite unrelated production traffic.")
    phase(c,"closed")
    cloud(c,"run","services","update-traffic",SERVICE,"--region="+REGION,
      "--to-revisions="+m["revision"]+"=100",identity=c["production"]["deployIdentity"])
    record(c,"rollback",containment="maintenance",dataRestored=False)


def rollback(c,approve):
    d=evidence(c,"candidate"); approval(approve,"ROLLBACK:"+d["revision"])
    base=evidence(c,"baseline"); accepted_by=evidence(c,"operator-acceptance")
    require(accepted_by.get("priorRevisionCompatible") is True and accepted_by.get("rollbackEvidenceReference"),
      "Traffic rollback requires evidence that the prior application can read migrated data. Use maintenance for containment otherwise.")
    require(traffic(service(c))=={d["revision"]:100},"Rollback refuses unrelated production traffic.")
    phase(c,"closed")
    cloud(c,"run","services","update-traffic",SERVICE,"--region="+REGION,
      "--to-revisions="+",".join(k+"="+str(v) for k,v in base["allocation"].items()),
      identity=c["production"]["deployIdentity"])
    require(traffic(service(c))==base["allocation"],"Prior traffic allocation was not restored.")
    record(c,"rollback",priorTraffic=base["allocation"],dataRestored=False)


def close(c):
    d=accepted(c); evidence(c,"promotion"); evidence(c,"post-release")
    require(traffic(service(c))=={d["revision"]:100},"Live revision changed before closure.")
    record(c,"stage4-acceptance",revision=d["revision"],image=d["image"],
      skipStaging=True,productionVerified=True,mainMerged=False,
      note="Main finalization is a separate exact-tree reviewed merge after this receipt.")


def execute(args):
    if args.action=="validate":
        config(args.config); print("Production descriptor validated."); return
    c=config(args.config); verify_ci(c["sourceSha"])
    validate_environment(github("/environments/production"),github("/environments/production/deployment-branch-policies"))
    attestation=read(args.receipt) if args.receipt else {}
    with session(c):
        if args.action=="plan": plan(c)
        elif args.action=="build": build(c)
        elif args.action=="maintenance": maintenance(c,args.approve)
        elif args.action=="backup": backup(c,args.config,attestation)
        elif args.action=="infrastructure-apply": apply_infrastructure(c,args.config,args.approve,attestation)
        elif args.action=="migration-apply": migrate(c,args.config,args.approve,attestation)
        elif args.action=="candidate": candidate(c)
        elif args.action=="probe": probes(c,args.config,args.approve)
        elif args.action=="accept": accept(c,args.config,attestation)
        elif args.action=="promote": promote(c,args.approve)
        elif args.action=="rollback": rollback(c,args.approve)
        elif args.action=="contain": contain(c,args.approve)
        elif args.action=="post-release": post_release(c)
        elif args.action=="close": close(c)
        else: raise ValueError("Unknown production operation.")
        # Only hashes/identifiers reach the public job summary, never plans or data.
        lines=["Stage 4 action: "+args.action,"Source: "+c["sourceSha"]]
        for name,key in (("infrastructure-review","planDigest"),("migration-plan","digest"),("candidate","revision")):
            p=checkpoint(c,name)
            if p.exists(): lines.append(name+": "+str(read(p).get(key,"")))
        print("\n".join(lines))
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"],"a") as output: output.write("\n\n".join(lines)+"\n")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["validate","plan","build","maintenance","backup","infrastructure-apply",
        "migration-apply","candidate","probe","accept","promote","rollback","contain","post-release","close"])
    parser.add_argument("--config",required=True); parser.add_argument("--approve",default="")
    parser.add_argument("--receipt")
    try: execute(parser.parse_args())
    except Exception as error:
        # SDK exceptions can include secret headers; only our deliberate policy errors are emitted.
        print("STAGE 4 BLOCKED: "+(str(error) if isinstance(error,ValueError) else type(error).__name__+
            "; inspect the private checkpoint/operation ID."),file=sys.stderr)
        sys.exit(1)
