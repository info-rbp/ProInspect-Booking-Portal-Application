import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Building2, CalendarDays, CheckCircle2, FileText, Loader2, LogOut, RefreshCw, Wrench, Bell, CreditCard } from 'lucide-react';
import type { UnifiedClientDashboard } from '../../types/platform';
import {
  createClientRequest,
  fetchClientDashboard,
  getClientDocumentDownloadUrl,
  respondClientApproval,
} from '../../services/api';

type Tab='overview'|'properties'|'bookings'|'requests'|'documents'|'approvals'|'payments';

export const ClientPortal: React.FC<{
  user:User;
  onLogout:()=>void;
}> = ({user,onLogout}) => {
  const [data,setData]=useState<UnifiedClientDashboard|null>(null);
  const [tab,setTab]=useState<Tab>('overview');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [composer,setComposer]=useState<'maintenance'|'general'|null>(null);
  const [propertyId,setPropertyId]=useState('');
  const [title,setTitle]=useState('');
  const [details,setDetails]=useState('');
  const [priority,setPriority]=useState<'routine'|'priority'|'urgent'>('routine');
  const [busy,setBusy]=useState(false);

  const load=async()=>{
    setLoading(true); setError(null);
    try {
      const next=await fetchClientDashboard();
      setData(next);
      if(!propertyId && next.properties[0]) setPropertyId(next.properties[0].id);
    } catch(err){ setError(err instanceof Error?err.message:'Unable to load client portal.'); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{void load();},[user.uid]);

  const primaryClient=data?.clients[0];
  const unread=useMemo(()=>data?.notifications.filter(n=>!n.readAt).length||0,[data]);

  const submit=async()=>{
    if(!data||!composer||!primaryClient||!title.trim()||!details.trim()) return;
    setBusy(true); setError(null);
    try{
      await createClientRequest({
        clientId:primaryClient.id,
        propertyId:propertyId||undefined,
        type:composer,
        title,
        details,
        priority,
      });
      setComposer(null); setTitle(''); setDetails(''); setPriority('routine');
      await load(); setTab('requests');
    }catch(err){setError(err instanceof Error?err.message:'Unable to submit request.');}
    finally{setBusy(false);}
  };

  if(loading&&!data) return <div className="py-20 flex justify-center items-center gap-2 text-slate-600"><Loader2 className="w-5 h-5 animate-spin"/>Loading client portal…</div>;
  if(!data) return <div className="max-w-xl mx-auto py-10 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error||'Client portal unavailable.'}</div>;

  const tabs:Array<[Tab,string]>= [['overview','Overview'],['properties','Properties'],['bookings','Bookings'],['requests','Requests'],['documents','Documents'],['approvals','Approvals'],['payments','Payments']];

  return <div className="space-y-6">
    <div className="rounded-2xl bg-[#1A2B4A] text-white p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase font-bold tracking-[0.18em] text-cyan-200">Client Portal</p>
        <h1 className="mt-2 text-2xl font-extrabold">{data.clientUser.displayName}</h1>
        <p className="mt-1 text-sm text-slate-300">{data.clients.map(c=>c.name).join(' · ')}</p>
      </div>
      <div className="flex gap-2">
        <div className="px-3 py-2 rounded-lg bg-white/10 text-xs font-bold flex items-center gap-2"><Bell className="w-4 h-4"/>{unread} unread</div>
        <button onClick={onLogout} className="px-3 py-2 rounded-lg bg-white/10 text-xs font-bold flex items-center gap-2"><LogOut className="w-4 h-4"/>Sign out</button>
      </div>
    </div>

    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold border ${tab===id?'bg-[#007F82] text-white border-[#007F82]':'bg-white text-slate-600 border-slate-200'}`}>{label}</button>)}
    </div>

    {error&&<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

    {tab==='overview'&&<div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Properties',data.properties.length,Building2],
          ['Bookings',data.bookings.length,CalendarDays],
          ['Open requests',data.requests.filter(r=>!['completed','cancelled'].includes(r.status)).length,Wrench],
          ['Documents',data.documents.length,FileText],
        ].map(([label,value,Icon]:any)=><div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><Icon className="w-5 h-5 text-[#007F82]"/><div className="mt-3 text-2xl font-black text-[#1A2B4A]">{value}</div><div className="text-xs text-slate-500">{label}</div></div>)}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <button onClick={()=>{setComposer('maintenance');setTitle('Maintenance request')}} className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#00B5B8]"><Wrench className="w-5 h-5 text-[#007F82]"/><div className="mt-3 font-extrabold text-[#1A2B4A]">Request Maintenance</div><div className="mt-1 text-xs text-slate-500">Create a property maintenance request for ProInspect operations.</div></button>
        <button onClick={()=>{setComposer('general');setTitle('Property operations request')}} className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#00B5B8]"><CheckCircle2 className="w-5 h-5 text-[#007F82]"/><div className="mt-3 font-extrabold text-[#1A2B4A]">Make a Request</div><div className="mt-1 text-xs text-slate-500">Send an instruction or operational request linked to a property.</div></button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex justify-between"><h2 className="font-extrabold text-[#1A2B4A]">Recent notifications</h2><button onClick={()=>void load()}><RefreshCw className="w-4 h-4 text-slate-500"/></button></div>
        <div className="mt-3 divide-y divide-slate-100">
          {data.notifications.slice(0,5).map(n=><div key={n.id} className="py-3"><div className="font-bold text-sm text-slate-800">{n.title}</div><div className="text-xs text-slate-500 mt-1">{n.message}</div></div>)}
          {!data.notifications.length&&<div className="py-6 text-sm text-slate-500">No notifications.</div>}
        </div>
      </div>
    </div>}

    {tab==='properties'&&<div className="grid md:grid-cols-2 gap-4">{data.properties.map(p=><div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5"><Building2 className="w-5 h-5 text-[#007F82]"/><h3 className="mt-3 font-extrabold text-[#1A2B4A]">{p.unit?`${p.unit}, `:''}{p.streetAddress}</h3><p className="text-sm text-slate-500">{p.suburb} {p.state} {p.postcode}</p><p className="mt-3 text-xs text-slate-500">{p.propertyType||'Property'} · {p.status}</p></div>)}</div>}

    {tab==='bookings'&&<div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">{data.bookings.map(b=><div key={b.id} className="p-4 flex justify-between gap-4"><div><div className="font-bold text-sm text-[#1A2B4A]">{b.serviceName}</div><div className="text-xs text-slate-500 mt-1">{b.property.streetAddress}, {b.property.suburb}</div></div><div className="text-right text-xs text-slate-500">{b.appointment.dateString}<br/>{b.appointment.timeString}</div></div>)}{!data.bookings.length&&<div className="p-8 text-sm text-center text-slate-500">No linked bookings yet.</div>}</div>}

    {tab==='requests'&&<div className="space-y-3">{data.requests.map(r=><div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex justify-between gap-3"><div><div className="font-bold text-[#1A2B4A]">{r.title}</div><div className="text-xs text-slate-500 mt-1">{r.reference} · {r.type}</div></div><span className="text-[10px] uppercase font-bold text-slate-600">{r.status.replaceAll('_',' ')}</span></div><p className="mt-3 text-sm text-slate-700">{r.details}</p></div>)}{!data.requests.length&&<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No requests yet.</div>}</div>}

    {tab==='documents'&&<div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">{data.documents.map(d=><div key={d.id} className="p-4 flex justify-between items-center gap-4"><div><div className="font-bold text-sm text-slate-800">{d.title}</div><div className="text-xs text-slate-500 mt-1">{d.category.replaceAll('_',' ')}</div></div><button onClick={async()=>window.open(await getClientDocumentDownloadUrl(d.id),'_blank','noopener,noreferrer')} className="text-xs font-bold text-[#006D70]">Open</button></div>)}{!data.documents.length&&<div className="p-8 text-center text-sm text-slate-500">No client-visible documents.</div>}</div>}

    {tab==='approvals'&&<div className="space-y-3">{data.approvals.map(a=><div key={a.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="font-extrabold text-[#1A2B4A]">{a.title}</div><div className="text-xs text-slate-500 mt-1">{a.reference} · {a.status}</div>{a.summary&&<p className="mt-3 text-sm text-slate-700">{a.summary}</p>}{a.amountExGst!==undefined&&<p className="mt-2 text-sm font-bold text-slate-800">${a.amountExGst.toFixed(2)} + GST</p>}{a.status==='pending'&&<div className="mt-4 flex gap-2"><button onClick={async()=>{await respondClientApproval(a.id,{status:'approved'});await load();}} className="px-3 py-2 rounded-lg bg-[#007F82] text-white text-xs font-bold">Approve</button><button onClick={async()=>{await respondClientApproval(a.id,{status:'changes_requested'});await load();}} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold">Request changes</button><button onClick={async()=>{await respondClientApproval(a.id,{status:'declined'});await load();}} className="px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold">Decline</button></div>}</div>)}{!data.approvals.length&&<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No approvals.</div>}</div>}

    {tab==='payments'&&<div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">{data.payments.map(p=><div key={p.id} className="p-4 flex justify-between items-center gap-4"><div><div className="font-bold text-sm text-slate-800">{p.description}</div><div className="text-xs text-slate-500 mt-1">{p.reference} · {p.status.replaceAll('_',' ')}</div></div><div className="text-right"><div className="font-bold text-[#1A2B4A]">${p.totalAmount.toFixed(2)}</div>{p.checkoutUrl&&p.status==='payment_required'&&<a href={p.checkoutUrl} className="text-xs font-bold text-[#006D70]">Pay now</a>}</div></div>)}{!data.payments.length&&<div className="p-8 text-center text-sm text-slate-500">No payments recorded.</div>}</div>}

    {composer&&<div className="fixed inset-0 z-50 bg-slate-950/50 p-4 overflow-y-auto"><div className="max-w-xl mx-auto my-8 rounded-2xl bg-white p-6">
      <h2 className="text-xl font-extrabold text-[#1A2B4A]">{composer==='maintenance'?'Maintenance Request':'Property Operations Request'}</h2>
      <div className="mt-5 space-y-4">
        <select value={propertyId} onChange={e=>setPropertyId(e.target.value)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm">{data.properties.map(p=><option key={p.id} value={p.id}>{p.streetAddress}, {p.suburb}</option>)}</select>
        <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Request title"/>
        <textarea value={details} onChange={e=>setDetails(e.target.value)} rows={6} className="w-full rounded-lg border border-slate-300 p-3 text-sm" placeholder="Describe what you need."/>
        <select value={priority} onChange={e=>setPriority(e.target.value as any)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"><option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setComposer(null)} className="px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy} onClick={()=>void submit()} className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">{busy?'Submitting…':'Submit Request'}</button></div>
    </div></div>}
  </div>;
};
