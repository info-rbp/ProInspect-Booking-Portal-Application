import React from 'react';
import { Logo } from './Logo';
import { ShieldCheck, MapPin, Mail, Phone, ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#0A2540] text-slate-300 mt-20 border-t border-slate-800">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand Info */}
          <div className="md:col-span-2 space-y-4">
            <Logo variant="light" size="md" />
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              Western Australia's dedicated property inspection operations partner. Providing routine inspections, detailed property condition reports (PCR), exit inspections, and asset attendance across the greater Perth metropolitan area.
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-[#38BDF8]" />
              <span>Fully Insured &bull; Professional Indemnity &amp; Public Liability</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              ProInspect Services
            </h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>Routine Inspections</li>
              <li>Property Condition Reports (PCR)</li>
              <li>Final / Exit Inspections</li>
              <li>Commercial Inspections</li>
              <li>Building Management Visits</li>
            </ul>
          </div>

          {/* Contact / Service Area */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Service Operations
            </h4>
            <div className="space-y-2 text-sm text-slate-400">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
                <span>Perth Metropolitan &amp; Greater WA</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <a href="mailto:info@remotebusinesspartner.com.au" className="hover:text-white transition-colors">
                  info@remotebusinesspartner.com.au
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#38BDF8] shrink-0" />
                <span>1300 PRO INSPECT</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            &copy; {new Date().getFullYear()} ProInspect Systems. All rights reserved. ABN: 48 629 192 481.
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://proinspect.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 flex items-center gap-1 transition-colors"
            >
              proinspect.systems
              <ExternalLink className="w-3 h-3" />
            </a>
            <span>&bull;</span>
            <span>Australian Privacy &amp; Tenancy Standards</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
