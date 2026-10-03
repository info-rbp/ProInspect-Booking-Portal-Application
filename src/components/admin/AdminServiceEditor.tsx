import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  HelpCircle,
  Home,
  KeyRound,
  LogOut,
  Save,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type {
  InspectionService,
  ServiceAdminInput,
  ServiceCategory,
} from '../../types/booking';

interface AdminServiceEditorProps {
  service: InspectionService | null;
  suggestedOrder: number;
  onClose: () => void;
  onSave: (input: ServiceAdminInput) => Promise<void>;
}

const CATEGORY_OPTIONS: Array<{ value: ServiceCategory; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'strata-building', label: 'Strata / Building' },
];

const ICON_OPTIONS = [
  { value: 'ClipboardCheck', label: 'Inspection', icon: ClipboardCheck },
  { value: 'FileSpreadsheet', label: 'Report', icon: FileSpreadsheet },
  { value: 'LogOut', label: 'Exit', icon: LogOut },
  { value: 'Building2', label: 'Building', icon: Building2 },
  { value: 'Wrench', label: 'Maintenance', icon: Wrench },
  { value: 'Users', label: 'Meeting', icon: Users },
  { value: 'ShieldCheck', label: 'Management', icon: ShieldCheck },
  { value: 'HelpCircle', label: 'General', icon: HelpCircle },
  { value: 'KeyRound', label: 'Keys', icon: KeyRound },
  { value: 'CalendarClock', label: 'Appointment', icon: CalendarClock },
  { value: 'Home', label: 'Residential', icon: Home },
  { value: 'Briefcase', label: 'Commercial', icon: Briefcase },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function initialValues(
  service: InspectionService | null,
  suggestedOrder: number
): ServiceAdminInput {
  if (service) {
    return {
      id: service.id,
      name: service.name,
      publicDescription: service.publicDescription,
      categories: service.categories || [],
      duration: service.duration,
      bufferBefore: service.bufferBefore,
      bufferAfter: service.bufferAfter,
      minimumNoticeHours: service.minimumNoticeHours,
      maxFutureBookingDays: service.maxFutureBookingDays,
      calendarId: service.calendarId || '',
      active: service.active,
      publiclyBookable: service.publiclyBookable,
      order: service.order,
      iconName: service.iconName || 'ClipboardCheck',
      badge: service.badge || '',
    };
  }

  return {
    id: '',
    name: '',
    publicDescription: '',
    categories: ['residential'],
    duration: 45,
    bufferBefore: 15,
    bufferAfter: 15,
    minimumNoticeHours: 24,
    maxFutureBookingDays: 60,
    calendarId: '',
    active: true,
    publiclyBookable: true,
    order: suggestedOrder,
    iconName: 'ClipboardCheck',
    badge: '',
  };
}

const fieldClass =
  'w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:border-[#007F82] focus:ring-2 focus:ring-[#00B5B8]/15 disabled:bg-slate-100 disabled:text-slate-500';

export const AdminServiceEditor: React.FC<AdminServiceEditorProps> = ({
  service,
  suggestedOrder,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<ServiceAdminInput>(() =>
    initialValues(service, suggestedOrder)
  );
  const [idManuallyEdited, setIdManuallyEdited] = useState(Boolean(service));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedIcon = useMemo(
    () =>
      ICON_OPTIONS.find((option) => option.value === form.iconName) ||
      ICON_OPTIONS[0],
    [form.iconName]
  );
  const SelectedIcon = selectedIcon.icon;

  const update = <K extends keyof ServiceAdminInput>(
    key: K,
    value: ServiceAdminInput[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleNameChange = (name: string) => {
    setForm((current) => ({
      ...current,
      name,
      id:
        service || idManuallyEdited
          ? current.id
          : slugify(name),
    }));
  };

  const validate = (): string | null => {
    if (form.name.trim().length < 2) {
      return 'Enter a service name.';
    }
    if (form.publicDescription.trim().length < 10) {
      return 'Enter a customer-facing description of at least 10 characters.';
    }
    if (!form.categories || form.categories.length === 0) {
      return 'Select at least one service category.';
    }
    if (!form.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.id)) {
      return 'Service ID must contain only lowercase letters, numbers and hyphens.';
    }
    if (form.duration < 15 || form.duration > 480 || form.duration % 15 !== 0) {
      return 'Duration must be between 15 and 480 minutes in 15-minute increments.';
    }
    if (
      form.bufferBefore < 0 ||
      form.bufferAfter < 0 ||
      form.bufferBefore % 5 !== 0 ||
      form.bufferAfter % 5 !== 0
    ) {
      return 'Buffers must be zero or more and use 5-minute increments.';
    }
    if (form.minimumNoticeHours < 0 || form.minimumNoticeHours > 720) {
      return 'Minimum notice must be between 0 and 720 hours.';
    }
    if (form.maxFutureBookingDays < 1 || form.maxFutureBookingDays > 365) {
      return 'Booking horizon must be between 1 and 365 days.';
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        ...form,
        id: form.id?.trim(),
        name: form.name.trim(),
        publicDescription: form.publicDescription.trim(),
        badge: form.badge?.trim() || undefined,
        calendarId: form.calendarId?.trim() || undefined,
      });
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save this service.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[94vh] overflow-hidden flex flex-col">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E6F8F8] text-[#006D70] flex items-center justify-center">
              <SelectedIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#1A2B4A]">
                {service ? 'Edit Booking Service' : 'Add Booking Service'}
              </h2>
              <p className="text-xs text-slate-500">
                Scheduling rules are enforced by the server for every booking.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"
            aria-label="Close service editor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto">
          <div className="p-5 sm:p-6 space-y-6">
            {error && (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-black text-[#1A2B4A]">Service details</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  These details are shown to customers in the booking portal.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Service name</span>
                  <input
                    className={fieldClass}
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    maxLength={100}
                    required
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Service ID</span>
                  <input
                    className={fieldClass}
                    value={form.id || ''}
                    disabled={Boolean(service)}
                    onChange={(e) => {
                      setIdManuallyEdited(true);
                      update('id', slugify(e.target.value));
                    }}
                    maxLength={64}
                    required
                  />
                  <span className="text-[11px] text-slate-400 block">
                    Permanent identifier. It cannot be changed after creation.
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700">Service categories</span>
                <p className="text-[11px] text-slate-500">
                  Choose every booking category where this service should appear.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {CATEGORY_OPTIONS.map((option) => {
                    const checked = form.categories?.includes(option.value) ?? false;
                    return (
                      <label
                        key={option.value}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold cursor-pointer ${
                          checked
                            ? 'border-[#00B5B8] bg-[#F0FBFB] text-[#1A2B4A]'
                            : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const current = form.categories || [];
                            const categories = e.target.checked
                              ? [...current, option.value]
                              : current.filter((category) => category !== option.value);
                            update('categories', categories);
                          }}
                          className="accent-[#007F82]"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="space-y-1.5 block">
                <span className="text-xs font-bold text-slate-700">Public description</span>
                <textarea
                  className="w-full min-h-24 px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:border-[#007F82] focus:ring-2 focus:ring-[#00B5B8]/15 resize-y"
                  value={form.publicDescription}
                  onChange={(e) => update('publicDescription', e.target.value)}
                  maxLength={500}
                  required
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Icon</span>
                  <select
                    className={fieldClass}
                    value={form.iconName || 'ClipboardCheck'}
                    onChange={(e) => update('iconName', e.target.value)}
                  >
                    {ICON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Badge</span>
                  <input
                    className={fieldClass}
                    value={form.badge || ''}
                    onChange={(e) => update('badge', e.target.value)}
                    placeholder="Optional"
                    maxLength={40}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-700">Display order</span>
                  <input
                    type="number"
                    className={fieldClass}
                    value={form.order || suggestedOrder}
                    disabled
                    readOnly
                  />
                  <span className="text-[11px] text-slate-400 block">
                    Use the arrow controls on the Services page to reorder.
                  </span>
                </label>
              </div>
            </section>

            <section className="space-y-4 pt-5 border-t border-slate-200">
              <div>
                <h3 className="text-sm font-black text-[#1A2B4A]">Scheduling rules</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Customers cannot override these values from the browser.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Duration</span>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    step={15}
                    className={fieldClass}
                    value={form.duration}
                    onChange={(e) => update('duration', Number(e.target.value))}
                  />
                  <span className="text-[10px] text-slate-400">minutes</span>
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Buffer before</span>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    step={5}
                    className={fieldClass}
                    value={form.bufferBefore}
                    onChange={(e) => update('bufferBefore', Number(e.target.value))}
                  />
                  <span className="text-[10px] text-slate-400">minutes</span>
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Buffer after</span>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    step={5}
                    className={fieldClass}
                    value={form.bufferAfter}
                    onChange={(e) => update('bufferAfter', Number(e.target.value))}
                  />
                  <span className="text-[10px] text-slate-400">minutes</span>
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Minimum notice</span>
                  <input
                    type="number"
                    min={0}
                    max={720}
                    className={fieldClass}
                    value={form.minimumNoticeHours}
                    onChange={(e) =>
                      update('minimumNoticeHours', Number(e.target.value))
                    }
                  />
                  <span className="text-[10px] text-slate-400">hours</span>
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700">Book ahead</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={fieldClass}
                    value={form.maxFutureBookingDays}
                    onChange={(e) =>
                      update('maxFutureBookingDays', Number(e.target.value))
                    }
                  />
                  <span className="text-[10px] text-slate-400">days</span>
                </label>
              </div>

              <label className="space-y-1.5 block">
                <span className="text-xs font-bold text-slate-700">
                  Service-specific ProInspect calendar ID
                </span>
                <input
                  className={fieldClass}
                  value={form.calendarId || ''}
                  onChange={(e) => update('calendarId', e.target.value)}
                  placeholder="Leave blank to use the default ProInspect Property Services calendar"
                  maxLength={256}
                />
                <span className="text-[11px] text-slate-400 block">
                  Only set this when a service should use a different Calendar from the default production calendar.
                </span>
              </label>
            </section>

            <section className="space-y-3 pt-5 border-t border-slate-200">
              <h3 className="text-sm font-black text-[#1A2B4A]">Availability</h3>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => update('active', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#007F82]"
                />
                <span>
                  <strong className="text-sm text-slate-800 block">Active service</strong>
                  <span className="text-xs text-slate-500">
                    Inactive services remain in Firestore and historical bookings but cannot be booked.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                <input
                  type="checkbox"
                  checked={form.publiclyBookable}
                  onChange={(e) => update('publiclyBookable', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#007F82]"
                />
                <span>
                  <strong className="text-sm text-slate-800 block">
                    Publicly bookable
                  </strong>
                  <span className="text-xs text-slate-500">
                    Turn this off for internal or client-only services that should not appear on the public booking page.
                  </span>
                </span>
              </label>
            </section>
          </div>

          <div className="px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              Existing bookings keep their original service name, duration and buffers.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold bg-[#007F82] hover:bg-[#006D70] text-white disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving...' : 'Save Service'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
