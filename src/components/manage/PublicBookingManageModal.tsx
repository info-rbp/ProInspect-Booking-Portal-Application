import React, { useState } from 'react';
import { fetchBookingByToken } from '../../services/api';
import { Search, X, Calendar, MapPin, KeyRound, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

interface PublicBookingManageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PublicBookingManageModal: React.FC<PublicBookingManageModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [tokenOrRef, setTokenOrRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<any | null>(null);

  if (!isOpen) return null;

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenOrRef.trim()) return;

    setLoading(true);
    setError(null);
    setBooking(null);

    try {
      const data = await fetchBookingByToken(tokenOrRef.trim());
      setBooking(data);
    } catch (err: any) {
      setError('No matching booking was found for that secure management code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-fadeIn relative space-y-5">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-xl font-bold text-[#1A2B4A]">Manage Booking</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Open your booking using the secure management code supplied with your confirmation.
          </p>
        </div>

        {/* Lookup form */}
        <form onSubmit={handleLookup} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Secure management code"
              value={tokenOrRef}
              onChange={(e) => setTokenOrRef(e.target.value)}
              className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] font-mono focus:bg-white focus:border-[#00B5B8] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 h-11 bg-[#00B5B8] hover:bg-[#008B8E] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Lookup</span>
          </button>
        </form>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Found booking details */}
        {booking && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="font-mono font-bold text-[#1A2B4A] text-sm">
                {booking.bookingReference}
              </span>
              <span className="capitalize font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">
                {booking.status}
              </span>
            </div>

            <div className="space-y-1.5 text-slate-700">
              <div className="font-bold text-[#1A2B4A] text-sm">{booking.serviceName}</div>
              <div className="flex items-center gap-1.5 text-slate-800">
                <Calendar className="w-3.5 h-3.5 text-[#00B5B8]" />
                <span>{booking.appointment.dateString} at {booking.appointment.timeString} AWST</span>
              </div>
              <div className="flex items-start gap-1.5 text-slate-800">
                <MapPin className="w-3.5 h-3.5 text-[#00B5B8] shrink-0 mt-0.5" />
                <span>
                  {booking.property.unit ? `${booking.property.unit}, ` : ''}{booking.property.streetAddress}, {booking.property.suburb} {booking.property.state}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                <span>Access: {booking.access.method.replace('_', ' ')}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              Need to reschedule or cancel? Contact ProInspect at{' '}
              <a href="mailto:info@proinspect.systems" className="font-semibold text-[#00B5B8] underline">
                info@proinspect.systems
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
