import React from 'react';
import { InspectionService } from '../../types/booking';
import {
  ClipboardCheck,
  FileSpreadsheet,
  LogOut,
  Building2,
  Wrench,
  Users,
  ShieldCheck,
  HelpCircle,
  Clock,
  ArrowRight,
  Check,
} from 'lucide-react';

interface Step1ServiceProps {
  services: InspectionService[];
  selectedServiceId: string | null;
  onSelectService: (service: InspectionService) => void;
  onNext: () => void;
}

// Icon mapper for service cards
const iconMap: Record<string, React.ElementType> = {
  ClipboardCheck,
  FileSpreadsheet,
  LogOut,
  Building2,
  Wrench,
  Users,
  ShieldCheck,
  HelpCircle,
};

export const Step1Service: React.FC<Step1ServiceProps> = ({
  services,
  selectedServiceId,
  onSelectService,
  onNext,
}) => {
  const selectedService = services.find((s) => s.id === selectedServiceId);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Step Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0A2540] tracking-tight">
          What service do you need?
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600">
          Select the service you would like ProInspect to attend.
        </p>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((service) => {
          const isSelected = service.id === selectedServiceId;
          const IconComponent = iconMap[service.iconName || 'ClipboardCheck'] || ClipboardCheck;

          return (
            <div
              key={service.id}
              onClick={() => onSelectService(service)}
              className={`relative rounded-xl border-2 p-5 cursor-pointer transition-all duration-200 flex flex-col justify-between text-left group ${
                isSelected
                  ? 'border-[#0284C7] bg-[#F0F9FF] shadow-sm ring-1 ring-[#0284C7]/20'
                  : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
              }`}
            >
              {/* Card top badge & selection radio */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-[#0284C7] text-white'
                          : 'bg-slate-100 text-[#0A2540] group-hover:bg-slate-200'
                      }`}
                    >
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-[#0A2540] leading-snug">
                        {service.name}
                      </h3>
                      {service.badge && (
                        <span className="inline-block text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-sky-100 text-[#0284C7] mt-0.5">
                          {service.badge}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Selection Check Circle */}
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'border-[#0284C7] bg-[#0284C7] text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {service.publicDescription}
                </p>
              </div>

              {/* Card bottom metadata: duration */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Approx. {service.duration} mins on site
                </span>
                <span className="font-semibold text-[#0284C7] text-xs group-hover:underline">
                  {isSelected ? 'Selected' : 'Select'} &rarr;
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Bar */}
      <div className="pt-4 flex items-center justify-between border-t border-slate-200">
        <div className="text-xs text-slate-500">
          {selectedService ? (
            <span>
              Selected: <strong className="text-[#0A2540]">{selectedService.name}</strong> ({selectedService.duration} min)
            </span>
          ) : (
            <span>Please select an inspection service to proceed</span>
          )}
        </div>

        <button
          type="button"
          disabled={!selectedServiceId}
          onClick={onNext}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm transition-all duration-200 ${
            selectedServiceId
              ? 'bg-[#0284C7] hover:bg-[#0369A1] text-white shadow-xs cursor-pointer'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span>Continue to Property Details</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
