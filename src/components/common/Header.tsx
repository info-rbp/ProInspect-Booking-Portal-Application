import React from 'react';
import { Logo } from './Logo';
import { Calendar, LogIn } from 'lucide-react';

interface HeaderProps {
  activeView: 'booking' | 'admin';
  setActiveView: (view: 'booking' | 'admin') => void;
  onNavigate: (path: '/' | '/book' | '/signin' | '/tenant') => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  setActiveView,
  onNavigate,
}) => {
  const handleLogoClick = () => {
    setActiveView('booking');
    onNavigate('/');
  };

  const handleCustomerView = () => {
    setActiveView('booking');
    onNavigate('/book');
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        <button
          type="button"
          onClick={handleLogoClick}
          className="cursor-pointer"
          aria-label="ProInspect Client Hub"
        >
          <Logo size="md" />
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          {activeView === 'admin' ? (
            <button
              type="button"
              onClick={handleCustomerView}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#006D70] hover:text-[#005B5E] px-3 py-2 rounded-md hover:bg-sky-50 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              <span>Customer Booking View</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('/tenant')}
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-[#006D70] hover:text-[#005B5E] px-4 py-2 rounded-lg border border-[#00B5B8]/40 hover:bg-[#F0FBFB] transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
