import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, FileText, Home, Landmark, Loader2 } from 'lucide-react';
import type { ServiceCategory } from '../../types/booking';
import type { DocumentProduct, DocumentRequest } from '../../types/platform';
import { fetchDocumentProducts, submitDocumentRequest } from '../../services/api';

const categories:Array<{id:ServiceCategory;label:string;icon:React.ElementType;description:string}>=[
  {id:'residential',label:'Residential',icon:Home,description:'Residential tenancy agreements, notices, bond forms and related documents.'},
  {id:'commercial',label:'Commercial',icon:Building2,description:'Commercial leases, variations, renewals, notices and authorities.'},
  {id:'strata-building',label:'Strata / Building',icon:Landmark,description:'Strata, building, compliance, meeting and correspondence documents.'},
];

export const DocumentRequestFlow:React.FC<{onBack:()=>void}>=({onBack})=>{
  const [products,setProducts]=useState<DocumentProduct[]>([]);
  const [category,setCategory]=useState<ServiceCategory|null>(null);
  const [productId,setProductId]=useState('');
  const [step,setStep]=useState<1|2|3|4>(1);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [confirmed,setConfirmed]=useState<DocumentRequest|null>(null);
  const [details,setDetails]=useState({
    streetAddress:'',unit:'',suburb:'',state:'WA',postcode:'',
    customerName:'',customerEmail:'',customerPhone:'',notes:'',
  });

  useEffect(()=>{fetchDocumentProducts().then(setProducts).catch(e=>setError(e instanceof Error?e.message:'Unable to load documents.')).finally(()=>setLoading(false));},[]);
  const available=useMemo(()=>products.filter(p=>category&&p.categories.includes(category)),[products,category]);
  const product=products.find(p=>p.id===productId);

  const submit=async()=>{
    if(!category||!product) return;
    setBusy(true);setError(null);
    try{
      const request=await submitDocumentRequest({documentId:product.id,documentCategory:category,details});
      setConfirmed(request);
    }catch(e){setError(e instanceof Error?e.message:'Unable to submit request.');}
    finally{setBusy(false);}
  };

  if(confirmed) return <div className="max-w-2xl mx-auto py-8"><div className="rounded-2xl border border-slate-200 bg-white p-8">
    <CheckCircle2 className="w-12 h-12 text-[#007F82]"/>
    <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-[#007F82]">Request submitted</p>
    <h1 className="mt-2 text-2xl font-extrabold text-[#1A2B4A]">{confirmed.documentName}</h1>
    <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm">
      <div><span className="text-slate-500">Reference:</span> <strong>{confirmed.reference}</strong></div>
      <div className="mt-2"><span className="text-slate-500">Status:</span> {confirmed.status.replaceAll('_',' ')}</div>
      <div className="mt-2"><span className="text-slate-500">Pricing:</span> {confirmed.pricingMode==='fixed'&&confirmed.priceExGst!==undefined?`$${confirmed.priceExGst.toFixed(2)} + GST`:'Quote required'}</div>
    </div>
    <button onClick={onBack} className="mt-6 px-5 py-3 rounded-lg bg-[#007F82] text-white text-sm font-bold">Return to Hub</button>
  </div></div>;

  return <div className="space-y-6">
    <div className="flex items-center justify-between text-xs text-slate-500">
      <button onClick={onBack} className="inline-flex items-center gap-2 font-bold"><ArrowLeft className="w-4 h-4"/>Client Hub</button>
      <span className="font-bold">Document Request · Step {step} of 4</span>
    </div>
    <div className="h-1.5 rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#007F82]" style={{width:`${step*25}%`}}/></div>
    {loading?<div className="py-16 flex justify-center gap-2 text-slate-600"><Loader2 className="w-5 h-5 animate-spin"/>Loading document catalogue…</div>:
    <>
      {step===1&&<section>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">What type of document do you need?</h1>
        <div className="mt-6 grid md:grid-cols-3 gap-4">{categories.map(c=>{const Icon=c.icon;return <button key={c.id} onClick={()=>{setCategory(c.id);setProductId('');}} className={`text-left rounded-xl border-2 p-5 ${category===c.id?'border-[#00B5B8] bg-[#F0FBFB]':'border-slate-200 bg-white'}`}><Icon className="w-5 h-5 text-[#007F82]"/><h2 className="mt-3 font-extrabold text-[#1A2B4A]">{c.label}</h2><p className="mt-2 text-xs text-slate-500">{c.description}</p></button>})}</div>
        <div className="mt-6 flex justify-end"><button disabled={!category} onClick={()=>setStep(2)} className="px-5 py-3 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-40">Continue</button></div>
      </section>}
      {step===2&&<section>
        <h1 className="text-2xl font-extrabold text-[#1A2B4A]">Select a document</h1>
        <div className="mt-5 grid md:grid-cols-2 gap-4">{available.map(p=><button key={p.id} onClick={()=>setProductId(p.id)} className={`text-left rounded-xl border-2 p-5 ${productId===p.id?'border-[#00B5B8] bg-[#F0FBFB]':'border-slate-200 bg-white'}`}><FileText className="w-5 h-5 text-[#007F82]"/><div className="mt-3 font-bold text-[#1A2B4A]">{p.name}</div>{p.formCode&&<div className="text-xs font-bold text-[#007F82] mt-1">{p.formCode}</div>}<p className="mt-2 text-xs text-slate-500">{p.publicDescription}</p><div className="mt-3 text-sm font-bold">{p.pricingMode==='fixed'&&p.priceExGst!==undefined?`$${p.priceExGst.toFixed(2)} + GST`:'Quote required'}</div></button>)}</div>
        <div className="mt-6 flex justify-between"><button onClick={()=>setStep(1)} className="px-4 py-2 text-sm font-bold text-slate-600">Back</button><button disabled={!productId} onClick={()=>setStep(3)} className="px-5 py-3 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-40">Continue</button></div>
      </section>}
      {step===3&&<section className="max-w-2xl">
        <h1 className="text-2xl font-extrabold text-[#1A2B4A]">Property and contact details</h1>
        <div className="mt-5 grid sm:grid-cols-2 gap-3">
          <input required placeholder="Street address" value={details.streetAddress} onChange={e=>setDetails({...details,streetAddress:e.target.value})} className="sm:col-span-2 h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input placeholder="Unit / lot" value={details.unit} onChange={e=>setDetails({...details,unit:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input required placeholder="Suburb" value={details.suburb} onChange={e=>setDetails({...details,suburb:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input value={details.state} onChange={e=>setDetails({...details,state:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input required placeholder="Postcode" value={details.postcode} onChange={e=>setDetails({...details,postcode:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input required placeholder="Contact name" value={details.customerName} onChange={e=>setDetails({...details,customerName:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input required type="email" placeholder="Email" value={details.customerEmail} onChange={e=>setDetails({...details,customerEmail:e.target.value})} className="h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <input required placeholder="Phone" value={details.customerPhone} onChange={e=>setDetails({...details,customerPhone:e.target.value})} className="sm:col-span-2 h-11 rounded-lg border border-slate-300 px-3 text-sm"/>
          <textarea placeholder="Instructions / notes" value={details.notes} onChange={e=>setDetails({...details,notes:e.target.value})} rows={4} className="sm:col-span-2 rounded-lg border border-slate-300 p-3 text-sm"/>
        </div>
        <div className="mt-6 flex justify-between"><button onClick={()=>setStep(2)} className="px-4 py-2 text-sm font-bold text-slate-600">Back</button><button disabled={!details.streetAddress||!details.suburb||!details.postcode||!details.customerName||!details.customerEmail||!details.customerPhone} onClick={()=>setStep(4)} className="px-5 py-3 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-40">Review</button></div>
      </section>}
      {step===4&&product&&<section className="max-w-2xl">
        <h1 className="text-2xl font-extrabold text-[#1A2B4A]">Review request</h1>
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm space-y-3">
          <div><span className="text-slate-500">Document:</span> <strong>{product.name}</strong></div>
          <div><span className="text-slate-500">Property:</span> {details.unit?`${details.unit}, `:''}{details.streetAddress}, {details.suburb} {details.state} {details.postcode}</div>
          <div><span className="text-slate-500">Contact:</span> {details.customerName} · {details.customerEmail}</div>
          <div><span className="text-slate-500">Price:</span> <strong>{product.pricingMode==='fixed'&&product.priceExGst!==undefined?`$${product.priceExGst.toFixed(2)} + GST`:'Quote required after review'}</strong></div>
        </div>
        {error&&<div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        <div className="mt-6 flex justify-between"><button onClick={()=>setStep(3)} className="px-4 py-2 text-sm font-bold text-slate-600">Back</button><button disabled={busy} onClick={()=>void submit()} className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">{busy && <Loader2 className="w-4 h-4 animate-spin" />}<span>Submit Request</span><ArrowRight className="w-4 h-4"/></button></div>
      </section>}
    </>}
  </div>;
};
