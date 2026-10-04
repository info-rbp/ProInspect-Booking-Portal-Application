import React, {useState} from 'react';
import {Loader2,Mail,Shield,X} from 'lucide-react';
import {completeSignIn,requestSignIn,tenantEmailLinkIsActive,type User} from '../../services/session';

export const AdminLoginModal:React.FC<{isOpen:boolean;onClose:()=>void;onLoginSuccess:(user:User)=>void}>=({isOpen,onClose,onLoginSuccess})=>{
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState('');
 const completing=tenantEmailLinkIsActive();
 if(!isOpen)return null;
 async function submit(event:React.FormEvent){
  event.preventDefault();setBusy(true);setError('');
  try{
   if(completing){const {user}=await completeSignIn(email,'admin');onLoginSuccess(user);onClose();}
   else{await requestSignIn(email,'admin');setSent(true);}
  }catch(value){setError(value instanceof Error?value.message:'Unable to sign in.');}
  finally{setBusy(false);}
 }
 return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
  <section role="dialog" aria-modal="true" aria-labelledby="staff-login-title" className="bg-white rounded-2xl max-w-md w-full p-7 relative">
   <button aria-label="Close" onClick={onClose} className="absolute top-3 right-3"><X/></button>
   <Shield className="text-teal-800 mb-4"/>
   <h2 id="staff-login-title" className="text-xl font-bold">ProInspect Staff Portal</h2>
   <p className="my-4 text-sm text-slate-600">{completing?'Enter the authorised staff email that received this link to complete sign-in.':'Receive a secure one-time sign-in link at an authorised ProInspect staff address.'}</p>
   <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-semibold">Staff email
     <input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 p-3"/>
    </label>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {sent&&<p role="status" className="text-sm text-emerald-700">Check your inbox for the one-time sign-in link.</p>}
    <button disabled={busy} className="w-full rounded-lg bg-teal-800 py-3 font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60">
     {busy?<Loader2 className="animate-spin" size={18}/>:<Mail size={18}/>}
     {completing?'Complete staff sign-in':'Email staff sign-in link'}
    </button>
   </form>
  </section>
 </div>;
};
