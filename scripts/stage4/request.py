"""Validate a production request without accessing any Google credential."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from common import REPOSITORY, require, github, validate_environment

ACTIONS={"disabled","readiness","plan","build","maintenance","backup","infrastructure-apply",
         "migration-apply","candidate","probe","accept","promote","rollback","post-release","close","contain"}

def validate_request(request):
    require(request.get("schemaVersion")==1 and request.get("action") in ACTIONS,"Invalid production request action/schema.")
    require(re.fullmatch(r"[a-f0-9]{40}",request.get("sourceSha","")),"Select an exact source SHA.")
    require(re.fullmatch(r"[a-z][a-z0-9-]{2,48}",request.get("releaseId","")),"Invalid release ID.")
    require(isinstance(request.get("approve",""),str) and re.fullmatch(r"[A-Za-z0-9:_-]{0,200}",request.get("approve","")),"Invalid approval value.")
    require(set(request)<= {"schemaVersion","action","sourceSha","releaseId","approve","note"},"Do not put credentials or unknown settings in the request.")
    return request

def main():
    require(os.environ.get("GITHUB_REPOSITORY")==REPOSITORY,"Wrong repository.")
    require(os.environ.get("GITHUB_REF") in ("refs/heads/main","refs/heads/release/platform-unification"),"Only the release/main branches can request production operations.")
    request=validate_request(json.loads(Path("ops/stage4-production-request.json").read_text()))
    subprocess.run(["git","cat-file","-e",request["sourceSha"]+"^{commit}"],check=True)
    subprocess.run(["git","merge-base","--is-ancestor",request["sourceSha"],"HEAD"],check=True)
    # Checking an environment does not create it. A marker variable is insufficient.
    if request["action"]!="disabled":
        validate_environment(github("/environments/production"),
                             github("/environments/production/deployment-branch-policies"))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a") as f:
            for key in ("action","sourceSha","releaseId","approve"): f.write(key+"="+request.get(key,"")+"\n")
    print("Production request validated; no Google Cloud resources were changed.")

if __name__=="__main__":
    try: main()
    except Exception as error:
        print("STAGE 4 READINESS BLOCKED: "+str(error),file=sys.stderr)
        sys.exit(1)
