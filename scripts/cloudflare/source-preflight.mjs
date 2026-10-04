import {execFileSync} from 'node:child_process';

export async function checkSourceAccess(project,database,token){
 if(project!=='business-plan-applicatio-17047'||database!=='ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a'||!token)throw new Error('Reviewed source identity required');
 const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/'+database;
 const response=await fetch(root+'/documents:runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{select:{fields:[{fieldPath:'__name__'}]},from:[{collectionId:'services'}],limit:1}})});
 const payload=await response.json().catch(()=>({}));
 const queryPassed=response.ok&&!payload.error&&(!Array.isArray(payload)||!payload.some(row=>row.error));
 console.log(JSON.stringify({check:'source-firestore-rest-read',httpStatus:response.status,passed:queryPassed}));
 const migration='serviceAccount:proinspect-prod-migration@'+project+'.iam.gserviceaccount.com';
 try{
  const policy=JSON.parse(execFileSync('gcloud',['projects','get-iam-policy',project,'--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));
  console.log(JSON.stringify({check:'migration-identity-role-inventory',roles:(policy.bindings||[]).filter(row=>(row.members||[]).includes(migration)).map(row=>({role:row.role,conditional:Boolean(row.condition)}))}));
 }catch{console.log(JSON.stringify({check:'migration-identity-role-inventory',status:'unavailable'}));}
 for(const region of ['global','europe-west1']){
  try{
   const triggers=JSON.parse(execFileSync('gcloud',['builds','triggers','list','--project='+project,'--region='+region,'--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));
   console.log(JSON.stringify({check:'legacy-build-trigger-inventory',region,triggers:triggers.map(row=>({id:row.id,name:row.name,disabled:row.disabled===true,github:row.github?{owner:row.github.owner,name:row.github.name,push:row.github.push,pullRequest:row.github.pullRequest}:null,repositoryEventConfig:row.repositoryEventConfig?{repository:row.repositoryEventConfig.repository,push:row.repositoryEventConfig.push,pullRequest:row.repositoryEventConfig.pullRequest}:null,triggerTemplate:row.triggerTemplate?{repoName:row.triggerTemplate.repoName,branchName:row.triggerTemplate.branchName}:null}))}));
  }catch{console.log(JSON.stringify({check:'legacy-build-trigger-inventory',region,status:'unavailable'}));}
 }
 if(!queryPassed)throw new Error('Migration identity cannot read the reviewed Firestore source (HTTP '+response.status+'). No IAM or customer data has been changed.');
}
