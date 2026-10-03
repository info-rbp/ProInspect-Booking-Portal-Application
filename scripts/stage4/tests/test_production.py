import copy
import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"scripts/stage4"))
import common
import release
import request as requests
import checkpoints
import discover

def fixture():
    return json.loads((Path(__file__).parent/"production.fixture.json").read_text())

class ProductionPolicy(unittest.TestCase):
    def test_valid_production_configuration(self):
        self.assertEqual(common.validate(fixture())["projectId"],common.PROJECT)
    def test_frozen_targets(self):
        for key,value in [("projectId","other-project"),("databaseId","(default)"),("environment","staging")]:
            c=fixture(); c[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): common.validate(c)
    def test_no_staging_sink(self):
        c=fixture(); c["terraform"]["staging_email_recipient"]="customer@example.test"
        with self.assertRaises(ValueError):common.validate(c)
    def test_distinct_runtime_and_terraform(self):
        c=fixture(); c["terraform"]["terraform_service_account_email"]=c["terraform"]["runtime_service_account_email"]
        with self.assertRaises(ValueError):common.validate(c)
    def test_distinct_operational_accounts(self):
        c=fixture(); c["production"]["deployIdentity"]=c["production"]["buildIdentity"]
        with self.assertRaises(ValueError):common.validate(c)
    def test_numeric_secret_versions_only(self):
        for version in ["latest","disabled","0",0,"",None]:
            c=fixture(); c["secretVersions"]["PRODUCTION_RELEASE_TOKEN"]=version
            with self.subTest(version=version),self.assertRaises(ValueError):common.validate(c)
    def test_required_secret_not_optional(self):
        c=fixture(); del c["secretVersions"]["ACCESS_DATA_ENCRYPTION_KEY"]
        with self.assertRaises(ValueError):common.validate(c)
    def test_no_unreviewed_state_adoption(self):
        c=fixture();c["stateOwnershipReviewed"]=False
        with self.assertRaises(ValueError):common.validate(c)
    def test_existing_browser_identity_must_match(self):
        c=fixture();c["firebaseConfig"]["appId"]="different"
        with self.assertRaises(ValueError):common.validate(c)
    def test_no_production_region_change(self):
        c=fixture();c["terraform"]["region"]="australia-southeast1"
        with self.assertRaises(ValueError):common.validate(c)
    def test_no_arbitrary_image_registry(self):
        c=fixture();c["production"]["imageRepository"]="attacker.example/platform"
        with self.assertRaises(ValueError):common.validate(c)
    def test_no_state_prefix_fork(self):
        c=fixture();c["state"]["prefix"]="new-state/production"
        with self.assertRaises(ValueError):common.validate(c)
    def test_real_reviewers_required(self):
        with self.assertRaises(ValueError):common.validate_environment({"protection_rules":[]},{})
    def test_no_wildcard_production_branch(self):
        env={"protection_rules":[{"type":"required_reviewers","reviewers":[{"id":1}]}],
             "deployment_branch_policy":{"custom_branch_policies":True}}
        with self.assertRaises(ValueError): common.validate_environment(env,{"branch_policies":[{"name":"*","type":"branch"}]})
    def test_production_environment_policy(self):
        env={"protection_rules":[{"type":"required_reviewers","reviewers":[{"id":1}]}],
             "deployment_branch_policy":{"custom_branch_policies":True}}
        common.validate_environment(env,{"branch_policies":[{"name":"release/platform-unification","type":"branch"}]})
    def test_no_secret_in_request(self):
        r={"schemaVersion":1,"action":"plan","releaseId":"release-test","sourceSha":"a"*40,"token":"secret"}
        with self.assertRaises(ValueError):requests.validate_request(r)
    def test_no_shell_in_approval(self):
        r={"schemaVersion":1,"action":"plan","releaseId":"release-test","sourceSha":"a"*40,"approve":"$(evil)"}
        with self.assertRaises(ValueError):requests.validate_request(r)
    def test_source_pin_not_branch(self):
        r={"schemaVersion":1,"action":"plan","releaseId":"release-test","sourceSha":"main"}
        with self.assertRaises(ValueError):requests.validate_request(r)
    def test_exact_approval(self):
        with self.assertRaises(ValueError):common.approval("yes","abc123")
    def test_no_destructive_plan(self):
        for kind in ["google_storage_bucket","google_firestore_database","google_firestore_index"]:
            plan={"resource_changes":[{"mode":"managed","address":kind+".test","type":kind,
              "change":{"actions":["delete","create"],"before":{},"after":{}}}]}
            with self.subTest(kind=kind),self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_expected_firestore_ruleset_and_release_transition_accepted(self):
        c=fixture()
        release_name="cloud.firestore/"+c["databaseId"]
        ruleset={"mode":"managed","address":"google_firebaserules_ruleset.firestore",
          "type":"google_firebaserules_ruleset","change":{"actions":["create","delete"],
          "before":{"project":common.PROJECT,"name":"projects/"+common.PROJECT+"/rulesets/existing"},
          "after":{"project":common.PROJECT,"name":None,
                   "source":[{"files":[{"name":"firestore.rules","content":"rules"}]}]},
          "after_unknown":{"name":True},"replace_paths":[["source",0,"files"]]}}
        release_change={"mode":"managed","address":"google_firebaserules_release.firestore",
          "type":"google_firebaserules_release","change":{"actions":["delete","create"],
          "before":{"project":common.PROJECT,"name":release_name,
                    "ruleset_name":"projects/"+common.PROJECT+"/rulesets/existing"},
          "after":{"project":common.PROJECT,"name":release_name,"ruleset_name":None},
          "after_unknown":{"ruleset_name":True},"replace_paths":[["ruleset_name"]]}}
        release.production_plan_guard({"resource_changes":[ruleset,release_change]},c)

    def test_firestore_ruleset_replacement_requires_abandon_and_canonical_source(self):
        c=fixture()
        base={"mode":"managed","address":"google_firebaserules_ruleset.firestore",
          "type":"google_firebaserules_ruleset","change":{"actions":["create","delete"],
          "before":{"project":common.PROJECT,"name":"projects/"+common.PROJECT+"/rulesets/existing"},
          "after":{"project":common.PROJECT,"name":None,
                   "source":[{"files":[{"name":"firestore.rules","content":"rules"}]}]},
          "after_unknown":{"name":True},"replace_paths":[["source",0,"files"]]}}
        cases=[]
        wrong_address=copy.deepcopy(base);wrong_address["address"]="google_firebaserules_ruleset.other";cases.append(wrong_address)
        wrong_file=copy.deepcopy(base);wrong_file["change"]["after"]["source"][0]["files"][0]["name"]="storage.rules";cases.append(wrong_file)
        wrong_path=copy.deepcopy(base);wrong_path["change"]["replace_paths"]=[["project"]];cases.append(wrong_path)
        destroy_first=copy.deepcopy(base);destroy_first["change"]["actions"]=["delete","create"];cases.append(destroy_first)
        delete_only=copy.deepcopy(base);delete_only["change"]["actions"]=["delete"];cases.append(delete_only)
        for resource in cases:
            with self.subTest(resource=resource),self.assertRaises(ValueError):
                release.production_plan_guard({"resource_changes":[resource]},c)

    def test_unapproved_destructive_changes_are_reported_together(self):
        c=fixture()
        plan={"resource_changes":[
          {"mode":"managed","address":"google_storage_bucket.one","type":"google_storage_bucket",
           "change":{"actions":["delete","create"],"before":{},"after":{}}},
          {"mode":"managed","address":"google_firestore_index.two","type":"google_firestore_index",
           "change":{"actions":["delete","create"],"before":{},"after":{}}},
        ]}
        with self.assertRaises(ValueError) as raised:
            release.production_plan_guard(plan,c)
        self.assertIn("google_storage_bucket.one",str(raised.exception))
        self.assertIn("google_firestore_index.two",str(raised.exception))

    def test_expected_firestore_rules_release_replacement_accepted(self):
        c=fixture()
        release_name="cloud.firestore/"+c["databaseId"]
        plan={"resource_changes":[{"mode":"managed","address":"google_firebaserules_release.firestore",
          "type":"google_firebaserules_release","change":{"actions":["delete","create"],
          "before":{"project":common.PROJECT,"name":release_name,
                    "ruleset_name":"projects/"+common.PROJECT+"/rulesets/existing"},
          "after":{"project":common.PROJECT,"name":release_name,"ruleset_name":None},
          "after_unknown":{"ruleset_name":True},"replace_paths":[["ruleset_name"]]}}]}
        release.production_plan_guard(plan,c)

    def test_firestore_rules_release_replacement_is_narrowly_scoped(self):
        c=fixture()
        release_name="cloud.firestore/"+c["databaseId"]
        base={"mode":"managed","address":"google_firebaserules_release.firestore",
          "type":"google_firebaserules_release","change":{"actions":["delete","create"],
          "before":{"project":common.PROJECT,"name":release_name,
                    "ruleset_name":"projects/"+common.PROJECT+"/rulesets/existing"},
          "after":{"project":common.PROJECT,"name":release_name,"ruleset_name":None},
          "after_unknown":{"ruleset_name":True},"replace_paths":[["ruleset_name"]]}}
        cases=[]
        wrong_address=copy.deepcopy(base);wrong_address["address"]="google_firebaserules_release.other";cases.append(wrong_address)
        wrong_name=copy.deepcopy(base);wrong_name["change"]["after"]["name"]="cloud.firestore/other";cases.append(wrong_name)
        wrong_path=copy.deepcopy(base);wrong_path["change"]["replace_paths"]=[["name"]];cases.append(wrong_path)
        delete_only=copy.deepcopy(base);delete_only["change"]["actions"]=["delete"];cases.append(delete_only)
        for resource in cases:
            with self.subTest(resource=resource),self.assertRaises(ValueError):
                release.production_plan_guard({"resource_changes":[resource]},c)

    def test_no_authoritative_iam(self):
        plan={"resource_changes":[{"type":"google_project_iam_binding","address":"google_project_iam_binding.test",
              "change":{"actions":["create"],"after":{"project":common.PROJECT}}}]}
        with self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_no_cloud_run_terraform_ownership(self):
        plan={"resource_changes":[{"type":"google_cloud_run_v2_service","address":"google_cloud_run_v2_service.test",
              "change":{"actions":["update"],"after":{"project":common.PROJECT}}}]}
        with self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_no_secret_payload_in_state(self):
        plan={"resource_changes":[{"type":"google_secret_manager_secret_version","address":"google_secret_manager_secret_version.test",
              "change":{"actions":["create"],"after":{"project":common.PROJECT}}}]}
        with self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_no_recreated_production_database(self):
        plan={"resource_changes":[{"type":"google_firestore_database","address":"google_firestore_database.platform",
              "change":{"actions":["create"],"after":{"project":common.PROJECT,"delete_protection_state":"DELETE_PROTECTION_ENABLED"}}}]}
        with self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_existing_database_import_accepted(self):
        plan={"resource_changes":[{"type":"google_firestore_database","address":"google_firestore_database.platform",
              "change":{"actions":["no-op"],"importing":{"id":"existing"},"after":{"project":common.PROJECT,"delete_protection_state":"DELETE_PROTECTION_ENABLED"}}}]}
        release.production_plan_guard(plan,fixture())
    def test_incomplete_plan(self):
        with self.assertRaises(ValueError):release.production_plan_guard({"complete":False},fixture())
    def test_no_data_ttl_activation(self):
        plan={"resource_changes":[{"type":"google_firestore_field","address":"google_firestore_field.ttl",
              "change":{"actions":["update"],"after":{"project":common.PROJECT,"ttl_config":[{}]}}}]}
        with self.assertRaises(ValueError):release.production_plan_guard(plan,fixture())
    def test_no_invalid_encryption_key(self):
        for raw in ["example","base64:not-a-key",""]:
            with self.subTest(raw=raw),self.assertRaises(ValueError):release.encryption_fingerprint(raw)
    def test_encryption_prefix_normalization(self):
        import base64
        value=base64.b64encode(bytes(range(32))).decode()
        self.assertEqual(release.encryption_fingerprint(value),release.encryption_fingerprint("base64:"+value))
    def test_initial_encryption_key_requires_empty_encrypted_collections(self):
        c=fixture()
        key="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        with patch.object(release,"api",return_value={}),patch.object(release,"secret",return_value=key):
            fingerprint,mode=release.encryption_baseline(c,{})
        self.assertEqual(mode,"initial")
        self.assertEqual(fingerprint,release.encryption_fingerprint(key))

    def test_initial_encryption_key_refuses_existing_encrypted_records(self):
        c=fixture()
        key="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        with patch.object(release,"api",return_value={"documents":[{"fields":{"keyId":{"stringValue":"v1"}}}]}),patch.object(release,"secret",return_value=key):
            with self.assertRaises(ValueError):
                release.encryption_baseline(c,{})

    def test_resolved_traffic_only(self):
        with self.assertRaises(ValueError):common.traffic({"status":{"traffic":[{"percent":100,"latestRevision":True}]}})
        self.assertEqual(common.traffic({"status":{"traffic":[{"revisionName":"fixed","percent":100}]}}),{"fixed":100})
    def test_evidence_requires_exact_release(self):
        c=fixture()
        with tempfile.TemporaryDirectory() as td,patch.object(common,"ROOT",Path(td)):
            common.record(c,"sample")
            c["releaseId"]="other-release"
            with self.assertRaises((ValueError,FileNotFoundError)):common.evidence(c,"sample")
    def test_synthetic_evidence_not_production(self):
        c=fixture()
        with tempfile.TemporaryDirectory() as td,patch.object(common,"ROOT",Path(td)):
            common.record(c,"sample",synthetic=True)
            with self.assertRaises(ValueError):common.evidence(c,"sample")
    def test_github_oidc_issuer_accepts_google_trailing_slash(self):
        self.assertTrue(discover.github_issuer({"oidc":{"issuerUri":"https://token.actions.githubusercontent.com/"}}))
        self.assertTrue(discover.github_issuer({"oidc":{"issuerUri":"https://token.actions.githubusercontent.com"}}))
        self.assertFalse(discover.github_issuer({"oidc":{"issuerUri":"https://example.invalid/"}}))

    def test_bootstrap_normalizes_existing_provider_issuer(self):
        source=(ROOT/"scripts/stage4/bootstrap.py").read_text()
        self.assertIn('issuer=str(provider.get("oidc",{}).get("issuerUri","")).rstrip("/")',source)

    def test_checkpoints_exclude_credentials_and_caches(self):
        self.assertNotIn("runtime-env.private.json",checkpoints.ALLOWED)
        self.assertNotIn("staging.local.json",checkpoints.ALLOWED)
        self.assertNotIn("gha-creds.json",checkpoints.ALLOWED)
        self.assertNotIn("terraform-data",checkpoints.ALLOWED)
    def test_maintenance_requires_exact_source_approval_before_calls(self):
        with patch.object(release,"cloud") as cloud:
            with self.assertRaises(ValueError):release.maintenance(fixture(),"yes")
            cloud.assert_not_called()
    def test_no_rollback_without_data_compatibility(self):
        c=fixture()
        values={"candidate":{"revision":"rc"},"baseline":{"allocation":{"old":100}},
                "operator-acceptance":{"priorRevisionCompatible":False}}
        with patch.object(release,"evidence",side_effect=lambda c,n:values[n]),patch.object(release,"cloud") as cloud:
            with self.assertRaises(ValueError):release.rollback(c,"ROLLBACK:rc")
            cloud.assert_not_called()
    def test_failed_acceptance_never_promotes(self):
        with patch.object(release,"accepted",side_effect=ValueError("missing checks")),patch.object(release,"cloud") as cloud:
            with self.assertRaises(ValueError):release.promote(fixture(),"PROMOTE:rc")
            cloud.assert_not_called()

if __name__=="__main__":unittest.main()
