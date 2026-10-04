import React from 'react';
import { Building2, Home, ShieldCheck, CalendarPlus, FileText } from 'lucide-react';

export const PortalGateway: React.FC<{
  onClient: () => void;
  onTenant: () => void;
  onStaff: () => void;
  onBook: () => void;
  onRequestDocument: () => void;
  onBrowseServices: () => void;
}> = ({ onClient, onTenant, onStaff, onBook, onRequestDocument, onBrowseServices }) => {
  const portals = [
    { title: 'Client Portal', description: 'Manage properties, bookings, requests, documents, approvals, payments and organisation access.', icon: Building2, action: onClient },
    { title: 'Tenant Portal', description: 'View tenancy information, submit requests, complete WA statutory workflows and access approved documents.', icon: Home, action: onTenant },
    { title: 'Staff / Admin', description: 'Open ProInspect operations, tenancy workflows and canonical platform administration.', icon: ShieldCheck, action: onStaff },
  ];
  return (
    <div className="space-y-8">
      <section className="text-center py-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#007F82]">ProInspect</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-[#1A2B4A]">Property services and portals</h1>
        <p className="mt-3 max-w-2xl mx-auto text-slate-600">Choose the portal that matches your relationship with ProInspect, or continue directly to a public service.</p>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {portals.map(({ title, description, icon: Icon, action }) => (
          <button key={title} type="button" onClick={action}
            className="text-left rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-[#00A7AA] hover:shadow-md transition">
            <div className="w-11 h-11 rounded-xl bg-[#F0FBFB] text-[#006D70] flex items-center justify-center"><Icon className="w-5 h-5" /></div>
            <h2 className="mt-5 text-lg font-extrabold text-[#1A2B4A]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            <span className="mt-5 inline-block text-sm font-bold text-[#006D70]">Continue →</span>
          </button>
        ))}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-extrabold text-[#1A2B4A]">Public services</h2>
            <p className="mt-1 text-sm text-slate-600">Signing in is not required to book a service, request a document or manage an existing booking.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBook} className="inline-flex items-center gap-2 rounded-lg bg-[#006D70] px-4 py-2.5 text-sm font-bold text-white"><CalendarPlus className="w-4 h-4" /> Book a service</button>
            <button type="button" onClick={onRequestDocument} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700"><FileText className="w-4 h-4" /> Request a document</button>
            <button type="button" onClick={onBrowseServices} className="rounded-lg px-4 py-2.5 text-sm font-bold text-[#006D70]">Browse services</button>
          </div>
        </div>
      </section>
    </div>
  );
};
