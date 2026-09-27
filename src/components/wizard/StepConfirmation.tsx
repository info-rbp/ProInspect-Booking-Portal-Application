import React, { useState } from 'react';
import { BookingRecord } from '../../types/booking';
import {
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  Mail,
  KeyRound,
  Copy,
  Check,
  ExternalLink,
  Printer,
  RotateCcw,
} from 'lucide-react';

interface StepConfirmationProps {
  booking: BookingRecord;
  onReset: () => void;
}

export const StepConfirmation: React.FC<StepConfirmationProps> = ({ booking, onReset }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyRef = () => {
    navigator.clipboard.writeText(booking.bookingReference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const unitPrefix = booking.property.unit ? `${booking.property.unit}, ` : '';
  const fullAddress = `${unitPrefix}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`;

  return (
    <div className="space-y-8 animate-fadeIn max-w-2xl mx-auto">
      {/* Success Banner */}
      <div className="text-center space-y-3 pt-4">
        <div className="w-16 h-16 bg-emerald-100 text-[#059669] rounded-2xl flex items-center justify-center mx-auto shadow-xs">
          <CheckCircle2 className="w-10 h-10 stroke-[2.2]" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-[#0A2540] tracking-tight">
          Booking confirmed
        </h1>
        <p className="text-sm sm:text-base text-slate-600 max-w-md mx-auto">
          Your inspection appointment has been successfully scheduled and synced to the ProInspect calendar.
        </p>
      </div>

      {/* Booking Reference Box */}
      <div className="bg-[#0A2540] text-white rounded-xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300 block">
            ProInspect Booking Reference
          </span>
          <span className="font-mono text-xl sm:text-2xl font-black tracking-wide text-white">
            {booking.bookingReference}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyRef}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white rounded-lg transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Copied' : 'Copy Reference'}</span>
        </button>
      </div>

      {/* Booking Summary Card */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-[#0A2540] uppercase tracking-wider border-b border-slate-100 pb-3">
          Appointment &amp; Attendance Details
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium block">Service:</span>
            <span className="font-bold text-[#0A2540]">{booking.serviceName}</span>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium block">Scheduled Time:</span>
            <span className="font-bold text-[#0A2540] flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-[#0284C7]" />
              {booking.appointment.dateString} at {booking.appointment.timeString} AWST
            </span>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <span className="text-xs text-slate-400 font-medium block">Property Address:</span>
            <span className="font-semibold text-slate-800 flex items-start gap-1.5">
              <MapPin className="w-4 h-4 text-[#0284C7] shrink-0 mt-0.5" />
              {fullAddress}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium block">Access Method:</span>
            <span className="font-semibold text-slate-800 flex items-center gap-1.5 capitalize">
              <KeyRound className="w-4 h-4 text-[#0284C7]" />
              {booking.access.method.replace('_', ' ')}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium block">Attendee Contact Email:</span>
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-[#0284C7]" />
              {booking.property.customerEmail}
            </span>
          </div>
        </div>

        {/* Notice of Calendar Invite */}
        <div className="p-3.5 bg-sky-50 border border-sky-100 rounded-lg text-xs text-[#0369A1] font-medium flex items-center gap-2">
          <Mail className="w-4 h-4 shrink-0" />
          <span>A calendar invitation has been sent to the email address provided.</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <a
          href="https://proinspect.systems"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-[#0A2540] hover:bg-[#13355C] text-white shadow-xs transition-colors"
        >
          <span>Return to ProInspect</span>
          <ExternalLink className="w-4 h-4" />
        </a>

        <button
          type="button"
          onClick={onReset}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-[#0284C7] hover:bg-[#0369A1] text-white shadow-xs transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Make another booking</span>
        </button>

        <button
          type="button"
          onClick={handlePrint}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-sm border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
        >
          <Printer className="w-4 h-4" />
          <span>Print Summary</span>
        </button>
      </div>
    </div>
  );
};
