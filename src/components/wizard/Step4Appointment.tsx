import React, { useState, useEffect } from 'react';
import { InspectionService, AppointmentSlot } from '../../types/booking';
import { fetchAvailability } from '../../services/api';
import { formatAustralianDate, formatAustralianTime, getPerthDateKey } from '../../utils/dateTime';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  CalendarCheck,
} from 'lucide-react';

interface Step4AppointmentProps {
  service: InspectionService;
  selectedSlot: AppointmentSlot | null;
  onSelectSlot: (slot: AppointmentSlot) => void;
  onNext: () => void;
  onBack: () => void;
}

export const Step4Appointment: React.FC<Step4AppointmentProps> = ({
  service,
  selectedSlot,
  onSelectSlot,
  onNext,
  onBack,
}) => {
  // Calendar month state
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    // Current time in Perth
    return new Date();
  });

  // Selected date key: YYYY-MM-DD
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => {
    if (selectedSlot?.dateKey) return selectedSlot.dateKey;
    // Default to next available business day (e.g. tomorrow or next Monday)
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    // If weekend, advance to Monday
    if (nextDay.getDay() === 0) nextDay.setDate(nextDay.getDate() + 1);
    if (nextDay.getDay() === 6) nextDay.setDate(nextDay.getDate() + 2);
    return getPerthDateKey(nextDay);
  });

  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState<boolean>(false);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch availability when selectedDateKey or service changes
  useEffect(() => {
    let isCancelled = false;

    async function loadSlots() {
      if (!selectedDateKey) return;
      setIsLoadingSlots(true);
      setFetchError(null);
      setEmptyMessage(null);

      try {
        const result = await fetchAvailability(
          selectedDateKey,
          service.duration,
          service.bufferBefore || 15,
          service.bufferAfter || 15
        );

        if (!isCancelled) {
          setSlots(result.slots || []);
          if (result.slots.length === 0) {
            setEmptyMessage(
              result.message ||
                'No appointments are available on this date. Please choose another date.'
            );
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load slots:', err);
          setFetchError('Unable to connect to Google Calendar scheduling engine.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSlots(false);
        }
      }
    }

    loadSlots();

    return () => {
      isCancelled = true;
    };
  }, [selectedDateKey, service.duration, service.bufferBefore, service.bufferAfter]);

  // Month navigation
  const handlePrevMonth = () => {
    setCurrentMonthDate((prev) => {
      const copy = new Date(prev);
      copy.setMonth(copy.getMonth() - 1);
      return copy;
    });
  };

  const handleNextMonth = () => {
    setCurrentMonthDate((prev) => {
      const copy = new Date(prev);
      copy.setMonth(copy.getMonth() + 1);
      return copy;
    });
  };

  // Build calendar matrix
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth(); // 0-indexed

  const monthName = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(currentMonthDate);

  // First day of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  // Adjust so Monday is 0 and Sunday is 6 for Australian working week
  const startDayOffset = (firstDayOfMonth + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const daysArray: Array<{ dayNum: number; dateKey: string; isPast: boolean; isWeekend: boolean }> = [];
  const todayKey = getPerthDateKey(new Date());

  for (let d = 1; d <= daysInMonth; d++) {
    const padMonth = String(month + 1).padStart(2, '0');
    const padDay = String(d).padStart(2, '0');
    const dateKey = `${year}-${padMonth}-${padDay}`;

    const dateObj = new Date(year, month, d);
    const dayOfWeek = dateObj.getDay(); // 0 is Sun, 6 is Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = dateKey < todayKey;

    daysArray.push({
      dayNum: d,
      dateKey,
      isPast,
      isWeekend,
    });
  }

  const selectedDateFormatted = selectedDateKey
    ? formatAustralianDate(new Date(`${selectedDateKey}T12:00:00+08:00`))
    : '';

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0A2540] tracking-tight">
          Choose an appointment
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600">
          Select a convenient inspection date and available time slot in Australia/Perth (AWST).
        </p>
      </div>

      {/* Two Column Layout: Left Calendar, Right Available Times */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Date Selector (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#0284C7]" />
              <h2 className="font-bold text-base text-[#0A2540] capitalize">{monthName}</h2>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Days of week header (Mon-Sun Australian style) */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dw, i) => (
              <span
                key={dw}
                className={`text-[11px] font-bold uppercase tracking-wider py-1.5 ${
                  i >= 5 ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {dw}
              </span>
            ))}

            {/* Empty offset padding for days before the 1st */}
            {Array.from({ length: startDayOffset }).map((_, idx) => (
              <div key={`offset-${idx}`} className="h-10" />
            ))}

            {/* Days in Month */}
            {daysArray.map((day) => {
              const isSelected = day.dateKey === selectedDateKey;
              const isDisabled = day.isPast || day.isWeekend;

              return (
                <button
                  key={day.dateKey}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setSelectedDateKey(day.dateKey)}
                  className={`h-10 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-[#0284C7] text-white shadow-xs font-bold ring-2 ring-sky-200'
                      : isDisabled
                      ? 'text-slate-300 bg-transparent cursor-not-allowed'
                      : 'text-[#0A2540] hover:bg-slate-100 cursor-pointer'
                  }`}
                >
                  {day.dayNum}
                </button>
              );
            })}
          </div>

          {/* Legend & Operating Notice */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] text-slate-500 gap-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0284C7]" />
              Selected Date
            </span>
            <span>Operating: Mon 8am-5pm &bull; Tue-Fri 8am-4pm</span>
          </div>
        </div>

        {/* Right Column: Time Slots (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#0284C7]" />
              <h3 className="font-bold text-sm text-[#0A2540]">Available Times</h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{selectedDateFormatted}</p>
          </div>

          {/* Slots Content State */}
          {isLoadingSlots ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <Loader2 className="w-6 h-6 text-[#0284C7] animate-spin" />
              <span className="text-xs font-semibold text-slate-600">
                Checking Google Calendar availability...
              </span>
            </div>
          ) : fetchError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle className="w-4 h-4" />
                <span>Scheduling Notice</span>
              </div>
              <p>{fetchError}</p>
            </div>
          ) : slots.length === 0 ? (
            <div className="py-10 text-center px-4 bg-slate-50 rounded-lg border border-dashed border-slate-200 space-y-2">
              <CalendarCheck className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-xs font-medium text-slate-600">
                {emptyMessage || 'No appointments are available on this date. Please choose another date.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                {slots.length} available appointment{slots.length > 1 ? 's' : ''} ({service.duration} mins)
              </span>

              <div className="grid grid-cols-2 gap-2">
                {slots.map((slot) => {
                  const isSelected = selectedSlot?.start === slot.start;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      onClick={() => onSelectSlot(slot)}
                      className={`py-3 px-3 rounded-lg text-xs sm:text-sm font-semibold border text-center transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#0284C7] bg-[#0284C7] text-white shadow-xs font-bold ring-2 ring-sky-200'
                          : 'border-slate-200 bg-slate-50 text-[#0A2540] hover:bg-slate-100 hover:border-slate-300'
                      }`}
                    >
                      {slot.displayTime}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timezone Note */}
          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 text-center">
            All times displayed in Western Australia (AWST UTC+8)
          </div>
        </div>
      </div>

      {/* Selected Slot Confirmation Bar */}
      {selectedSlot && (
        <div className="bg-[#F0F9FF] border border-sky-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0284C7] text-white flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0A2540]">
                Proposed Appointment: {selectedSlot.displayDate} at {selectedSlot.displayTime}
              </div>
              <span className="text-xs text-slate-600">
                {service.name} &bull; Approx. {service.duration} minutes on site
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="pt-4 flex items-center justify-between border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-[#0A2540] hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Property Access</span>
        </button>

        <button
          type="button"
          disabled={!selectedSlot}
          onClick={onNext}
          className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm transition-all ${
            selectedSlot
              ? 'bg-[#0284C7] hover:bg-[#0369A1] text-white shadow-xs cursor-pointer'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span>Continue to Review &amp; Confirm</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
