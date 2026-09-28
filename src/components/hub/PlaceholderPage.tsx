import React from 'react';
import { ArrowLeft, FileText, LogIn } from 'lucide-react';

interface PlaceholderPageProps {
  type: 'document' | 'signin';
  onBack: () => void;
}

export const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ type, onBack }) => {
  const isDocument = type === 'document';
  const Icon = isDocument ? FileText : LogIn;

  return (
    <div className="max-w-2xl mx-auto py-8 sm:py-14 animate-fadeIn">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-10 shadow-xs text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center mx-auto">
          <Icon className="w-7 h-7" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">
          {isDocument ? 'Document Requests' : 'Client Portal'}
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
          {isDocument ? 'Document request workflow coming next' : 'Client sign in coming soon'}
        </h1>
        <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
          {isDocument
            ? 'This page reserves the document-request area of the ProInspect Client Hub. The guided request workflow will be added in the next development stage.'
            : 'This page reserves the future ProInspect Client Portal sign-in area. Client authentication and portal access will be built in a later stage.'}
        </p>

        <button
          type="button"
          onClick={onBack}
          className="mt-7 inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Client Hub
        </button>
      </div>
    </div>
  );
};
