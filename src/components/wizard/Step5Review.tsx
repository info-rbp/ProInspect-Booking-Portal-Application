import React, { useState } from 'react';
import {
  InspectionService,
  PropertyDetails,
  AccessDetails,
  AppointmentSlot,
} from '../../types/booking';
import { WizardStepId } from './WizardProgress';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  KeyRound,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Edit3,
} from 'lucide-react';

interface Step5ReviewProps {
  service: InspectionService;
  property: PropertyDetails;
  access: AccessDetails;
  appointment: AppointmentSlot;
  onJumpToStep: (step: WizardStepId) => void;
  onConfirm: () => Promise<void>;
  isSubmitting: boolean;
  conflictError: string | null;
}

export const Step5Review: React.FC<Step5ReviewProps> = ({
  service,
  property,
  access,
  appointment,
  onJumpToStep,
  onConfirm,
  isSubmitting,
  conflictError,
}) => {
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  const formatAccessMethod = (m: string): string => {
    switch (m) {
      case 'tenant':
        return 'Tenant will provide access';
      case 'meet_onsite':
        return 'Meet someone onsite';
      case 'keys_agency':
        return 'Keys held at agency';
      case 'keys_proinspect':
        return 'Keys held by ProInspect';
      case 'lockbox':
        return 'Lockbox on site';
      case 'vacant':
        return 'Property is vacant / open access';
      default:
        return 'Other arrangement';
    }
  };

  const unitPrefix = property.unit ? `${property.unit}, ` : '';
  const fullAddress = `${unitPrefix}${property.streetAddress}, ${property.suburb} ${property.state} ${property.postcode}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAcknowledged || isSubmitting) return;
    await onConfirm();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A] tracking-tight">
          Review your booking
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600">
          Please review the inspection details before confirming your booking.
        </p>
      </div>

      {/* Conflict Error Notification */}
      {conflictError && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 flex items-start gap-3 animate-shake">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h4 className="font-bold text-sm">Appointment Slot Conflict</h4>
            <p className="text-xs text-rose-700">{conflictError}</p>
            <button
              type="button"
              onClick={() => onJumpToStep('appointment')}
              className="text-xs font-bold text-rose-900 underline hover:no-underline"
            >
              Choose another appointment time &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Structured Sections */}
      <div className="space-y-4">
        {/* 1. Appointment & Service Hero Card */}
        <div className="bg-[#1A2B4A] text-white rounded-xl p-5 sm:p-6 shadow-sm relative overflow-hidden">
          <div className="flex items-start justify-between relative z-10">
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                Scheduled Inspection
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white">{service.name}</h2>
              <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-300 pt-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Calendar className="w-4 h-4 text-[#006D70]" />
                  {appointment.displayDate}
                </span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-4 h-4 text-[#006D70]" />
                  {appointment.displayTime} AWST ({service.duration} mins)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onJumpToStep('appointment')}
              className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Change</span>
            </button>
          </div>
        </div>

        {/* 2. Property Location Section */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#006D70]" />
              <h3 className="font-bold text-sm text-[#1A2B4A] uppercase tracking-wider">
                Property Address
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onJumpToStep('property')}
              className="text-xs font-semibold text-[#006D70] hover:underline flex items-center gap-1"
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-slate-400 font-medium block">Address:</span>
              <span className="font-semibold text-[#1A2B4A]">{fullAddress}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 font-medium block">Property Type:</span>
              <span className="font-medium text-slate-800">{property.propertyType}</span>
            </div>
            {property.clientName && (
              <div>
                <span className="text-xs text-slate-400 font-medium block">Managing Agency:</span>
                <span className="font-medium text-slate-800">{property.clientName}</span>
              </div>
            )}
            {property.clientReference && (
              <div>
                <span className="text-xs text-slate-400 font-medium block">Property Reference:</span>
                <span className="font-medium text-slate-800">{property.clientReference}</span>
              </div>
            )}
          </div>
        </div>

        {/* 3. Customer & Contact Details */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#006D70]" />
              <h3 className="font-bold text-sm text-[#1A2B4A] uppercase tracking-wider">
                Customer &amp; Booking Contact
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onJumpToStep('property')}
              className="text-xs font-semibold text-[#006D70] hover:underline flex items-center gap-1"
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-xs text-slate-400 font-medium block">Contact Name:</span>
              <span className="font-semibold text-[#1A2B4A]">{property.customerName}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 font-medium block">Email (Invitee):</span>
              <span className="font-medium text-slate-800">{property.customerEmail}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 font-medium block">Mobile:</span>
              <span className="font-medium text-slate-800">{property.customerPhone}</span>
            </div>
          </div>
        </div>

        {/* 4. Access Arrangements */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#006D70]" />
              <h3 className="font-bold text-sm text-[#1A2B4A] uppercase tracking-wider">
                Access Arrangements
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onJumpToStep('access')}
              className="text-xs font-semibold text-[#006D70] hover:underline flex items-center gap-1"
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs text-slate-400 font-medium block">Method:</span>
              <span className="font-bold text-[#1A2B4A]">{formatAccessMethod(access.method)}</span>
            </div>

            {/* Method Specific Details */}
            {access.method === 'tenant' && access.tenant && (
              <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Tenant: </span>
                  <span className="font-semibold text-slate-800">
                    {access.tenant.tenantName} ({access.tenant.tenantPhone})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Entry Notice: </span>
                  <span className="font-semibold text-slate-800">
                    {access.tenant.noticeIssued === 'yes' ? 'Issued' : 'Pending'}
                    {access.tenant.noticeDate ? ` (${access.tenant.noticeDate})` : ''}
                  </span>
                </div>
                {access.tenant.accessRestrictions && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-400 font-medium">Restrictions: </span>
                    <span className="text-slate-700">{access.tenant.accessRestrictions}</span>
                  </div>
                )}
              </div>
            )}

            {access.method === 'meet_onsite' && access.meetOnsite && (
              <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Contact: </span>
                  <span className="font-semibold text-slate-800">
                    {access.meetOnsite.contactName} ({access.meetOnsite.contactPhone})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Relationship: </span>
                  <span className="font-semibold text-slate-800">{access.meetOnsite.relationship}</span>
                </div>
              </div>
            )}

            {access.method === 'keys_agency' && access.agencyKeys && (
              <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
                <div>
                  <span className="text-slate-400 font-medium">Agency &amp; Address: </span>
                  <span className="font-semibold text-slate-800">
                    {access.agencyKeys.agencyName} - {access.agencyKeys.collectionAddress}
                  </span>
                </div>
                {access.agencyKeys.keyReference && (
                  <div>
                    <span className="text-slate-400 font-medium">Key Reference: </span>
                    <span className="text-slate-800">{access.agencyKeys.keyReference}</span>
                  </div>
                )}
              </div>
            )}

            {access.method === 'lockbox' && access.lockbox && (
              <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
                <div>
                  <span className="text-slate-400 font-medium">Lockbox Location: </span>
                  <span className="font-semibold text-slate-800">{access.lockbox.location}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Combination Code: </span>
                  <span className="font-mono font-bold text-slate-800">•••• (Secured)</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. Special Instructions if present */}
        {access.specialInstructions && (
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 mb-2">
              <FileText className="w-4 h-4 text-[#006D70]" />
              <h3 className="font-bold text-sm text-[#1A2B4A] uppercase tracking-wider">
                Special Instructions
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {access.specialInstructions}
            </p>
          </div>
        )}
      </div>

      {/* Mandatory Acknowledgement Checkbox */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isAcknowledged}
            onChange={(e) => setIsAcknowledged(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded text-[#006D70] focus:ring-[#00B5B8] border-slate-300"
          />
          <span className="text-xs sm:text-sm text-slate-700 font-medium leading-snug">
            I confirm that the information provided is correct and that appropriate access arrangements have been made for the appointment.
          </span>
        </label>
      </div>

      {/* Navigation & Submit Bar */}
      <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => onJumpToStep('appointment')}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-[#1A2B4A] hover:bg-slate-100 rounded-lg transition-colors w-full sm:w-auto justify-center"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Appointment Selection</span>
        </button>

        <button
          type="submit"
          disabled={!isAcknowledged || isSubmitting}
          className={`inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-lg font-bold text-base transition-all w-full sm:w-auto ${
            isAcknowledged && !isSubmitting
              ? 'bg-[#007F82] hover:bg-[#006D70] text-white shadow-sm cursor-pointer'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Confirming with Google Calendar...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              <span>Confirm booking</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
