import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Plus, RefreshCw, UserRoundCog, Wrench } from 'lucide-react';
import type { AdminTenantPortalSnapshot } from '../../types/tenant';
import type { AuditEvent, Contractor, OperationsQueueItem, PaymentRecord, WorkOrder, WorkOrderStatus } from '../../types/platform';
import {
  createAdminContractor,
  createAdminWorkOrder,
  fetchAdminOperations,
  fetchAdminTenantPortal,
  updateAdminClientRequest,
  updateAdminDocumentRequest,
  updateAdminPayment,
  updateAdminTenantRequest,
  updateAdminWorkOrder,
} from '../../services/api';

const STATUSES: WorkOrderStatus[] = ['triage','quote_required','awaiting_approval','approved','assigned','scheduled','in_progress','completed','cancelled'];

export const AdminOperations:React.FC=()=>{
  const [queue,setQueue]=useState<OperationsQueueItem[]>([]);
  const [workOrders,setWorkOrders]=useState<WorkOrder[]>([]);
  const [contractors,setContractors]=useState<Contractor[]>([]);
  const [payments,setPayments]=useState<PaymentRecord[]>([]);
  const [auditEvents,setAuditEvents]=useState<AuditEvent[]>([]);
  const [snapshot,setSnapshot]=useState<AdminTenantPortalSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [showWO,setShowWO]=useState(false);
  const [showContractor,setShowContractor]=useState(false);
  const [wo,setWo]=useState({propertyId:'',clientId:'',title:'',description:'',priority:'routine' as WorkOrder['priority'],accessNotes:''});
  const [contractor,setContractor]=useState({name:'',trade:'',email:'',phone:''});

  const load=async()=>{
    setLoading(true);setError(null);
    try{
      const [ops,portal]=await Promise.all([fetchAdminOperations(),fetchAdminTenantPortal()]);
      setQueue(ops.queue);setWorkOrders(ops.workOrders);setContractors(ops.contractors);setPayments(ops.payments);setAuditEvents(ops.auditEvents);setSnapshot(portal);
      if(!wo.propertyId&&portal.properties[0]) setWo(v=>({...v,propertyId:portal.properties[0].id}));
    }catch(e){setError(e instanceof Error?e.message:'Unable to load operations.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);

  const propertyMap=useMemo(()=>new Map(snapshot?.properties.map(p=>[p.id,p])||[]),[snapshot]);
  const clientMap=useMemo(()=>new Map(snapshot?.clients.map(c=>[c.id,c])||[]),[snapshot]);

  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError(null);setMessage(null);try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{setBusy(false);}};

  const updateQueueStatus=async(item:OperationsQueueItem,status:string)=>{
    if(item.source==='client_request'){
      await updateAdminClientRequest(item.id,{status:status as any});
    }else if(item.source==='document_request'){
      await updateAdminDocumentRequest(item.id,{status:status as any});
    }else if(item.source==='tenant_request'){
      await updateAdminTenantRequest(item.id,{status:status as any});
    }else if(item.source==='work_order'){
      await updateAdminWorkOrder(item.id,{status:status as WorkOrderStatus});
    }
  };

  const queueStatuses=(item:OperationsQueueItem):string[]=>{
    if(item.source==='client_request') return ['submitted','under_review','awaiting_client','approved','in_progress','completed','cancelled'];
    if(item.source==='document_request') return ['submitted','under_review','awaiting_information','in_preparation','ready','completed','cancelled'];
    if(item.source==='tenant_request') return ['submitted','under_review','action_required','approved','declined','in_progress','completed','closed'];
    if(item.source==='work_order') return STATUSES;
    return [];
  };

  if(loading&&!snapshot)return <div className="rounded-xl border border-slate-200 bg-white p-10 flex justify-center gap-2 text-sm text-slate-600"><Loader2 className="w-5 h-5 animate-spin"/>Loading operations…</div>;

  return <div className="space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div><h2 className="text-lg font-extrabold text-[#1A2B4A]">Operations</h2><p className="mt-1 text-xs text-slate-500">Unified queue for bookings, requests, documents, approvals and maintenance work orders.</p></div>
      <div className="flex gap-2">
        <button onClick={()=>setShowContractor(true)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold flex items-center gap-2"><UserRoundCog className="w-4 h-4"/>Contractor</button>
        <button onClick={()=>setShowWO(true)} className="px-3 py-2 rounded-lg bg-[#007F82] text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4"/>Work Order</button>
        <button onClick={()=>void load()} className="px-3 py-2 rounded-lg border border-slate-200"><RefreshCw className="w-4 h-4"/></button>
      </div>
    </div>

    {error&&<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {message&&<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs uppercase font-bold text-slate-400">Queue</div><div className="text-2xl font-black text-[#1A2B4A] mt-1">{queue.length}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs uppercase font-bold text-slate-400">Work orders</div><div className="text-2xl font-black text-[#1A2B4A] mt-1">{workOrders.length}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs uppercase font-bold text-slate-400">Urgent</div><div className="text-2xl font-black text-rose-700 mt-1">{queue.filter(q=>['urgent','emergency'].includes(q.priority)).length}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs uppercase font-bold text-slate-400">Contractors</div><div className="text-2xl font-black text-[#1A2B4A] mt-1">{contractors.filter(c=>c.active).length}</div></div>
    </div>

    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-[#007F82]"/><h3 className="font-extrabold text-[#1A2B4A]">Unified Queue</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="text-left px-4 py-3">Reference</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Property</th><th className="text-left px-4 py-3">Priority</th><th className="text-left px-4 py-3">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{queue.map(item=>{const options=queueStatuses(item);return <tr key={item.source+item.id}><td className="px-4 py-3 font-mono font-bold text-[#1A2B4A]">{item.reference}</td><td className="px-4 py-3">{item.source.replaceAll('_',' ')}</td><td className="px-4 py-3">{item.propertyLabel||'—'}{item.clientName&&<div className="text-[10px] text-slate-400">{item.clientName}</div>}</td><td className="px-4 py-3"><span className={`font-bold uppercase ${['urgent','emergency'].includes(item.priority)?'text-rose-700':'text-slate-600'}`}>{item.priority}</span></td><td className="px-4 py-3">{options.length?<select disabled={busy} value={item.status} onChange={e=>void run(async()=>{await updateQueueStatus(item,e.target.value);setMessage(`${item.reference} status updated.`);})} className="h-9 rounded-lg border border-slate-300 px-2 text-xs">{options.map(status=><option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select>:item.status.replaceAll('_',' ')}</td></tr>})}{!queue.length&&<tr><td colSpan={5} className="p-10 text-center text-slate-500">No active operations items.</td></tr>}</tbody>
        </table>
      </div>
    </div>

    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><Wrench className="w-4 h-4 text-[#007F82]"/><h3 className="font-extrabold text-[#1A2B4A]">Maintenance / Work Orders</h3></div>
      <div className="mt-4 space-y-3">{workOrders.map(order=><div key={order.id} className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div><div className="font-mono text-xs font-bold text-[#007F82]">{order.reference}</div><div className="mt-1 font-bold text-[#1A2B4A]">{order.title}</div><div className="text-xs text-slate-500 mt-1">{propertyMap.get(order.propertyId)?.streetAddress||order.propertyId}</div><p className="mt-2 text-sm text-slate-700">{order.description}</p></div>
          <div className="w-full lg:w-64 space-y-2">
            <select value={order.status} disabled={busy} onChange={e=>void run(async()=>{await updateAdminWorkOrder(order.id,{status:e.target.value as WorkOrderStatus});setMessage(`${order.reference} status updated.`);})} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold">{STATUSES.map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select>
            <select value={order.contractorId||''} disabled={busy} onChange={e=>void run(async()=>{await updateAdminWorkOrder(order.id,{contractorId:e.target.value||undefined});setMessage(`${order.reference} contractor updated.`);})} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs"><option value="">Unassigned</option>{contractors.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}{c.trade?` · ${c.trade}`:''}</option>)}</select>
          </div>
        </div>
      </div>)}{!workOrders.length&&<div className="py-6 text-sm text-slate-500">No work orders yet.</div>}</div>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100"><h3 className="font-extrabold text-[#1A2B4A]">Payments</h3><p className="text-xs text-slate-500 mt-1">Fixed-fee and externally settled payment records.</p></div>
        <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">{payments.map(payment=><div key={payment.id} className="px-5 py-4 flex items-center justify-between gap-3"><div><div className="font-bold text-sm text-slate-800">{payment.description}</div><div className="text-xs text-slate-500">{payment.reference} · ${payment.totalAmount.toFixed(2)}</div></div><select disabled={busy} value={payment.status} onChange={e=>void run(async()=>{await updateAdminPayment(payment.id,e.target.value as PaymentRecord['status']);setMessage(`${payment.reference} payment updated.`);})} className="h-9 rounded-lg border border-slate-300 px-2 text-xs"><option value="pending">pending</option><option value="payment_required">payment required</option><option value="paid">paid</option><option value="failed">failed</option><option value="refunded">refunded</option><option value="waived">waived</option></select></div>)}{!payments.length&&<div className="p-8 text-sm text-center text-slate-500">No payments recorded.</div>}</div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100"><h3 className="font-extrabold text-[#1A2B4A]">Recent Audit History</h3><p className="text-xs text-slate-500 mt-1">Immutable operational events across the platform.</p></div>
        <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">{auditEvents.map(event=><div key={event.id} className="px-5 py-3"><div className="text-sm font-bold text-slate-800">{event.summary}</div><div className="text-[11px] text-slate-500 mt-1">{event.entityType.replaceAll('_',' ')} · {new Date(event.createdAt).toLocaleString('en-AU')}</div></div>)}{!auditEvents.length&&<div className="p-8 text-sm text-center text-slate-500">No audit events recorded yet.</div>}</div>
      </div>
    </div>

    {showWO&&snapshot&&<div className="fixed inset-0 z-50 bg-slate-950/50 p-4 overflow-y-auto"><div className="max-w-xl mx-auto my-8 rounded-2xl bg-white p-6">
      <h2 className="text-xl font-extrabold text-[#1A2B4A]">Create Work Order</h2>
      <div className="mt-5 space-y-3">
        <select value={wo.propertyId} onChange={e=>setWo({...wo,propertyId:e.target.value})} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">{snapshot.properties.map(p=><option key={p.id} value={p.id}>{p.streetAddress}, {p.suburb}</option>)}</select>
        <select value={wo.clientId} onChange={e=>setWo({...wo,clientId:e.target.value})} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">No client selected</option>{snapshot.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input value={wo.title} onChange={e=>setWo({...wo,title:e.target.value})} placeholder="Work order title" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"/>
        <textarea value={wo.description} onChange={e=>setWo({...wo,description:e.target.value})} rows={5} placeholder="Scope / issue details" className="w-full rounded-lg border border-slate-300 p-3 text-sm"/>
        <select value={wo.priority} onChange={e=>setWo({...wo,priority:e.target.value as WorkOrder['priority']})} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select>
        <textarea value={wo.accessNotes} onChange={e=>setWo({...wo,accessNotes:e.target.value})} rows={3} placeholder="Access notes" className="w-full rounded-lg border border-slate-300 p-3 text-sm"/>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setShowWO(false)} className="px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy} onClick={()=>void run(async()=>{await createAdminWorkOrder({...wo,clientId:wo.clientId||undefined});setShowWO(false);setWo({...wo,title:'',description:'',accessNotes:''});setMessage('Work order created.');})} className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold">Create</button></div>
    </div></div>}

    {showContractor&&<div className="fixed inset-0 z-50 bg-slate-950/50 p-4"><div className="max-w-md mx-auto mt-20 rounded-2xl bg-white p-6">
      <h2 className="text-xl font-extrabold text-[#1A2B4A]">Add Contractor</h2>
      <div className="mt-5 space-y-3"><input value={contractor.name} onChange={e=>setContractor({...contractor,name:e.target.value})} placeholder="Contractor / business name" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"/><input value={contractor.trade} onChange={e=>setContractor({...contractor,trade:e.target.value})} placeholder="Trade / service" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"/><input value={contractor.email} onChange={e=>setContractor({...contractor,email:e.target.value})} placeholder="Email" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"/><input value={contractor.phone} onChange={e=>setContractor({...contractor,phone:e.target.value})} placeholder="Phone" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"/></div>
      <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setShowContractor(false)} className="px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy||!contractor.name.trim()} onClick={()=>void run(async()=>{await createAdminContractor(contractor);setShowContractor(false);setContractor({name:'',trade:'',email:'',phone:''});setMessage('Contractor created.');})} className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold">Add</button></div>
    </div></div>}
  </div>;
};
