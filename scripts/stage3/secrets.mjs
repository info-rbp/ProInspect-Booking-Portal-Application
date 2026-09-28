#!/usr/bin/env node
// Add a version from a protected local file. Never generate/replace the existing encryption key implicitly.
import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
const {values:v}=parseArgs({options:{project:{type:'string'},secret:{type:'string'},file:{type:'string'},'acknowledge-new-version':{type:'boolean'}}});
try {
  if (!v['acknowledge-new-version']||!v.project||!/^proinspect-staging-[a-z0-9-]+$/.test(v.secret||'')||!v.file||v.project==='business-plan-applicatio-17047') throw new Error('Usage: secrets.mjs --project STAGING_PROJECT --secret proinspect-staging-NAME --file PRIVATE_FILE --acknowledge-new-version. Production rotation is not authorised in Stage 3.');
  if ((statSync(v.file).mode & 0o077)!==0) throw new Error('Secret input file must not be group/world readable. Use mode 0600.');
  const bytes=readFileSync(v.file);
  if (!bytes.length||bytes.length>65536) throw new Error('Secret size is invalid.');
  if (v.secret.endsWith('-access-data-encryption-key') && Buffer.from(bytes.toString().trim().replace(/^base64:/,''),'base64').length!==32) throw new Error('Encryption key must be 32 random bytes encoded as base64.');
  const version=execFileSync('gcloud',['secrets','versions','add',v.secret,`--project=${v.project}`,'--data-file=-','--format=value(name)'],{input:bytes,encoding:'utf8',stdio:['pipe','pipe','inherit']}).trim();
  console.log(JSON.stringify({version,action:'Pin this numeric version in runtime_secret_versions; no runtime was redeployed.'}));
} catch(e) { console.error(e.message);process.exitCode=1; }
