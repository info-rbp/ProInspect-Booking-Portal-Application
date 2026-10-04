"""Private, checksummed checkpoints with a cross-run GCS generation lock.
Never sync Terraform caches, credentials, logs, descriptors or arbitrary files.
"""
from __future__ import annotations
from contextlib import contextmanager
import json
from pathlib import Path
import re
import urllib.parse
import uuid
from common import api, cloud, digest, now, private_bucket, require, save, workspace, binding

ALLOWED = {
    "inventory.json","baseline.json","infrastructure.tfplan","infrastructure-plan.json",
    "infrastructure-review.json","imports.generated.tf","infrastructure-apply.json",
    "runtime-manifest.json","image.json","maintenance.json","freeze.json",
    "migration-plan.json","backup.json","export-operation.json","restore-operation.json",
    "restore.json","migration-apply.json","migration-repeat.json","candidate.json",
    "integration-readiness.json","booking-smoke.json","report-companion.json",
    "operator-acceptance.json","promotion.json","post-release.json","rollback.json",
    "stage4-acceptance.json","pre-infrastructure-capture.json",
}
def object_url(bucket,name):
    return "https://storage.googleapis.com/storage/v1/b/"+bucket+"/o/"+urllib.parse.quote(name,safe="")


@contextmanager
def session(c):
    bucket=c["production"]["evidenceBucket"]
    private_bucket(c,bucket)
    prefix="stage4/"+c["releaseId"]+"/"+c["sourceSha"]
    lock_name="stage4/locks/"+c["databaseId"]+".json"
    out=workspace(c)
    owner=uuid.uuid4().hex
    lock=out/"lease.private.json"
    save(lock,{"owner":owner,**binding(c),"startedAt":now()})
    cloud(c,"storage","cp",str(lock),"gs://"+bucket+"/"+lock_name,
          "--if-generation-match=0",json_output=False)
    metadata=api(c,object_url(bucket,lock_name))
    generation=metadata["generation"]
    require(api(c,object_url(bucket,lock_name)+"?alt=media").get("owner")==owner,"Production lock ownership changed.")
    manifest_name=prefix+"/manifest.json"
    old=api(c,object_url(bucket,manifest_name),optional=True)
    previous_generation=old["generation"] if old else "0"
    hydrated=False
    try:
        if old:
            manifest=api(c,object_url(bucket,manifest_name)+"?alt=media")
            require(manifest.get("binding")==binding(c) and manifest.get("configDigest")==digest(c),"Checkpoint belongs to another production target/config/source.")
            for name,item in manifest.get("files",{}).items():
                require(name in ALLOWED and re.fullmatch(r"[a-f0-9]{64}",item.get("sha256","")),"Invalid checkpoint filename/hash.")
                require(item.get("object","").startswith(prefix+"/runs/") and ".." not in item["object"],"Checkpoint object escaped release scope.")
                cloud(c,"storage","cp","gs://"+bucket+"/"+item["object"],str(out/name),json_output=False)
                require(digest((out/name).read_bytes())==item["sha256"],"Checkpoint was corrupted or changed: "+name)
        hydrated=True
        yield
    finally:
        if not hydrated:
            api(c,object_url(bucket,lock_name)+"?ifGenerationMatch="+str(generation),method="DELETE")
            raise ValueError("Private checkpoint restoration failed; nothing was overwritten.")
        # Failed operations still retain their operation IDs and truthful status.
        # A persistence failure leaves the lock in place, rather than silently losing evidence.
        files={}
        run_id=uuid.uuid4().hex
        for name in sorted(ALLOWED):
            path=out/name
            if not path.exists(): continue
            require(path.is_file() and not path.is_symlink(),"Unsafe checkpoint.")
            remote=prefix+"/runs/"+run_id+"/"+name
            cloud(c,"storage","cp",str(path),"gs://"+bucket+"/"+remote,
                  "--if-generation-match=0",json_output=False)
            files[name]={"object":remote,"sha256":digest(path.read_bytes())}
        local=out/"checkpoint-manifest.private.json"
        save(local,{"schemaVersion":1,"binding":binding(c),"configDigest":digest(c),"files":files,"savedAt":now()})
        cloud(c,"storage","cp",str(local),"gs://"+bucket+"/"+manifest_name,
              "--if-generation-match="+str(previous_generation),json_output=False)
        api(c,object_url(bucket,lock_name)+"?ifGenerationMatch="+str(generation),method="DELETE")
        lock.unlink(missing_ok=True)
