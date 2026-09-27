import React from 'react';

interface LogoProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
}

export const Logo: React.FC<LogoProps> = ({ variant = 'dark', size = 'md' }) => {
  const isLight = variant === 'light';

  const iconSizes = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-11 h-11',
  };

  const titleSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  };

  const subSizes = {
    sm: 'text-[9px]',
    md: 'text-[10px]',
    lg: 'text-xs',
  };

  return (
    <div className="flex items-center gap-2.5 select-none group">
      {/* Brand Hexagon / House Architectural Emblem */}
      <div
        className={`${iconSizes[size]} bg-gradient-to-br from-[#0A2540] to-[#0284C7] rounded-lg p-1.5 flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* House outline with verification check */}
          <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5z" />
          <path d="M9 12.5l2 2 4-4" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="flex flex-col leading-none">
        <div className="flex items-center tracking-tight font-extrabold">
          <span className={`${titleSizes[size]} font-bold tracking-tight ${isLight ? 'text-white' : 'text-[#0A2540]'}`}>
            PRO
          </span>
          <span className={`${titleSizes[size]} font-extrabold tracking-tight ${isLight ? 'text-[#38BDF8]' : 'text-[#0284C7]'}`}>
            INSPECT
          </span>
        </div>
        <span
          className={`${subSizes[size]} font-semibold tracking-wider uppercase mt-0.5 ${
            isLight ? 'text-slate-300' : 'text-slate-500'
          }`}
        >
          Property Inspections &bull; WA
        </span>
      </div>
    </div>
  );
};
