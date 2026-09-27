import React, { useEffect, useState } from 'react';
import {
  AddressSuggestion,
  PropertyDetails,
  PropertyType,
} from '../../types/booking';
import {
  fetchAddressSuggestions,
  validateAddress,
} from '../../services/api';
import {
  isValidAustralianPostcode,
  isValidAustralianPhone,
  isValidEmail,
  POPULAR_WA_SUBURBS,
  AUSTRALIAN_STATES,
} from '../../utils/australianValidation';
import {
  MapPin,
  User,
  Mail,
  Phone,
  Building,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

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
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [isValidatingAddress, setIsValidatingAddress] = useState(false);
  const [addressVerificationMessage, setAddressVerificationMessage] = useState<string | null>(
    initialData.addressVerification?.status === 'verified'
      ? 'Address verified by Google Maps.'
      : null
  );

  useEffect(() => {
    const input = formData.streetAddress.trim();

    if (
      input.length < 3 ||
      formData.addressVerification?.status === 'verified'
    ) {
      setAddressSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsSearchingAddress(true);
      try {
        const suggestions = await fetchAddressSuggestions(input);
        if (!cancelled) setAddressSuggestions(suggestions);
      } catch {
        if (!cancelled) setAddressSuggestions([]);
      } finally {
        if (!cancelled) setIsSearchingAddress(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [formData.streetAddress, formData.addressVerification?.status]);

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
    const addressField = ['streetAddress', 'unit', 'suburb', 'state', 'postcode'].includes(
      String(name)
    );
    const updated = {
      ...formData,
      [name]: value,
      ...(addressField ? { addressVerification: undefined } : {}),
    };
    setFormData(updated);
    onUpdate(updated);

    if (addressField) {
      setAddressVerificationMessage(null);
    }

    if (touched[name]) {
      const err = validateField(name, value);
      setErrors((prev) => ({ ...prev, [name]: err }));
    }
  };

  const handleBlur = (name: keyof PropertyDetails) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const currentValue = formData[name];
    const err = validateField(
      name,
      typeof currentValue === 'string' ? currentValue : ''
    );
    setErrors((prev) => ({ ...prev, [name]: err }));
  };

  const handleSelectSuburb = (suburb: string) => {
    const updated = { ...formData, suburb, addressVerification: undefined };
    setAddressVerificationMessage(null);
    // Suggest standard postcodes for common Perth suburbs if empty
    if (suburb === 'Cloverdale' && !formData.postcode) updated.postcode = '6105';
    if (suburb === 'Perth' && !formData.postcode) updated.postcode = '6000';
    if (suburb === 'Victoria Park' && !formData.postcode) updated.postcode = '6100';

    setFormData(updated);
    onUpdate(updated);
  };

  const applyValidatedAddress = (
    result: Awaited<ReturnType<typeof validateAddress>>
  ): PropertyDetails => {
    const state =
      result.state &&
      AUSTRALIAN_STATES.some((item) => item.code === result.state?.toUpperCase())
        ? result.state.toUpperCase()
        : formData.state;

    return {
      ...formData,
      streetAddress: result.streetAddress || formData.streetAddress,
      unit: result.unit || formData.unit,
      suburb: result.suburb || formData.suburb,
      state,
      postcode: result.postcode || formData.postcode,
      addressVerification: {
        status: result.verified ? 'verified' : 'unverified',
        formattedAddress: result.formattedAddress,
        placeId: result.placeId,
        latitude: result.latitude,
        longitude: result.longitude,
        validationGranularity: result.validationGranularity,
        possibleNextAction: result.possibleNextAction,
        addressComplete: result.addressComplete,
        validatedAt: new Date().toISOString(),
      },
    };
  };

  const handleAddressSuggestion = async (suggestion: AddressSuggestion) => {
    setIsValidatingAddress(true);
    setErrors((prev) => ({ ...prev, streetAddress: '' }));

    try {
      const result = await validateAddress({ formattedAddress: suggestion.text });

      if (!result.verified) {
        setAddressVerificationMessage(
          result.message || 'Google Maps could not verify this property address.'
        );
        return;
      }

      const updated = applyValidatedAddress(result);
      setFormData(updated);
      onUpdate(updated);
      setAddressSuggestions([]);
      setAddressVerificationMessage(
        result.requiresConfirmation
          ? 'Google Maps standardized this address. Review the details below before continuing.'
          : 'Address verified by Google Maps.'
      );
    } catch {
      setAddressVerificationMessage(
        'Address verification is temporarily unavailable. You can continue entering the address manually.'
      );
    } finally {
      setIsValidatingAddress(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
    if (hasErrors) return;

    if (formData.addressVerification?.status === 'verified') {
      onNext();
      return;
    }

    setIsValidatingAddress(true);
    try {
      const result = await validateAddress({ property: formData });

      if (!result.verified) {
        setAddressVerificationMessage(
          result.message ||
            'Google Maps could not verify this address to a specific property. Review it and try again.'
        );
        setErrors((prev) => ({
          ...prev,
          streetAddress: 'Please verify the property address before continuing.',
        }));
        return;
      }

      const updated = applyValidatedAddress(result);
      setFormData(updated);
      onUpdate(updated);
      setAddressVerificationMessage(
        result.requiresConfirmation
          ? 'Google Maps standardized this address. The standardized address will be used for the booking.'
          : 'Address verified by Google Maps.'
      );
      onNext();
    } catch {
      // Production server validation remains authoritative. Optional mode allows
      // the customer to continue if Google Maps Platform is temporarily unavailable.
      setAddressVerificationMessage(
        'Address verification is temporarily unavailable. The address will be checked again when the booking is confirmed.'
      );
      onNext();
    } finally {
      setIsValidatingAddress(false);
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
            <div className="relative">
              <input
                type="text"
                autoComplete="off"
                placeholder="Start typing the property address"
                value={formData.streetAddress}
                onChange={(e) => handleChange('streetAddress', e.target.value)}
                onBlur={() => window.setTimeout(() => setAddressSuggestions([]), 180)}
                className={`w-full h-11 px-3.5 pr-10 bg-slate-50 border rounded-lg text-sm text-[#0F172A] focus:bg-white outline-none transition-all ${
                  errors.streetAddress && touched.streetAddress
                    ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 bg-rose-50/30'
                    : 'border-slate-300 focus:border-[#00B5B8] focus:ring-2 focus:ring-[#00B5B8]/20'
                }`}
              />
              {isSearchingAddress && (
                <Loader2 className="absolute right-3 top-3.5 w-4 h-4 text-[#006D70] animate-spin" />
              )}

              {addressSuggestions.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
                  {addressSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.placeId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddressSuggestion(suggestion)}
                      className="w-full text-left px-3.5 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="text-sm font-semibold text-[#1A2B4A] block">
                        {suggestion.mainText || suggestion.text}
                      </span>
                      {suggestion.secondaryText && (
                        <span className="text-xs text-slate-500 block mt-0.5">
                          {suggestion.secondaryText}
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="px-3 py-1.5 text-[10px] text-slate-400 text-right bg-slate-50">
                    Google Maps
                  </div>
                </div>
              )}
            </div>
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

        {addressVerificationMessage && (
          <div
            className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
              formData.addressVerification?.status === 'verified'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {formData.addressVerification?.status === 'verified' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{addressVerificationMessage}</span>
          </div>
        )}

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
          disabled={isValidatingAddress}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-[#007F82] hover:bg-[#006D70] text-white shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
        >
          {isValidatingAddress ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying address...</span>
            </>
          ) : (
            <>
              <span>Continue to Property Access</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
};
