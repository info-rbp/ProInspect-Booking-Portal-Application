"""Production-only release policy. Stage 3's production-write lock is unchanged."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/stage3"))
import control as stage3

PROJECT = stage3.PRODUCTION_PROJECT
DATABASE = stage3.PRODUCTION_DATABASE
REPOSITORY = stage3.REPO
BASELINE = "6a55131f5890b82047d8b78d2af2bdc6f140041f"
SERVICE = "proinspect-booking-portal-application"
REGION = "europe-west1"
APP_URL = "https://bookings.proinspect.systems"
require = stage3.require
read = stage3.read
save = stage3.save
digest = stage3.digest
now = stage3.now
fresh = stage3.fresh
sha = stage3.sha
run = stage3.run


def validate(c, placeholders=False):
    stage3.validate_config(c, allow_placeholders=placeholders)
    require(c["environment"] == "production" and c["projectId"] == PROJECT and
            c["databaseId"] == DATABASE, "Stage 4 requires the exact frozen production target.")
    t = c["terraform"]
    require(t["region"] == REGION and t["cloud_run_service_name"] == SERVICE and
            t["app_url"] == APP_URL, "Production region/service/origin differs from baseline.")
    require(c.get("skipStaging") is True, "Record the explicit decision to skip portal staging.")
    require(t.get("staging_email_recipient", "") == "", "A staging email sink cannot be deployed to production.")
    require(c.get("existingFirebaseWebAppId"), "Select the existing Firebase browser app; never create a replacement by guessing.")
    require(re.fullmatch(r"[a-z][a-z0-9-]{2,48}", c.get("releaseId", "")), "Invalid release ID.")
    require(re.fullmatch(r"[a-f0-9]{40}", c.get("sourceSha", "")), "An exact source SHA is required.")
    require(c.get("stateOwnershipReviewed") is True or placeholders, "Review actual production state ownership before execution.")
    p = c.get("production", {})
    for key in ("buildIdentity", "deployIdentity", "migrationIdentity"):
        require(str(p.get(key, "")).endswith("@" + PROJECT + ".iam.gserviceaccount.com"), "Missing in-project identity: " + key)
    for identity in [p["buildIdentity"],p["deployIdentity"],p["migrationIdentity"],t["runtime_service_account_email"],t["terraform_service_account_email"]]:
        require(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]",identity.split("@")[0]),"Service-account IDs must be 6-30 valid characters.")
    require(len({p["buildIdentity"],p["deployIdentity"],p["migrationIdentity"],t["runtime_service_account_email"],t["terraform_service_account_email"]}) == 5, "Separate build, deployment, migration, runtime and Terraform identities are required.")
    require(re.fullmatch(REGION + r"-docker\.pkg\.dev/" + PROJECT + r"/[a-z0-9-]+/platform", p.get("imageRepository","")), "Image repository must be in the selected production project/region.")
    for key in ("evidenceBucket", "backupBucket", "buildSourceBucket"):
        require(re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]",p.get(key,"")), "Invalid bucket: " + key)
    for key in ("ACCESS_DATA_ENCRYPTION_KEY","RESEND_API_KEY","REPORT_HANDOFF_SIGNING_KEY","REPORT_INGEST_TOKEN","PRODUCTION_RELEASE_TOKEN"):
        require(key in c.get("secretBindings",{}) and key in c.get("secretVersions",{}), "Missing required secret binding/version: " + key)
    for key, sid in c.get("secretBindings",{}).items():
        require(re.fullmatch(r"[A-Z][A-Z0-9_]*",key) and re.fullmatch(r"[a-zA-Z0-9_-]{1,255}",sid), "Invalid secret binding.")
        require(placeholders or re.fullmatch(r"[1-9][0-9]*",str(c.get("secretVersions",{}).get(key,""))), "Use numeric, enabled Secret Manager versions, not latest.")
    require(c.get("firebaseConfig",{}).get("projectId") == PROJECT and
            c["firebaseConfig"].get("appId") == c["existingFirebaseWebAppId"] and
            c["firebaseConfig"].get("firestoreDatabaseId") == DATABASE, "Production browser Firebase target mismatch.")
    require(placeholders or ("REQUIRED_" not in json.dumps(c) and "CHANGE_ME" not in json.dumps(c)), "Complete the production descriptor; unresolved values block execution.")
    return c


def config(path):
    c = validate(read(path))
    stage3.ensure_clean()
    require(sha() == c["sourceSha"], "Source changed; no production action is permitted.")
    run(["git","merge-base","--is-ancestor",BASELINE,"HEAD"])
    return c


def workspace(c):
    p = ROOT / "private-evidence/stage4" / c["releaseId"] / c["sourceSha"]
    p.mkdir(parents=True, exist_ok=True)
    return p


def binding(c):
    return {k:c[k] for k in ("environment","projectId","databaseId","releaseId","sourceSha")}


def record(c, name, **fields):
    value = {"schemaVersion":1,"status":"passed",**binding(c),"configDigest":digest(c),
             "completedAt":now(),**fields}
    save(workspace(c)/(name+".json"),value)
    return value


def evidence(c, name, hours=24):
    x = read(workspace(c)/(name+".json"))
    require(x.get("schemaVersion")==1 and x.get("status")=="passed" and x.get("synthetic") is not True, "Missing successful production evidence: "+name)
    require(all(x.get(k)==v for k,v in binding(c).items()) and x.get("configDigest")==digest(c), "Production evidence target/source/config mismatch: "+name)
    fresh(x.get("completedAt"),name,hours=hours)
    return x


def cloud(c, *args, identity=None, json_output=True, data=None):
    identity = identity or c["terraform"]["terraform_service_account_email"]
    return run(["gcloud",*args,"--project="+PROJECT,"--impersonate-service-account="+identity,
                "--quiet",*(["--format=json"] if json_output else [])],json_output=json_output,data=data)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(c,url,*,method="GET",body=None,identity=None,optional=False):
    require(urllib.parse.urlparse(url).hostname in {
        "firestore.googleapis.com","firebase.googleapis.com","identitytoolkit.googleapis.com",
        "iam.googleapis.com","firebaserules.googleapis.com","storage.googleapis.com",
        "cloudresourcemanager.googleapis.com"}, "Unexpected authenticated API destination.")
    token = cloud(c,"auth","print-access-token",identity=identity,json_output=False)
    req=urllib.request.Request(url,method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=90) as response:
            raw=response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        if optional and error.code == 404: return None
        raise RuntimeError("Authenticated API failed with HTTP "+str(error.code)+". Details withheld.") from None


def github(path):
    require(path.startswith("/"),"Invalid GitHub API path.")
    headers={"Accept":"application/vnd.github+json","User-Agent":"ProInspect-Stage4"}
    if os.environ.get("GITHUB_TOKEN"): headers["Authorization"]="Bearer "+os.environ["GITHUB_TOKEN"]
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(
            "https://api.github.com/repos/"+REPOSITORY+path,headers=headers),timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("GitHub policy lookup failed: HTTP "+str(error.code)) from None


def verify_ci(source):
    runs = github("/actions/runs?head_sha="+source+"&per_page=100")["workflow_runs"]
    ok=[r for r in runs if r.get("head_sha")==source and r.get("path")==".github/workflows/verify.yml" and r.get("name")=="Verify booking portal" and r.get("status")=="completed" and r.get("conclusion")=="success" and r.get("event") in ("push","workflow_dispatch")]
    require(ok,"The exact production source has not passed permanent CI.")
    return ok[0]["id"]


def validate_environment(data, policies):
    rules=data.get("protection_rules",[])
    require(any(r.get("type")=="required_reviewers" and r.get("reviewers") for r in rules),
            "Production must have a required reviewer; a marker variable alone is not protection.")
    require(data.get("deployment_branch_policy",{}).get("custom_branch_policies") is True,
            "Production needs explicit branch policies.")
    allowed={p.get("name") for p in policies.get("branch_policies",[]) if p.get("type","branch")=="branch"}
    require(allowed and allowed <= {"main","release/platform-unification"} and
            len(allowed)==len(policies.get("branch_policies",[])), "Production deployment branch allowlist is unsafe.")


def approval(actual, expected):
    require(actual == expected,"Approval must match the exact operation digest, revision or release.")


def traffic(service):
    result={}
    for item in service.get("status",{}).get("traffic",[]):
        if item.get("percent",0):
            require(item.get("revisionName"),"Traffic must resolve to immutable revisions.")
            result[item["revisionName"]]=result.get(item["revisionName"],0)+item["percent"]
    require(sum(result.values())==100,"No complete production traffic allocation.")
    return result


def service(c):
    return cloud(c,"run","services","describe",SERVICE,"--region="+REGION,identity=c["production"]["deployIdentity"])


def private_bucket(c,name):
    b=api(c,"https://storage.googleapis.com/storage/v1/b/"+name)
    require(str(b.get("projectNumber"))==str(c["firebaseConfig"]["messagingSenderId"]), "Bucket belongs to another project.")
    iam=b.get("iamConfiguration",{})
    require(iam.get("uniformBucketLevelAccess",{}).get("enabled") is True and
            iam.get("publicAccessPrevention")=="enforced" and b.get("versioning",{}).get("enabled") is True,
            "Evidence/backup/state buckets must be private, uniform-access and versioned.")
    return b
