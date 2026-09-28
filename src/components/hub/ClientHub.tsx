import React from 'react';
import { ArrowRight, CalendarCheck2, FileText, Home } from 'lucide-react';

interface ClientHubProps {
  onNavigate: (path: '/book' | '/request-document' | '/tenant') => void;
}

export const ClientHub: React.FC<ClientHubProps> = ({ onNavigate }) => {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="text-center max-w-2xl mx-auto pt-4">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#007F82]">
          ProInspect Client Hub
        </p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1A2B4A]">
          How can we help?
        </h1>
        <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
          Choose an option below to book a property service or start a document request.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <button
          type="button"
          onClick={() => onNavigate('/book')}
          className="group text-left rounded-2xl border-2 border-slate-200 bg-white p-6 sm:p-7 hover:border-[#00B5B8] hover:shadow-md transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
            <CalendarCheck2 className="w-6 h-6" />
          </div>
          <h2 className="mt-5 text-xl font-extrabold text-[#1A2B4A]">
            Book a Service
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed min-h-[3.5rem]">
            Book inspections, maintenance attendances, property meetings and other ProInspect services.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#006D70] group-hover:gap-3 transition-all">
            Book a Service
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('/request-document')}
          className="group text-left rounded-2xl border-2 border-slate-200 bg-white p-6 sm:p-7 hover:border-[#00B5B8] hover:shadow-md transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
            <FileText className="w-6 h-6" />
          </div>
          <h2 className="mt-5 text-xl font-extrabold text-[#1A2B4A]">
            Request a Document
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed min-h-[3.5rem]">
            Request leases, notices, variations and other property-related documentation.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#006D70] group-hover:gap-3 transition-all">
            Request a Document
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/tenant')}
          className="group text-left rounded-2xl border-2 border-slate-200 bg-white p-6 sm:p-7 hover:border-[#00B5B8] hover:shadow-md transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
            <Home className="w-6 h-6" />
          </div>
          <h2 className="mt-5 text-xl font-extrabold text-[#1A2B4A]">
            Tenant Portal
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed min-h-[3.5rem]">
            Report maintenance, make tenancy requests, view inspections and access tenancy documents.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#006D70] group-hover:gap-3 transition-all">
            Open Tenant Portal
            <ArrowRight className="w-4 h-4" />
          </span>
        </button>
      </div>
    </div>
  );
};
