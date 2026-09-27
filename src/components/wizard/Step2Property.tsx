import React, { useState } from 'react';
import { PropertyDetails, PropertyType } from '../../types/booking';
import {
  isValidAustralianPostcode,
  isValidAustralianPhone,
  isValidEmail,
  POPULAR_WA_SUBURBS,
  AUSTRALIAN_STATES,
} from '../../utils/australianValidation';
import { MapPin, User, Mail, Phone, Building, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react';

interface Step2PropertyProps {
  initialData: PropertyDetails;
  onUpdate: (data: PropertyDetails) => void;
  onNext: () => void;
  onBack: () => void;
}

const PROPERTY_TYPES: PropertyType[] = [
  'House',
  'Apartment / Unit',
  'Townhouse',
  'Commercial',
  'Retail',
  'Office',
  'Industrial',
  'Strata / Common Property',
  'Other',
];

export const Step2Property: React.FC<Step2PropertyProps> = ({
  initialData,
  onUpdate,
  onNext,
  onBack,
}) => {
  const [formData, setFormData] = useState<PropertyDetails>({
    streetAddress: initialData.streetAddress || '',
    unit: initialData.unit || '',
    suburb: initialData.suburb || '',
    state: initialData.state || 'WA',
    postcode: initialData.postcode || '',
    propertyType: initialData.propertyType || 'House',
    clientName: initialData.clientName || '',
    clientReference: initialData.clientReference || '',
    customerName: initialData.customerName || '',
    customerEmail: initialData.customerEmail || '',
    customerPhone: initialData.customerPhone || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateField = (name: keyof PropertyDetails, value: string): string => {
    switch (name) {
      case 'streetAddress':
        return !value.trim() ? 'Street address is required.' : '';
      case 'suburb':
        return !value.trim() ? 'Suburb is required.' : '';
      case 'postcode':
        if (!value.trim()) return 'Postcode is required.';
        if (!isValidAustralianPostcode(value)) return 'Enter a valid 4-digit Australian postcode (e.g. 6105).';
        return '';
      case 'customerName':
        return !value.trim() ? 'Contact name is required.' : '';
      case 'customerEmail':
        if (!value.trim()) return 'Email address is required.';
        if (!isValidEmail(value)) return 'Please enter a valid email address.';
        return '';
      case 'customerPhone':
        if (!value.trim()) return 'Mobile number is required.';
        if (!isValidAustralianPhone(value)) return 'Enter a valid Australian mobile or landline number (e.g. 0400 000 000).';
        return '';
      default:
        return '';
    }
  };

  const handleChange = (name: keyof PropertyDetails, value: string) => {
    const updated = { ...formData, [name]: value };
    setFormData(updated);
    onUpdate(updated);

    if (touched[name]) {
      const err = validateField(name, value);
      setErrors((prev) => ({ ...prev, [name]: err }));
    }
  };

  const handleBlur = (name: keyof PropertyDetails) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const err = validateField(name, formData[name] || '');
    setErrors((prev) => ({ ...prev, [name]: err }));
  };

  const handleSelectSuburb = (suburb: string) => {
    const updated = { ...formData, suburb };
    // Suggest standard postcodes for common Perth suburbs if empty
    if (suburb === 'Cloverdale' && !formData.postcode) updated.postcode = '6105';
    if (suburb === 'Perth' && !formData.postcode) updated.postcode = '6000';
    if (suburb === 'Victoria Park' && !formData.postcode) updated.postcode = '6100';

    setFormData(updated);
    onUpdate(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {
      streetAddress: validateField('streetAddress', formData.streetAddress),
      suburb: validateField('suburb', formData.suburb),
      postcode: validateField('postcode', formData.postcode),
      customerName: validateField('customerName', formData.customerName),
      customerEmail: validateField('customerEmail', formData.customerEmail),
      customerPhone: validateField('customerPhone', formData.customerPhone),
    };

    setErrors(newErrors);
    setTouched({
      streetAddress: true,
      suburb: true,
      postcode: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
    });

    const hasErrors = Object.values(newErrors).some((msg) => Boolean(msg));
    if (!hasErrors) {
      onNext();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A] tracking-tight">
          Property details
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600">
          Tell us where the service is required.
        </p>
      </div>

      {/* Section 1: Property Location */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <MapPin className="w-5 h-5 text-[#006D70]" />
          <h2 className="font-bold text-base text-[#1A2B4A]">Property Address</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Unit / Suite / Lot <span className="text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Unit 4, Lot 12"
              value={formData.unit || ''}
              onChange={(e) => handleChange('unit', e.target.value)}
              className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20 outline-none transition-all"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Street Address <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 27 Example Street"
              value={formData.streetAddress}
              onChange={(e) => handleChange('streetAddress', e.target.value)}
              onBlur={() => handleBlur('streetAddress')}
              className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                errors.streetAddress && touched.streetAddress
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                  : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
              }`}
            />
            {errors.streetAddress && touched.streetAddress && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.streetAddress}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Suburb <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Cloverdale"
              value={formData.suburb}
              onChange={(e) => handleChange('suburb', e.target.value)}
              onBlur={() => handleBlur('suburb')}
              className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                errors.suburb && touched.suburb
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                  : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
              }`}
            />
            {errors.suburb && touched.suburb && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.suburb}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              State <span className="text-rose-500">*</span>
            </label>
            <select
              value={formData.state}
              onChange={(e) => handleChange('state', e.target.value)}
              className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20 outline-none transition-all font-medium"
            >
              {AUSTRALIAN_STATES.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name} ({st.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Postcode <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              maxLength={4}
              placeholder="e.g. 6105"
              value={formData.postcode}
              onChange={(e) => handleChange('postcode', e.target.value)}
              onBlur={() => handleBlur('postcode')}
              className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                errors.postcode && touched.postcode
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                  : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
              }`}
            />
            {errors.postcode && touched.postcode && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.postcode}
              </p>
            )}
          </div>
        </div>

        {/* Popular WA suburbs quick chips */}
        <div className="pt-1">
          <span className="text-[11px] text-slate-500 font-semibold mr-2">Quick WA Suburbs:</span>
          <div className="inline-flex flex-wrap gap-1.5 mt-1">
            {POPULAR_WA_SUBURBS.slice(0, 7).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => handleSelectSuburb(sub)}
                className="text-xs px-2.5 py-1 rounded bg-slate-100 hover:bg-sky-50 hover:text-[#006D70] text-slate-700 transition-colors"
              >
                {sub}
              </button>
            ))}
          </div>
        </div>

        {/* Property Type Selection */}
        <div className="pt-2">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Property Type <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PROPERTY_TYPES.map((type) => {
              const isSelected = formData.propertyType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChange('propertyType', type)}
                  className={`text-xs sm:text-sm font-medium py-2.5 px-3 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'border-[#00B5B8] bg-[#F0FBFB] text-[#1A2B4A] font-bold ring-1 ring-[#00B5B8]'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: Client / Agency Reference (Optional) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Building className="w-5 h-5 text-[#006D70]" />
          <div>
            <h2 className="font-bold text-base text-[#1A2B4A]">Agency / Client Reference</h2>
            <span className="text-xs text-slate-500">Optional for real estate agencies or landlords</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Client or Agency Name <span className="text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Ray White, Acton | Belle, Private"
              value={formData.clientName || ''}
              onChange={(e) => handleChange('clientName', e.target.value)}
              className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Client or Property Reference <span className="text-slate-400 font-normal lowercase">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. File #, Key Tag, or Work Order ID"
              value={formData.clientReference || ''}
              onChange={(e) => handleChange('clientReference', e.target.value)}
              className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* Section 3: Customer / Booking Contact */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <User className="w-5 h-5 text-[#006D70]" />
          <div>
            <h2 className="font-bold text-base text-[#1A2B4A]">Booking Contact Details</h2>
            <span className="text-xs text-slate-500">
              Who should receive the calendar invitation and inspection confirmation?
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Contact Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. Sarah Jones"
                value={formData.customerName}
                onChange={(e) => handleChange('customerName', e.target.value)}
                onBlur={() => handleBlur('customerName')}
                className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                  errors.customerName && touched.customerName
                    ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                    : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
                }`}
              />
            </div>
            {errors.customerName && touched.customerName && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.customerName}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Email Address <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="email"
                placeholder="e.g. sarah@example.com.au"
                value={formData.customerEmail}
                onChange={(e) => handleChange('customerEmail', e.target.value)}
                onBlur={() => handleBlur('customerEmail')}
                className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                  errors.customerEmail && touched.customerEmail
                    ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                    : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
                }`}
              />
            </div>
            {errors.customerEmail && touched.customerEmail && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.customerEmail}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mobile Number <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="tel"
                placeholder="e.g. 0400 000 000"
                value={formData.customerPhone}
                onChange={(e) => handleChange('customerPhone', e.target.value)}
                onBlur={() => handleBlur('customerPhone')}
                className={`w-full h-11 px-3.5 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                  errors.customerPhone && touched.customerPhone
                    ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                    : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
                }`}
              />
            </div>
            {errors.customerPhone && touched.customerPhone && (
              <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.customerPhone}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="pt-4 flex items-center justify-between border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-[#1A2B4A] hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Services</span>
        </button>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-[#007F82] hover:bg-[#006D70] text-white shadow-xs transition-colors cursor-pointer"
        >
          <span>Continue to Property Access</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
};
