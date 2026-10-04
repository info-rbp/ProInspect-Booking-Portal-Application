/** Verify a real Report Tool round trip against canonical records and PDF bytes.
 * The separately deployed Cloudflare revision is explicitly operator-attested;
 * this command does not misrepresent that attestation as a cloud deployment query.
 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { validateProbeConfig } from './integrations.js';
const COMPANION='247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707';
const load=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
function check(condition:unknown,message:string):asserts condition {if(!condition) throw new Error(message);}
export function validateReceipt(receipt:any,config:any) {
  check(receipt.schemaVersion===1 && receipt.deployedCompanionSha===COMPANION && receipt.operatorPrincipal===config.operatorPrincipal,'Explicit operator attestation of the frozen companion deployment is required.');
  check(receipt.reportToolUrl===config.terraform.report_tool_url && receipt.finalized===true && receipt.deploymentEvidenceReference,'Companion finalisation/deployment evidence is incomplete.');
  for(const key of ['reportSourceId','propertyId','handoffAuditId']) check(/^[a-zA-Z0-9_-]{1,128}$/.test(receipt[key]||''),'Invalid receipt reference.');
  check(/^[a-f0-9]{64}$/.test(receipt.issuedPdfSha256||''),'Hash the actual finalised Report Tool PDF.');
  const when=Date.parse(receipt.completedAt); check(Number.isFinite(when) && when<=Date.now() && Date.now()-when<86400000,'Receipt is not recent.');
}
async function main(args:string[]) {
  const value=(k:string)=>args[args.indexOf(k)+1];
  check(args.includes('--config') && args.includes('--receipt'),'--config and --receipt are required.');
  const config=load(value('--config')); check(args.includes('--approve') && value('--approve')===config.projectId,'Approve the staging project explicitly.');
  execFileSync('python3',['scripts/stage3/control.py','validate-config','--config',value('--config')],{stdio:['ignore','pipe','pipe']});
  const base=`private-evidence/stage3/${config.environment}/${config.projectId}/${config.databaseId}`;
  const manifest=load(base+'/runtime-manifest.json'), deployment=load(base+'/deployment.json'), receipt=load(value('--receipt'));
  validateProbeConfig(config,manifest,deployment); validateReceipt(receipt,config);
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); check(sourceSha===deployment.sourceSha,'Core source changed after deployment.');
  const token=execFileSync('gcloud',['auth','print-access-token','--project='+config.projectId,'--impersonate-service-account='+manifest.runtimeIdentity],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const app=initializeApp({projectId:config.projectId,credential:{getAccessToken:async()=>({access_token:token,expires_in:3000})}},'stage3-companion');
  try {
    const db=getFirestore(app,config.databaseId); const docId='report_'+receipt.reportSourceId;
    const doc=(await db.collection('propertyDocuments').doc(docId).get()).data();
    const audit=(await db.collection('auditEvents').doc(receipt.handoffAuditId).get()).data();
    check(doc && doc.propertyId===receipt.propertyId && doc.uploadedBy==='report-generator' && doc.contentType==='application/pdf','Canonical issued report does not match the receipt.');
    check(audit?.action==='report.handoff_created' && audit.propertyId===receipt.propertyId && audit.actor?.type==='staff','No matching authenticated staff handoff audit event.');
    const issued=Date.parse(doc.createdAt); const handed=Date.parse(audit.createdAt);
    check(Number.isFinite(issued) && Number.isFinite(handed) && handed<=issued && Date.now()-handed<86400000,'The handoff/issue sequence is not recent and ordered.');
    const bytes=(await getStorage(app).bucket(manifest.documentBucket).file(doc.storagePath).download())[0];
    check(bytes.subarray(0,5).toString()==='%PDF-' && createHash('sha256').update(bytes).digest('hex')===receipt.issuedPdfSha256,'Canonical PDF differs from the finalised companion PDF.');
    const evidence={schemaVersion:1,status:'passed',environment:'staging',projectId:config.projectId,databaseId:config.databaseId,sourceSha,revision:deployment.revision,companionSourceSha:COMPANION,reportToolUrl:receipt.reportToolUrl,handoffVerified:true,publicationVerified:true,deploymentVerification:'operator-attested',deploymentEvidenceReference:receipt.deploymentEvidenceReference,documentId:docId,issuedPdfSha256:receipt.issuedPdfSha256,completedAt:new Date().toISOString()};
    const path=base+'/report-companion.json'; writeFileSync(path,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);
    console.log('Canonical handoff, report context and PDF hash verified; separate companion deployment remains explicitly operator-attested.');
  } finally {await deleteApp(app);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(()=>{console.error('COMPANION ACCEPTANCE BLOCKED. Check private receipt and canonical records.');process.exitCode=1;});
