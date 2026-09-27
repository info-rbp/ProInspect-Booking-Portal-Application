import React, { useState } from 'react';
import { BookingRecord, BookingStatus } from '../../types/booking';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  User,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  ExternalLink,
  Save,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Building,
  Phone,
  Mail,
} from 'lucide-react';

interface AdminWorkOrderDetailProps {
  booking: BookingRecord;
  onClose: () => void;
  onUpdateStatus: (id: string, status: BookingStatus, notes?: string) => Promise<void>;
}

export const AdminWorkOrderDetail: React.FC<AdminWorkOrderDetailProps> = ({
  booking,
  onClose,
  onUpdateStatus,
}) => {
  const [currentStatus, setCurrentStatus] = useState<BookingStatus>(booking.status);
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes || '');
  const [showLockboxCode, setShowLockboxCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      await onUpdateStatus(booking.id, currentStatus, adminNotes);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to update status:', err);
      setSaveError(err instanceof Error ? err.message : 'Unable to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const unitPrefix = booking.property.unit ? `${booking.property.unit}, ` : '';
  const fullAddress = `${unitPrefix}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 my-auto animate-fadeIn relative space-y-6">
        {/* Header bar */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xl sm:text-2xl font-black text-[#1A2B4A]">
                {booking.bookingReference}
              </span>
              <span
                className={`text-xs uppercase font-extrabold px-2.5 py-1 rounded-full ${
                  currentStatus === 'confirmed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : currentStatus === 'completed'
                    ? 'bg-sky-100 text-sky-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {currentStatus}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Operational Work Order &bull; Created: {new Date(booking.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Perth' })}
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Operational Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
          {/* Service & Schedule */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Inspection Attendance
            </span>
            <div className="font-bold text-[#1A2B4A] text-base">{booking.serviceName}</div>
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <Calendar className="w-4 h-4 text-[#006D70]" />
              <span>{booking.appointment.dateString}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <Clock className="w-4 h-4 text-[#006D70]" />
              <span>{booking.appointment.timeString} AWST ({booking.appointment.durationMinutes} mins)</span>
            </div>
          </div>

          {/* Property Location */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Property Location
            </span>
            <div className="font-bold text-[#1A2B4A] text-base flex items-start gap-1.5">
              <MapPin className="w-4 h-4 text-[#006D70] shrink-0 mt-1" />
              <span>{fullAddress}</span>
            </div>
            <div className="text-xs text-slate-600">
              Type: <strong className="text-slate-800">{booking.property.propertyType}</strong>
            </div>
            {booking.property.clientName && (
              <div className="text-xs text-slate-600">
                Agency: <strong className="text-slate-800">{booking.property.clientName}</strong>
                {booking.property.clientReference && ` (Ref: ${booking.property.clientReference})`}
              </div>
            )}
          </div>
        </div>

        {/* Access Arrangement & Codes */}
        <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#006D70]" />
              <h4 className="font-bold text-xs uppercase tracking-wider text-[#1A2B4A]">
                Access Arrangement ({booking.access.method.replace('_', ' ')})
              </h4>
            </div>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                (booking.readinessStatus || 'ready') === 'ready'
                  ? 'bg-emerald-100 text-emerald-700'
                  : booking.readinessStatus === 'pending_notice'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-rose-100 text-rose-700'
              }`}
            >
              {(booking.readinessStatus || 'ready') === 'ready'
                ? 'Ready'
                : booking.readinessStatus === 'pending_notice'
                  ? 'Pending notice'
                  : 'Access action required'}
            </span>
          </div>

          {/* Tenant Details */}
          {booking.access.method === 'tenant' && booking.access.tenant && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block">Tenant Name:</span>
                <span className="font-bold text-slate-800">{booking.access.tenant.tenantName}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Mobile:</span>
                <a
                  href={`tel:${booking.access.tenant.tenantPhone}`}
                  className="font-bold text-[#006D70] hover:underline"
                >
                  {booking.access.tenant.tenantPhone}
                </a>
              </div>
              <div>
                <span className="text-slate-400 block">Entry Notice:</span>
                <span
                  className={`font-bold ${
                    booking.access.tenant.noticeIssued === 'yes'
                      ? 'text-emerald-700'
                      : booking.access.tenant.noticeIssued === 'pending'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {booking.access.tenant.noticeIssued === 'yes'
                    ? 'Notice Issued'
                    : booking.access.tenant.noticeIssued === 'pending'
                      ? 'Notice Pending'
                      : 'Notice Not Issued'}
                  {booking.access.tenant.noticeDate ? ` on ${booking.access.tenant.noticeDate}` : ''}
                </span>
              </div>
              {booking.access.tenant.accessRestrictions && (
                <div className="sm:col-span-3 pt-1 text-slate-700">
                  <span className="text-slate-400 block">Instructions / Restrictions:</span>
                  <span className="font-medium">{booking.access.tenant.accessRestrictions}</span>
                </div>
              )}
            </div>
          )}

          {/* Lockbox Details with Security Reveal */}
          {booking.access.method === 'lockbox' && booking.access.lockbox && (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-400 block">Lockbox Location:</span>
                  <span className="font-semibold text-slate-800">{booking.access.lockbox.location}</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-100 p-2 rounded-lg border border-slate-200">
                  <span className="text-slate-500 font-medium">Safe Code:</span>
                  <span className="font-mono font-black text-sm text-[#1A2B4A]">
                    {showLockboxCode
                      ? booking.access.lockbox.code || 'Unavailable'
                      : '••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowLockboxCode(!showLockboxCode)}
                    className="text-slate-500 hover:text-slate-800"
                    title={showLockboxCode ? 'Hide Code' : 'Reveal Code'}
                  >
                    {showLockboxCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {booking.access.lockbox.instructions && (
                <div className="text-slate-600">
                  <span>Instructions: {booking.access.lockbox.instructions}</span>
                </div>
              )}
            </div>
          )}

          {booking.access.method === 'vacant' && booking.access.vacant && (
            <div className="text-xs space-y-1 text-slate-700">
              <div>
                <span className="text-slate-400 block">Access Instructions:</span>
                <span className="font-semibold">{booking.access.vacant.accessInstructions}</span>
              </div>
              {booking.access.vacant.securityAlarm && (
                <div className="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-200">
                  <span className="text-rose-600 block font-bold">Security Alarm Details:</span>
                  <span className="font-mono text-rose-900">
                    {booking.access.vacant.securityAlarm}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Agency Keys Details */}
          {booking.access.method === 'keys_agency' && booking.access.agencyKeys && (
            <div className="text-xs space-y-1 text-slate-700">
              <div>
                Agency: <strong>{booking.access.agencyKeys.agencyName}</strong>
              </div>
              <div>
                Collection Address: <strong>{booking.access.agencyKeys.collectionAddress}</strong>
              </div>
              {booking.access.agencyKeys.keyReference && (
                <div>
                  Key Tag: <strong>{booking.access.agencyKeys.keyReference}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Special Attendance Instructions */}
        {booking.access.specialInstructions && (
          <div className="bg-amber-50/60 border border-amber-200 p-4 rounded-xl space-y-1">
            <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Special Attendance &amp; Property Notes
            </span>
            <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line">
              {booking.access.specialInstructions}
            </p>
          </div>
        )}

        {/* Google Calendar Link & Event Reference */}
        <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#006D70]" />
            <span className="text-slate-600">
              Google Calendar Event ID: <code className="font-mono text-slate-800">{booking.calendarEventId || 'Not available'}</code>
            </span>
          </div>

          {booking.calendarHtmlLink ? (
            <a
              href={booking.calendarHtmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-[#006D70] hover:underline"
            >
              <span>Open Calendar Event</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <span className="text-slate-400">Calendar event link unavailable</span>
          )}
        </div>

        {/* Status Switcher & Inspector Operational Notes */}
        <div className="space-y-3 pt-2 border-t border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Work Order Status
              </label>
              <select
                value={currentStatus}
                disabled={booking.status === 'cancelled'}
                onChange={(e) => setCurrentStatus(e.target.value as BookingStatus)}
                className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs font-bold text-[#1A2B4A] outline-none disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {booking.status === 'cancelled' && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Cancelled bookings cannot be reactivated. Create a new booking instead.
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Inspector Operational Notes
              </label>
              <input
                type="text"
                placeholder="Internal inspector notes or key return verification..."
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 outline-none"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2">
            <span className={`text-xs font-semibold ${saveError ? 'text-rose-600' : 'text-emerald-600'}`}>
              {saveError || (saveSuccess ? 'Changes saved successfully!' : '')}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Close
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-[#007F82] hover:bg-[#006D70] text-white rounded-lg shadow-xs cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Updates'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
