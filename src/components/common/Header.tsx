import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';
import { fetchSettings } from '../../services/api';
import { Clock, ExternalLink, Calendar } from 'lucide-react';

interface HeaderProps {
  activeView: 'booking' | 'admin';
  setActiveView: (view: 'booking' | 'admin') => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  setActiveView,
}) => {
  const [hoursSummary, setHoursSummary] = useState('Availability shown from live booking settings');

  useEffect(() => {
    fetchSettings()
      .then((settings) => {
        const monday = settings.operatingHours.monday;
        const weekday = settings.operatingHours.tuesday;
        if (monday?.active && weekday?.active) {
          setHoursSummary(`Mon ${monday.open}-${monday.close} · Tue-Fri ${weekday.open}-${weekday.close}`);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      {/* Top micro-bar for WA operational status */}
      <div className="bg-[#1A2B4A] text-slate-300 text-xs py-1.5 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium text-slate-200">
              Live Scheduling Engine &bull; Western Australia (AWST UTC+8)
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-[11px] text-slate-300">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {hoursSummary}
            </span>
            <span className="text-slate-500">|</span>
            <a
              href="https://proinspect.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white flex items-center gap-1 transition-colors"
            >
              proinspect.systems
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Main Header Bar */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        <div
          onClick={() => setActiveView('booking')}
          className="cursor-pointer"
        >
          <Logo size="md" />
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {activeView === 'admin' ? (
            <button
              onClick={() => setActiveView('booking')}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#006D70] hover:text-[#005B5E] px-3 py-1.5 rounded-md hover:bg-sky-50 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              <span>Customer Booking View</span>
            </button>
          ) : (
            <a
              href="https://proinspect.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-[#1A2B4A] px-3 py-2 rounded-md hover:bg-slate-100 transition-colors"
            >
              <span>proinspect.systems</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
