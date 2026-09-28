#!/usr/bin/env python3
"""Managed staging export, atomic migration and scratch-database restore rehearsal.

No production writes. Restore never imports over the application database.
The full database is exported; fingerprints cover the declared migration scope.
"""
from __future__ import annotations
import argparse
import time
import uuid
from pathlib import Path
from control import ROOT, api, cloud, fresh, load_config, now, read, require, run, save, sha, workspace, validate_evidence, ensure_clean


def migration(config, *args, database=None):
    identity='proinspect-staging-migration@'+config['projectId']+'.iam.gserviceaccount.com'
    return run(['node','--import','tsx','scripts/migrate-unified-portal.ts',
        '--environment','staging','--project',config['projectId'],
        '--database',database or config['databaseId'],'--impersonate',identity,*args])


def capture(config, name, database=None):
    path=workspace(config)/(name+'.json')
    migration(config,'--capture','--evidence',str(path),database=database)
    return read(path)


def wait_operation(config, operation, expected_database):
    name=operation.get('name','')
    require(name.startswith('projects/'+config['projectId']+'/databases/'+expected_database+'/operations/'),'Unexpected managed operation target.')
    deadline=time.monotonic()+1800
    while not operation.get('done'):
        require(time.monotonic()<deadline,'Managed operation still running after timeout. Retain its name; do not retry blindly.')
        time.sleep(3)
        operation=api(config,'https://firestore.googleapis.com/v1/'+name)
    require(not operation.get('error') and operation.get('metadata',{}).get('operationState')=='SUCCESSFUL','Managed operation failed; no acceptance evidence issued.')
    return operation


def backup(config, approval):
    require(approval==config['projectId'],'Backup requires --approve <staging-project>.')
    out=workspace(config); plan=read(out/'migration-plan.json')
    require(plan['sourceSha']==sha() and plan['target']=={k:config[k] for k in ('environment','projectId','databaseId')},'Generate an exact-source staging dry run before backup.')
    fresh(plan['createdAt'],'Migration plan')
    before=capture(config,'backup-before')
    require(before['databaseHash']==plan['sourceHash'],'Data changed since the approved dry run.')
    manifest=read(out/'runtime-manifest.json')
    prefix='gs://'+manifest['buckets']['migration-backups']+'/'+sha()+'/'+uuid.uuid4().hex
    url='https://firestore.googleapis.com/v1/projects/'+config['projectId']+'/databases/'+config['databaseId']+':exportDocuments'
    operation=wait_operation(config,api(config,url,method='POST',body={'outputUriPrefix':prefix}),config['databaseId'])
    require(operation['metadata'].get('outputUriPrefix')==prefix,'Export completed at an unexpected destination.')
    after=capture(config,'backup-after')
    require(before['databaseHash']==after['databaseHash'],'Writes occurred during export. Quiesce staging writers and repeat the dry run and backup.')
    record={'schemaVersion':1,'status':'SUCCESSFUL',**{k:config[k] for k in ('environment','projectId','databaseId')},'sourceSha':sha(),'operation':operation['name'],'outputUriPrefix':prefix,'sourceHash':before['databaseHash'],'counts':before['counts'],'completedAt':now()}
    save(out/'backup.json',record)
    print('Managed staging export completed and fingerprint matched the dry-run source.')


def restore_check(config, approval):
    require(approval==config['projectId'],'Restore rehearsal requires --approve <staging-project>.')
    out=workspace(config); backup=read(out/'backup.json')
    require(backup['projectId']==config['projectId'] and backup['databaseId']==config['databaseId'] and backup['sourceSha']==sha(),'Backup belongs to a different source or target.')
    fresh(backup['completedAt'],'Backup')
    source_operation=api(config,'https://firestore.googleapis.com/v1/'+backup['operation'])
    require(source_operation.get('done') and not source_operation.get('error') and source_operation.get('metadata',{}).get('operationState')=='SUCCESSFUL' and source_operation['metadata'].get('outputUriPrefix')==backup['outputUriPrefix'],'Backup operation is not successfully completed.')
    # A new random scratch name avoids both destructive overwrite and accidental reuse.
    scratch='stage3-restore-'+uuid.uuid4().hex[:16]
    cloud(config,'firestore','databases','create','--database='+scratch,'--location='+config['terraform']['firestore_location'],'--type=firestore-native')
    record={'schemaVersion':1,'status':'running',**{k:config[k] for k in ('environment','projectId','databaseId')},'sourceSha':sha(),'scratchDatabaseId':scratch,'backupOperation':backup['operation'],'startedAt':now()}
    save(out/'migration-restore.json',record)
    before=capture(config,'restore-empty',database=scratch)
    require(not any(before['counts'].values()),'Scratch database was not empty; refusing import.')
    url='https://firestore.googleapis.com/v1/projects/'+config['projectId']+'/databases/'+scratch+':importDocuments'
    operation=wait_operation(config,api(config,url,method='POST',body={'inputUriPrefix':backup['outputUriPrefix']}),scratch)
    restored=capture(config,'restore-fingerprint',database=scratch)
    require(restored['databaseHash']==backup['sourceHash'] and restored['counts']==backup['counts'],'Restored content/counts differ from the exported migration scope.')
    record.update(status='passed',completedAt=now(),restoreOperation=operation['name'],verifiedContent=True,counts=restored['counts'],databaseHash=restored['databaseHash'],scope='declared migration collections',scratchRetained=True)
    save(out/'migration-restore.json',record)
    print('Scratch restore verified. Database retained for inspection: '+scratch)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['dry-run','backup','apply','repeat','restore-check'])
    parser.add_argument('--config',required=True); parser.add_argument('--approve')
    args=parser.parse_args(); config=load_config(args.config,mutate=True)
    ensure_clean()
    config['_identity']='proinspect-staging-migration@'+config['projectId']+'.iam.gserviceaccount.com'
    out=workspace(config)
    if args.command=='backup': return backup(config,args.approve)
    if args.command=='restore-check': return restore_check(config,args.approve)
    if args.command=='apply':
        require(args.approve,'Apply requires the dry-run plan digest, not a blanket confirmation.')
        restored=validate_evidence(read(out/'migration-restore.json'),config,'migration-restore')
        backup_record=read(out/'backup.json')
        require(restored.get('verifiedContent') is True and restored.get('backupOperation')==backup_record.get('operation') and restored.get('databaseHash')==backup_record.get('sourceHash'),'Restore must verify the exact current backup before apply.')
        migration(config,'--apply','--plan',str(out/'migration-plan.json'),'--approve',args.approve,'--backup-evidence',str(out/'backup.json'),'--evidence',str(out/'migration-apply.json'))
        print('Approved migration applied atomically. Run repeat before starting application traffic.')
        return
    repeat=args.command=='repeat'
    suffix='migration-repeat' if repeat else 'migration-dry'
    path=out/('migration-repeat-plan.json' if repeat else 'migration-plan.json')
    migration(config,'--plan',str(path),'--evidence',str(out/(suffix+'.json')))
    result=read(out/(suffix+'.json'))
    if repeat:
        require(result['changes']==0,'Repeat run proposed mutations; staging migration is not accepted.')
        applied=validate_evidence(read(out/'migration-apply.json'),config,'migration-apply')
        require(applied['databaseHash']==result['sourceHash'],'Data changed after apply; repeat evidence cannot certify the same dataset.')
    print('Dry run passed. Proposed writes: '+str(result['changes']))

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,OSError,KeyError) as error:
        raise SystemExit('MIGRATION REHEARSAL BLOCKED: '+str(error))
