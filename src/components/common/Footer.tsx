import React from 'react';
import { Logo } from './Logo';
import { Mail, Phone } from 'lucide-react';

interface FooterProps {
  onOpenAdmin?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenAdmin }) => {
  return (
    <footer className="bg-[#1A2B4A] text-slate-300 border-t border-slate-800">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <Logo variant="light" size="sm" />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <a
              href="mailto:info@proinspect.systems"
              className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-[#00B5B8]" />
              info@proinspect.systems
            </a>
            <a
              href="tel:+61893069668"
              className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-[#00B5B8]" />
              (08) 9306 9668
            </a>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-700/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-500">
          <span>
            &copy; {new Date().getFullYear()} ProInspect Systems &bull; ABN 48 629 192 481
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://proinspect.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              Privacy &amp; Terms
            </a>

            {onOpenAdmin && (
              <>
                <span className="text-slate-700">&bull;</span>
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  className="hover:text-slate-300 transition-colors"
                >
                  Staff Portal
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
};
