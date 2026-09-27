import React from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  Home,
  Landmark,
} from 'lucide-react';
import type { ServiceCategory } from '../../types/booking';

interface ServiceTypeOption {
  id: ServiceCategory;
  title: string;
  description: string;
  icon: React.ElementType;
}

const OPTIONS: ServiceTypeOption[] = [
  {
    id: 'residential',
    title: 'Residential',
    description: 'Inspections and property support for houses, apartments, townhouses and residential tenancies.',
    icon: Home,
  },
  {
    id: 'commercial',
    title: 'Commercial',
    description: 'Property inspections, attendances and support for commercial, retail, office and industrial premises.',
    icon: Building2,
  },
  {
    id: 'strata-building',
    title: 'Strata / Building',
    description: 'Building management, common property, strata and shared-facility attendances.',
    icon: Landmark,
  },
];

interface Step0ServiceTypeProps {
  selectedCategory: ServiceCategory | null;
  onSelectCategory: (category: ServiceCategory) => void;
  onNext: () => void;
}

export const Step0ServiceType: React.FC<Step0ServiceTypeProps> = ({
  selectedCategory,
  onSelectCategory,
  onNext,
}) => (
  <div className="space-y-6 animate-fadeIn">
    <div className="border-b border-slate-200 pb-5">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A] tracking-tight">
        What type of property service do you need?
      </h1>
      <p className="mt-1.5 text-sm sm:text-base text-slate-600">
        Select the property category first. The next step will only show services available for that category.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {OPTIONS.map((option) => {
        const selected = option.id === selectedCategory;
        const Icon = option.icon;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectCategory(option.id)}
            className={`relative rounded-xl border-2 p-5 text-left transition-all duration-200 min-h-[190px] flex flex-col justify-between ${
              selected
                ? 'border-[#00B5B8] bg-[#F0FBFB] shadow-sm ring-1 ring-[#00B5B8]/20'
                : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                    selected ? 'bg-[#007F82] text-white' : 'bg-slate-100 text-[#1A2B4A]'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                    selected
                      ? 'border-[#00B5B8] bg-[#007F82] text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>

              <h3 className="font-bold text-lg text-[#1A2B4A]">{option.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                {option.description}
              </p>
            </div>

            <span className="mt-4 text-xs font-bold text-[#006D70]">
              {selected ? 'Selected' : 'Select category'} &rarr;
            </span>
          </button>
        );
      })}
    </div>

    <div className="pt-4 flex items-center justify-end border-t border-slate-200">
      <button
        type="button"
        disabled={!selectedCategory}
        onClick={onNext}
        className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm transition-all duration-200 ${
          selectedCategory
            ? 'bg-[#007F82] hover:bg-[#006D70] text-white shadow-xs cursor-pointer'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        <span>Continue to Select Service</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  </div>
);
