#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_PROJECT, digest } from './migration-model.mjs';
const tf=(args)=>execFileSync('terraform',['-chdir=infrastructure',...args],{encoding:'utf8',stdio:['inherit','pipe','inherit']});
const cloud=args=>JSON.parse(execFileSync('gcloud',[...args,'--format=json'],{encoding:'utf8',maxBuffer:32*1024*1024}));
export function inspectPlan(plan, expected={}) {
  const errors=[];
  const values=Object.fromEntries(Object.entries(plan.variables||{}).map(([k,v])=>[k,v.value]));
  if (!['staging','production'].includes(values.environment) || !values.project_id) errors.push('Explicit project/environment missing from saved plan.');
  if (expected.project && expected.project!==values.project_id || expected.environment && expected.environment!==values.environment) errors.push('Saved plan target does not match requested target.');
  if (values.environment==='staging' && values.project_id===PRODUCTION_PROJECT) errors.push('Staging targets production.');
  for (const c of plan.resource_changes||[]) {
    const actions=c.change?.actions||[];
    if (actions.includes('delete')) errors.push(`${c.address}: deletion/replacement forbidden; import/reconcile instead`);
    if (/^google_cloud_run.*service/.test(c.type) || /secret_version$|service_account_key$/.test(c.type)) errors.push(`${c.address}: competing runtime ownership or secret payload resource forbidden`);
    if (c.type==='google_storage_bucket' && c.change.after && (c.change.after.public_access_prevention!=='enforced' || c.change.after.uniform_bucket_level_access!==true || c.change.after.force_destroy===true)) errors.push(`${c.address}: bucket must be private and protected`);
    if (c.type.endsWith('_iam_policy') || c.type.endsWith('_iam_binding')) errors.push(`${c.address}: authoritative IAM replacement forbidden; use additive members`);
    if (c.change.after?.member==='allUsers' || c.change.after?.member==='allAuthenticatedUsers') errors.push(`${c.address}: public IAM binding forbidden`);
  }
  return errors;
}
async function main() {
  const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:Object.fromEntries(['project','environment','out','manifest','vars','plan','approve-plan'].map(k=>[k,{type:'string'}]))});
  const action=p[0];
  if (!['inventory','import','plan','apply','check'].includes(action)) throw new Error('Usage: infra.mjs inventory|import|plan|check|apply --environment staging|production --project ID [--out FILE --vars TFVARS --manifest JSON --plan SAVED_PLAN --approve-plan HASH]');
  if (!['staging','production'].includes(v.environment) || !/^[a-z][a-z0-9-]+[a-z0-9]$/.test(v.project||'')) throw new Error('Explicit valid target required.');
  if (v.environment==='staging' && v.project===PRODUCTION_PROJECT) throw new Error('Staging cannot target production.');
  if (action==='inventory') {
    if (!v.out) throw new Error('--out required.');
    const target=['--project',v.project];
    const result={environment:v.environment,project:v.project,capturedAt:new Date().toISOString(),projectMetadata:cloud(['projects','describe',v.project]),databases:cloud(['firestore','databases','list',...target]),buckets:cloud(['storage','buckets','list',...target]),secrets:cloud(['secrets','list',...target]),serviceAccounts:cloud(['iam','service-accounts','list',...target]),repositories:cloud(['artifacts','repositories','list','--location=all',...target]),iam:cloud(['projects','get-iam-policy',v.project])};
    // No secret payloads or Cloud Run env values are collected.
    result.services=cloud(['run','services','list','--platform=managed',...target]).map(s=>({name:s.metadata?.name,region:s.metadata?.labels?.['cloud.googleapis.com/location'],serviceAccount:s.spec?.template?.spec?.serviceAccountName}));
    result.indexes={};
    for (const d of result.databases) { const id=d.name.split('/').at(-1); result.indexes[id]=cloud(['firestore','indexes','composite','list',`--database=${id}`,...target]); }
    mkdirSync(dirname(resolve(v.out)),{recursive:true,mode:0o700});
    writeFileSync(v.out,JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
    console.log(`Inventory captured without secret payloads: ${v.out}`); return;
  }
  if (action==='import') {
    if (!v.manifest || !v.vars) throw new Error('--manifest and --vars required.');
    const manifest=JSON.parse(readFileSync(v.manifest,'utf8'));
    if (manifest.project!==v.project || manifest.environment!==v.environment) throw new Error('Import manifest target mismatch.');
    const state=tf(['state','list']).split('\n'), ids=new Set(),addresses=new Set();
    for (const entry of manifest.bindings||[]) {
      if (!/^google_(project_service|storage_bucket|secret_manager_secret|service_account|firestore_database|firestore_index|artifact_registry_repository|firebaserules_release|iam_workload_identity_pool|iam_workload_identity_pool_provider|[a-z_]+_iam_member)\.[a-z_]+(?:\[(?:"[a-zA-Z0-9_.:\/@ -]+"|\d+)\])?$/.test(entry.address) || typeof entry.id!=='string' || !entry.id || entry.id.includes('\n')) throw new Error('Invalid reviewed import address/ID.');
      if (ids.has(entry.id)||addresses.has(entry.address)) throw new Error('An existing resource cannot have two Terraform owners.');
      ids.add(entry.id);addresses.add(entry.address);
      if (state.includes(entry.address)) throw new Error(`${entry.address} already has state; inspect before importing, do not overwrite.`);
    }
    // Verify variable target without contacting a provider or printing secret payloads.
    const expression='jsonencode({project=var.project_id,environment=var.environment})';
    const resolved=JSON.parse(JSON.parse(execFileSync('terraform',['-chdir=infrastructure','console',`-var-file=${resolve(v.vars)}`],{input:expression+'\n',encoding:'utf8'}).trim()));
    if (resolved.project!==v.project||resolved.environment!==v.environment) throw new Error('tfvars/import target mismatch.');
    for (const entry of manifest.bindings||[]) console.log(tf(['import',`-var-file=${resolve(v.vars)}`,entry.address,entry.id]));
    return;
  }
  if (action==='plan') {
    if (!v.vars||!v.out) throw new Error('--vars and --out required.');
    console.log(tf(['plan','-input=false',`-var-file=${resolve(v.vars)}`,`-out=${resolve(v.out)}`]));
    v.plan=v.out;
  }
  if (!v.plan) throw new Error('--plan required.');
  const plan=JSON.parse(tf(['show','-json',resolve(v.plan)]));
  const errors=inspectPlan(plan,{environment:v.environment,project:v.project});
  if (errors.length) throw new Error(errors.join('\n'));
  const hash=digest(readFileSync(v.plan).toString('base64'));
  console.log(JSON.stringify({status:'review_required',environment:v.environment,project:v.project,planHash:hash}));
  if (action==='apply') {
    if (v.environment!=='staging') throw new Error('Stage 3 infrastructure apply is staging-only. Production changes require Stage 4 approval.');
    if (hash!==v['approve-plan']) throw new Error('Explicit --approve-plan hash required after reviewing the saved plan.');
    console.log(tf(['apply','-input=false',resolve(v.plan)]));
  }
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
