"""Offline control-plane regressions. No cloud credentials or network calls."""
import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.parse
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import control as c
import deploy
import rehearse

SOURCE='a'*40

def config():
    result=json.loads((c.ROOT/'infrastructure/environments/staging.example.json').read_text())
    def fill(value):
        if isinstance(value,dict): return {k:fill(v) for k,v in value.items()}
        if isinstance(value,list): return [fill(v) for v in value]
        if isinstance(value,str) and 'REQUIRED_' in value:
            if value.startswith('https:'): return 'https://qa.example.test'
            if value.startswith('user:'): return 'user:qa@example.test'
            return 'qa@example.test'
        return value
    result=fill(result)
    result['secretVersions']={k:'1' for k in result['secretVersions']}
    result['googleSignInSecret']['version']='1'
    return result

def evidence(cfg,**values):
    return {'schemaVersion':1,'status':'passed',**{k:cfg[k] for k in ('projectId','databaseId','environment')},'sourceSha':SOURCE,'completedAt':c.now(),**values}

def resource(kind,after=None,actions=None):
    return {'resource_changes':[{'address':kind+'.example','mode':'managed','type':kind,'change':{'actions':actions or ['create'],'after':after or {}}}]}

class Controls(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict('os.environ',{},clear=True); self.env.start()
        self.source=patch.object(c,'sha',return_value=SOURCE); self.source.start()
        self.cfg=config()
    def tearDown(self):
        self.source.stop(); self.env.stop()
    def test_valid_target(self):
        c.validate_config(self.cfg,mutate=True)
    def test_production_cannot_be_staging(self):
        self.cfg['projectId']=c.PRODUCTION_PROJECT
        self.cfg['terraform']['project_id']=c.PRODUCTION_PROJECT
        with self.assertRaises(ValueError): c.validate_config(self.cfg,mutate=True)
    def test_explicit_config_required(self):
        with self.assertRaises(ValueError): c.load_config(None)
    def test_mismatched_sink_rejected(self):
        self.cfg['testEmail']='different@example.test'
        with self.assertRaises(ValueError): c.validate_config(self.cfg)
    def test_manifest_identity_mismatch(self):
        self.cfg['terraform']['runtime_service_account_email']='bad@other-project.iam.gserviceaccount.com'
        with self.assertRaises(ValueError): c.validate_config(self.cfg)
    def test_placeholders_cannot_be_applied(self):
        self.cfg['terraform']['app_url']='https://REQUIRED_HOST'
        with self.assertRaises(ValueError): c.validate_config(self.cfg)
    def test_private_workspace_separates_databases(self):
        with tempfile.TemporaryDirectory() as root,patch.object(c,'ROOT',Path(root)):
            first=c.workspace(self.cfg)
            self.cfg['databaseId']='another'
            self.assertNotEqual(first,c.workspace(self.cfg))
    def test_identity_is_not_descriptor_digest(self):
        self.assertEqual(c.config_digest(self.cfg),c.config_digest({**self.cfg,'_identity':'internal'}))
    def test_freshness_rejects_bad_naive_future_and_old_times(self):
        for value in ['bad',None,'2026-01-01', (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).isoformat(),(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2)).isoformat()]:
            with self.subTest(value=value),self.assertRaises(ValueError): c.fresh(value,'test')
    def test_evidence_exact_target_source_success_required(self):
        good=evidence(self.cfg); c.validate_evidence(good,self.cfg,'test')
        for change in [{'status':'running'},{'databaseId':'other'},{'sourceSha':'b'*40},{'synthetic':True},{'completedAt':'bad'}]:
            with self.subTest(change=change),self.assertRaises(ValueError): c.validate_evidence({**good,**change},self.cfg,'test')
    def test_public_iam_variants_rejected(self):
        for after in [{'member':'allUsers'},{'members':['allAuthenticatedUsers']},{'policy_data':json.dumps({'bindings':[{'members':['allUsers']} ]})}]:
            with self.subTest(after=after),self.assertRaises(ValueError): c.guard_plan(resource('google_project_iam_member',after),self.cfg)
    def test_cloud_run_ownership_rejected(self):
        for kind in ['google_cloud_run_service','google_cloud_run_v2_service']:
            with self.assertRaises(ValueError): c.guard_plan(resource(kind),self.cfg)
    def test_secret_payload_state_rejected(self):
        with self.assertRaises(ValueError): c.guard_plan(resource('google_secret_manager_secret_version'),self.cfg)
    def test_cross_project_resource_rejected(self):
        with self.assertRaises(ValueError): c.guard_plan(resource('google_service_account',{'project':'another-project'}),self.cfg)
    def test_stateful_deletion_never_allowlisted(self):
        self.cfg['approvedEphemeralReplacements']=['google_storage_bucket.example']
        with self.assertRaises(ValueError): c.guard_plan(resource('google_storage_bucket',{},['delete','create']),self.cfg)
    def test_private_bucket_no_force_destroy(self):
        value={'public_access_prevention':'enforced','uniform_bucket_level_access':True,'force_destroy':False}
        c.guard_plan(resource('google_storage_bucket',value),self.cfg)
        with self.assertRaises(ValueError): c.guard_plan(resource('google_storage_bucket',{**value,'force_destroy':True}),self.cfg)
    def test_unprotected_database_rejected(self):
        with self.assertRaises(ValueError): c.guard_plan(resource('google_firestore_database',{'delete_protection_state':'DELETE_PROTECTION_DISABLED'}),self.cfg)
    def test_pagination_cannot_silently_truncate(self):
        with patch.object(c,'api',side_effect=[{'indexes':[1],'nextPageToken':'next'},{'indexes':[2]}]) as mocked:
            self.assertEqual(c.api_list(self.cfg,'https://firestore.googleapis.com/x','indexes'),[1,2])
            self.assertIn('pageToken=next',mocked.call_args[0][1])
        with patch.object(c,'api',return_value={'indexes':[],'nextPageToken':'repeat'}),self.assertRaises(ValueError): c.api_list(self.cfg,'https://firestore.googleapis.com/x','indexes')
    def test_firestore_field_override_inventory_uses_required_filters(self):
        project=self.cfg['projectId']
        database=self.cfg['databaseId']
        cloud_values={
            'project': {'projectNumber':'123'},
            'services': [],
            'buckets': [],
            'accounts': [],
            'secrets': [],
            'databases': [{'name':f'projects/{project}/databases/{database}'}],
            'repositories': [],
            'cloudRun': [],
        }
        def fake_cloud(_config,*args,**_kwargs):
            key={
                ('projects','describe',project):'project',
                ('services','list','--enabled'):'services',
                ('storage','buckets','list'):'buckets',
                ('iam','service-accounts','list'):'accounts',
                ('secrets','list'):'secrets',
                ('firestore','databases','list'):'databases',
                ('artifacts','repositories','list','--location='+self.cfg['terraform']['region']):'repositories',
                ('run','services','list','--region='+self.cfg['terraform']['region']):'cloudRun',
            }[args]
            return cloud_values[key]
        seen=[]
        def fake_api_list(_config,url,field,optional=False):
            seen.append((url,field))
            return []
        with tempfile.TemporaryDirectory() as root,patch.object(c,'ROOT',Path(root)),patch.object(c,'cloud',side_effect=fake_cloud),patch.object(c,'api_list',side_effect=fake_api_list),patch.object(c,'api',return_value=None):
            c.inventory(self.cfg)
        field_urls=[url for url,field in seen if field=='fields']
        self.assertEqual(len(field_urls),2)
        decoded=[urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('filter',[''])[0] for url in field_urls]
        self.assertCountEqual(decoded,['indexConfig.usesAncestorConfig:false','ttlConfig:*'])

    def test_existing_objects_are_imported_not_recreated(self):
        p=self.cfg['projectId']; e='staging'
        inv={'services':[],'project':{'projectNumber':'123'},'accounts':[],'buckets':[{'name':self.cfg['terraform']['client_documents_bucket_name']}],'secrets':[{'name':f'projects/{p}/secrets/proinspect-staging-access-data-encryption-key'}],'databases':[{'name':f'projects/{p}/databases/'+self.cfg['databaseId']}],'repositories':[],'webApps':[],'backupSchedules':[],'indexes':[]}
        imported=c.adoption_imports(self.cfg,inv,set())
        self.assertIn('google_storage_bucket.client_documents',imported)
        self.assertIn('google_secret_manager_secret.runtime["access_data_encryption_key"]',imported)
        self.assertNotIn('google_storage_bucket.client_documents',c.adoption_imports(self.cfg,inv,{'google_storage_bucket.client_documents'}))
    def test_firebase_rules_adoption_imports_release_only(self):
        inv={
            'services':[],
            'project':{'projectNumber':'696236368989'},
            'accounts':[],
            'buckets':[],
            'secrets':[],
            'databases':[],
            'repositories':[],
            'webApps':[],
            'backupSchedules':[],
            'indexes':[],
            'rulesRelease':{
                'name':'projects/example-project/releases/cloud.firestore/example-db',
                'rulesetName':'projects/example-project/rulesets/ruleset-123',
            },
        }
        imported=c.adoption_imports(self.cfg,inv,set())
        self.assertNotIn('google_firebaserules_ruleset.firestore',imported)
        self.assertEqual(
            imported['google_firebaserules_release.firestore'],
            'projects/example-project/releases/cloud.firestore/example-db',
        )

    def test_wif_adoption_normalizes_imports_to_configured_project_id(self):
        project=self.cfg['projectId']
        self.cfg['terraform']['workload_identity_pool_id']='proinspect-property-services'
        self.cfg['terraform']['workload_identity_pool_provider_id']='github'
        inv={
            'services':[],
            'project':{'projectNumber':'696236368989'},
            'accounts':[],
            'buckets':[],
            'secrets':[],
            'databases':[],
            'repositories':[],
            'webApps':[],
            'backupSchedules':[],
            'indexes':[],
            'identityPool':{
                'name':'projects/696236368989/locations/global/workloadIdentityPools/proinspect-property-services',
            },
            'identityProvider':{
                'name':'projects/696236368989/locations/global/workloadIdentityPools/proinspect-property-services/providers/github',
            },
        }
        imported=c.adoption_imports(self.cfg,inv,set())
        self.assertEqual(
            imported['google_iam_workload_identity_pool.github[0]'],
            f'projects/{project}/locations/global/workloadIdentityPools/proinspect-property-services',
        )
        self.assertEqual(
            imported['google_iam_workload_identity_pool_provider.github[0]'],
            f'projects/{project}/locations/global/workloadIdentityPools/proinspect-property-services/providers/github',
        )

    def test_wif_adoption_rejects_unreviewed_discovered_ids(self):
        self.cfg['terraform']['workload_identity_pool_id']='proinspect-property-services'
        self.cfg['terraform']['workload_identity_pool_provider_id']='github'
        inv={
            'services':[],
            'project':{'projectNumber':'696236368989'},
            'accounts':[],
            'buckets':[],
            'secrets':[],
            'databases':[],
            'repositories':[],
            'webApps':[],
            'backupSchedules':[],
            'indexes':[],
            'identityPool':{
                'name':'projects/696236368989/locations/global/workloadIdentityPools/other-pool',
            },
            'identityProvider':None,
        }
        with self.assertRaises(ValueError):
            c.adoption_imports(self.cfg,inv,set())

    def test_secret_imports_use_secret_id_not_numeric_project_resource_name(self):
        project=self.cfg['projectId']
        self.cfg['environment']='production'
        self.cfg['projectId']=project
        self.cfg['terraform']['project_id']=project
        inv={
            'services':[],
            'project':{'projectNumber':'696236368989'},
            'accounts':[],
            'buckets':[],
            'secrets':[
                {'name':'projects/696236368989/secrets/proinspect-production-access-data-encryption-key'},
                {'name':'projects/696236368989/secrets/proinspect-production-report-ingest-token'},
                {'name':'projects/696236368989/secrets/proinspect-production-google-signin-client-secret'},
            ],
            'databases':[],
            'repositories':[],
            'webApps':[],
            'backupSchedules':[],
            'indexes':[],
        }
        imported=c.adoption_imports(self.cfg,inv,set())
        self.assertEqual(imported['google_secret_manager_secret.runtime["access_data_encryption_key"]'],
                         'proinspect-production-access-data-encryption-key')
        self.assertEqual(imported['google_secret_manager_secret.integration["report_ingest_token"]'],
                         'proinspect-production-report-ingest-token')
        self.assertEqual(imported['google_secret_manager_secret.auth_client'],
                         'proinspect-production-google-signin-client-secret')

    def test_secret_aliases_and_disabled_versions_rejected(self):
        manifest={'requiredSecrets':['KEY'],'secretBindings':{'KEY':'managed-key'}}
        for version in ['latest','0','alias']:
            with patch.object(c,'cloud') as cloud,self.assertRaises(ValueError):
                c.resolve_secrets({**self.cfg,'secretVersions':{'KEY':version}},manifest)
            cloud.assert_not_called()
        with patch.object(c,'cloud',return_value={'state':'DISABLED'}),self.assertRaises(ValueError):
            c.resolve_secrets({**self.cfg,'secretVersions':{'KEY':'1'}},manifest)
    def test_missing_live_evidence_keeps_stage_open(self):
        with tempfile.TemporaryDirectory() as root,patch.object(c,'ROOT',Path(root)),patch.object(c,'ensure_clean'),self.assertRaisesRegex(ValueError,'missing infrastructure-apply'):
            c.close_stage3(self.cfg)
    def test_atomic_restore_operation_target_guard(self):
        with self.assertRaises(ValueError): rehearse.wait_operation(self.cfg,{'name':'projects/production/databases/main/operations/1'},'qa')
    def test_failed_export_is_never_backup_evidence(self):
        name='projects/'+self.cfg['projectId']+'/databases/qa/operations/1'
        with self.assertRaises(ValueError): rehearse.wait_operation(self.cfg,{'name':name,'done':True,'error':{'code':13}},'qa')
    def test_live_closure_requires_matching_nonempty_rehearsal_and_runtime_evidence(self):
        cfg=self.cfg
        records={name:evidence(cfg) for name in ['infrastructure-apply','migration-dry','migration-apply','migration-repeat','migration-restore','deployment','integration-readiness','booking-smoke','report-gateway','report-companion']}
        records['migration-dry'].update(beforeCounts={'bookings':1},planDigest='plan')
        records['migration-apply'].update(databaseHash='data',planDigest='plan')
        records['migration-repeat'].update(sourceHash='data',changes=0,dryRun=True)
        records['migration-restore'].update(verifiedContent=True)
        records['deployment'].update(image='repo/image@sha256:'+'a'*64,revision='rev1')
        records['integration-readiness'].update(revision='rev1',checks={k:'passed' for k in ['firestore','indexes','storage','calendar','emailSubmission','reportIngest','authentication']})
        records['booking-smoke'].update(revision='rev1')
        records['report-gateway'].update(coreRevision='rev1')
        records['report-companion'].update(companionSourceSha='247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707',handoffVerified=True,publicationVerified=True,deploymentVerification='operator-attested',deploymentEvidenceReference='version-123',reportToolUrl=cfg['terraform']['report_tool_url'],revision='rev1')
        with tempfile.TemporaryDirectory() as root,patch.object(c,'ROOT',Path(root)),patch.object(c,'ensure_clean'),patch('builtins.print'):
            out=c.workspace(cfg)
            for name,record in records.items(): c.save(out/(name+'.json'),record)
            c.close_stage3(cfg)
            self.assertTrue((out/'stage3-acceptance.json').exists())
            records['migration-dry']['beforeCounts']={}
            c.save(out/'migration-dry.json',records['migration-dry'])
            with self.assertRaisesRegex(ValueError,'empty database'): c.close_stage3(cfg)

    def test_clean_source_required(self):
        with patch.object(c,'run',return_value=' M scripts/stage3/control.py'),self.assertRaises(ValueError): c.ensure_clean()
    def test_auth_rejects_production_before_calls(self):
        import auth
        with patch.object(auth,'validate_config',side_effect=ValueError('production')),patch.object(auth,'cloud') as cloud,self.assertRaises(ValueError):
            auth.configure(self.cfg,self.cfg['projectId'])
        cloud.assert_not_called()
    def test_token_redirect_is_blocked(self):
        self.assertIsNone(deploy.NoRedirect().redirect_request(None,None,302,'',{},'https://unrelated.example.test'))

if __name__=='__main__': unittest.main()
