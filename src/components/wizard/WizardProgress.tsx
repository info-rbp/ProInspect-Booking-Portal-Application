import React from 'react';
import { Check } from 'lucide-react';

export type WizardStepId = 'service' | 'property' | 'access' | 'appointment' | 'confirm';

interface WizardProgressProps {
  currentStep: WizardStepId;
  onStepClick: (step: WizardStepId) => void;
  completedSteps: WizardStepId[];
}

interface StepItem {
  id: WizardStepId;
  title: string;
  stepNumber: number;
}

const STEPS: StepItem[] = [
  { id: 'service', title: 'Service', stepNumber: 1 },
  { id: 'property', title: 'Property', stepNumber: 2 },
  { id: 'access', title: 'Access', stepNumber: 3 },
  { id: 'appointment', title: 'Appointment', stepNumber: 4 },
  { id: 'confirm', title: 'Confirm', stepNumber: 5 },
];

export const WizardProgress: React.FC<WizardProgressProps> = ({
  currentStep,
  onStepClick,
  completedSteps,
}) => {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-xl p-3 sm:p-5 shadow-xs mb-8">
      {/* Mobile simplified progress bar */}
      <div className="block sm:hidden">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-bold text-[#1A2B4A]">
            Stage {currentIndex + 1} of {STEPS.length}: {STEPS[currentIndex]?.title}
          </span>
          <span className="text-slate-500 font-medium">
            {Math.round(((currentIndex + 1) / STEPS.length) * 100)}% Complete
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#007F82] transition-all duration-300 rounded-full"
            style={{ width: `${((currentIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop / Tablet full step indicator */}
      <div className="hidden sm:flex items-center justify-between relative">
        {/* Background track line */}
        <div className="absolute left-6 right-6 top-4 h-0.5 bg-slate-200 -z-0" />
        <div
          className="absolute left-6 top-4 h-0.5 bg-[#007F82] -z-0 transition-all duration-300"
          style={{
            width: `calc(${(currentIndex / (STEPS.length - 1)) * 100}% - 24px)`,
          }}
        />

        {STEPS.map((step, idx) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = completedSteps.includes(step.id);
          const isPast = idx < currentIndex;
          const isClickable = isCompleted || isPast;

          return (
            <div
              key={step.id}
              className="flex flex-col items-center relative z-10 select-none group"
            >
              <button
                type="button"
                disabled={!isClickable && !isCurrent}
                onClick={() => isClickable && onStepClick(step.id)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                  isCurrent
                    ? 'bg-[#007F82] text-white ring-4 ring-sky-100 shadow-sm scale-110'
                    : isCompleted || isPast
                    ? 'bg-[#1A2B4A] text-white cursor-pointer hover:bg-[#007F82]'
                    : 'bg-white text-slate-400 border-2 border-slate-300 cursor-not-allowed'
                }`}
              >
                {isCompleted && !isCurrent ? (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                ) : (
                  step.stepNumber
                )}
              </button>
              <span
                className={`text-xs mt-2 font-semibold transition-colors ${
                  isCurrent
                    ? 'text-[#1A2B4A] font-bold'
                    : isCompleted || isPast
                    ? 'text-slate-700'
                    : 'text-slate-400'
                }`}
              >
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
