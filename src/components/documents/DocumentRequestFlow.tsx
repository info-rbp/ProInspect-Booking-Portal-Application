import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  Home,
  Landmark,
  Loader2,
} from 'lucide-react';
import type { ServiceCategory } from '../../types/booking';
import type {
  DocumentProduct,
  DocumentRequestDetails,
  PublicDocumentRequestSummary,
} from '../../types/documentRequest';
import {
  fetchDocumentProducts,
  submitDocumentRequest,
} from '../../services/api';
import {
  isValidAustralianPhone,
  isValidAustralianPostcode,
  isValidEmail,
} from '../../utils/australianValidation';

type DocumentStep = 'category' | 'document' | 'details' | 'review';

interface DocumentRequestFlowProps {
  onBackToHub: () => void;
}

const CATEGORY_OPTIONS: Array<{
  id: ServiceCategory;
  title: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: 'residential',
    title: 'Residential',
    description: 'Residential tenancy agreements, prescribed notices, bond forms and related documents.',
    icon: Home,
  },
  {
    id: 'commercial',
    title: 'Commercial',
    description: 'Commercial property documents will be added to this catalogue in a later stage.',
    icon: Building2,
  },
  {
    id: 'strata-building',
    title: 'Strata / Building',
    description: 'Strata and building documents will be added to this catalogue in a later stage.',
    icon: Landmark,
  },
];

function categoryLabel(category: ServiceCategory): string {
  return category === 'strata-building'
    ? 'Strata / Building'
    : category.charAt(0).toUpperCase() + category.slice(1);
}

const emptyDetails: DocumentRequestDetails = {
  streetAddress: '',
  unit: '',
  suburb: '',
  state: 'WA',
  postcode: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  clientName: '',
  clientReference: '',
  notes: '',
};

export const DocumentRequestFlow: React.FC<DocumentRequestFlowProps> = ({
  onBackToHub,
}) => {
  const [products, setProducts] = useState<DocumentProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<DocumentStep>('category');
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [details, setDetails] = useState<DocumentRequestDetails>(emptyDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<PublicDocumentRequestSummary | null>(null);

  useEffect(() => {
    fetchDocumentProducts()
      .then(setProducts)
      .catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : 'Unable to load document products.'
        );
      })
      .finally(() => setIsLoadingProducts(false));
  }, []);

  const availableProducts = useMemo(
    () =>
      category
        ? products.filter((product) => product.categories.includes(category))
        : [],
    [category, products]
  );

  const selectedDocument = products.find((product) => product.id === documentId);

  const selectCategory = (nextCategory: ServiceCategory) => {
    if (nextCategory !== category) {
      setCategory(nextCategory);
      setDocumentId(null);
      setSubmitError(null);
    }
  };

  const validateDetails = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!details.streetAddress.trim()) nextErrors.streetAddress = 'Street address is required.';
    if (!details.suburb.trim()) nextErrors.suburb = 'Suburb is required.';
    if (!isValidAustralianPostcode(details.postcode)) {
      nextErrors.postcode = 'Enter a valid 4-digit Australian postcode.';
    }
    if (!details.customerName.trim()) nextErrors.customerName = 'Contact name is required.';
    if (!isValidEmail(details.customerEmail)) {
      nextErrors.customerEmail = 'Enter a valid email address.';
    }
    if (!isValidAustralianPhone(details.customerPhone)) {
      nextErrors.customerPhone = 'Enter a valid Australian phone number.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const updateDetail = (field: keyof DocumentRequestDetails, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: '' }));
    }
  };

  const submit = async () => {
    if (!category || !selectedDocument || !isAcknowledged) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitDocumentRequest({
        documentId: selectedDocument.id,
        documentCategory: category,
        details,
      });
      setConfirmed(result.request);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The document request could not be submitted.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <div className="max-w-2xl mx-auto py-6 sm:py-10 animate-fadeIn">
        <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-9 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">
            Request submitted
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
            We have received your document request
          </h1>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Your request has been recorded for ProInspect review. The document is not issued automatically from this form.
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm space-y-3">
            <div>
              <span className="block text-xs text-slate-500">Reference</span>
              <strong className="text-[#1A2B4A]">{confirmed.requestReference}</strong>
            </div>
            <div>
              <span className="block text-xs text-slate-500">Document</span>
              <strong className="text-[#1A2B4A]">{confirmed.documentName}</strong>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <span className="block text-xs text-slate-500">Category</span>
                <span className="font-semibold text-slate-800">
                  {categoryLabel(confirmed.documentCategory)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-slate-500">Scheduled fee</span>
                <span className="font-semibold text-slate-800">
                  ${confirmed.priceExGst} + GST
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToHub}
            className="mt-7 inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#007F82] hover:bg-[#006D70] text-white text-sm font-bold transition-colors"
          >
            Return to Client Hub
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const stepNumber =
    step === 'category' ? 1 : step === 'document' ? 2 : step === 'details' ? 3 : 4;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between gap-4 text-xs">
        <button
          type="button"
          onClick={onBackToHub}
          className="inline-flex items-center gap-1.5 text-slate-600 hover:text-[#006D70] font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Client Hub
        </button>
        <span className="font-bold text-slate-500">Document Request · Step {stepNumber} of 4</span>
      </div>

      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full bg-[#007F82] transition-all"
          style={{ width: `${stepNumber * 25}%` }}
        />
      </div>

      {step === 'category' && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
              What type of document do you need?
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-slate-600">
              Select the property category first. The next step will only show documents available for that category.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {CATEGORY_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = category === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectCategory(option.id)}
                  className={`text-left rounded-xl border-2 p-5 transition-all ${
                    selected
                      ? 'border-[#00B5B8] bg-[#F0FBFB] ring-1 ring-[#00B5B8]/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 text-[#1A2B4A] flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selected
                        ? 'border-[#00B5B8] bg-[#007F82] text-white'
                        : 'border-slate-300'
                    }`}>
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </span>
                  </div>
                  <h2 className="mt-4 font-extrabold text-lg text-[#1A2B4A]">
                    {option.title}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-200">
            <button
              type="button"
              disabled={!category}
              onClick={() => category && setStep('document')}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold ${
                category
                  ? 'bg-[#007F82] hover:bg-[#006D70] text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Continue to Documents
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {step === 'document' && category && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
              Select a {categoryLabel(category)} Document
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-slate-600">
              Showing document products currently available for {categoryLabel(category)} properties.
            </p>
          </div>

          {isLoadingProducts ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-5 h-5 animate-spin text-[#007F82]" />
              Loading document catalogue...
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
              {loadError}
            </div>
          ) : availableProducts.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <strong className="block">No documents are configured for this category yet.</strong>
              <span className="text-xs">
                Residential tenancy documents are available now. Commercial and Strata / Building document catalogues will be added separately.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableProducts.map((product) => {
                const selected = documentId === product.id;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setDocumentId(product.id)}
                    className={`text-left rounded-xl border-2 p-5 transition-all ${
                      selected
                        ? 'border-[#00B5B8] bg-[#F0FBFB] ring-1 ring-[#00B5B8]/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 text-[#1A2B4A] flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm sm:text-base text-[#1A2B4A] leading-snug">
                            {product.name}
                          </h3>
                          {product.formCode && (
                            <span className="text-xs font-semibold text-[#007F82]">
                              {product.formCode}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        selected
                          ? 'border-[#00B5B8] bg-[#007F82] text-white'
                          : 'border-slate-300'
                      }`}>
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                      {product.publicDescription}
                    </p>
                    <div className="mt-4 pt-3 border-t border-slate-100 text-sm font-extrabold text-[#1A2B4A]">
                      ${product.priceExGst} + GST
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setStep('category')}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" />
              Change Category
            </button>
            <button
              type="button"
              disabled={!selectedDocument}
              onClick={() => selectedDocument && setStep('details')}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold ${
                selectedDocument
                  ? 'bg-[#007F82] hover:bg-[#006D70] text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Continue to Request Details
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {step === 'details' && selectedDocument && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
              Request details
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-slate-600">
              Provide the property and contact details for this document request.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="font-bold text-[#1A2B4A]">Property</h2>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Street address" required error={errors.streetAddress}>
                  <input value={details.streetAddress} onChange={(e) => updateDetail('streetAddress', e.target.value)} className="field" />
                </Field>
                <Field label="Unit / lot">
                  <input value={details.unit || ''} onChange={(e) => updateDetail('unit', e.target.value)} className="field" />
                </Field>
                <Field label="Suburb" required error={errors.suburb}>
                  <input value={details.suburb} onChange={(e) => updateDetail('suburb', e.target.value)} className="field" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="State" required>
                    <select value={details.state} onChange={(e) => updateDetail('state', e.target.value)} className="field">
                      {['WA','NSW','VIC','QLD','SA','TAS','ACT','NT'].map((state) => <option key={state}>{state}</option>)}
                    </select>
                  </Field>
                  <Field label="Postcode" required error={errors.postcode}>
                    <input inputMode="numeric" maxLength={4} value={details.postcode} onChange={(e) => updateDetail('postcode', e.target.value.replace(/\D/g, '').slice(0, 4))} className="field" />
                  </Field>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h2 className="font-bold text-[#1A2B4A]">Request contact</h2>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Contact name" required error={errors.customerName}>
                  <input value={details.customerName} onChange={(e) => updateDetail('customerName', e.target.value)} className="field" />
                </Field>
                <Field label="Email" required error={errors.customerEmail}>
                  <input type="email" value={details.customerEmail} onChange={(e) => updateDetail('customerEmail', e.target.value)} className="field" />
                </Field>
                <Field label="Phone" required error={errors.customerPhone}>
                  <input type="tel" value={details.customerPhone} onChange={(e) => updateDetail('customerPhone', e.target.value)} className="field" />
                </Field>
                <Field label="Agency / client name">
                  <input value={details.clientName || ''} onChange={(e) => updateDetail('clientName', e.target.value)} className="field" />
                </Field>
                <Field label="Client / property reference">
                  <input value={details.clientReference || ''} onChange={(e) => updateDetail('clientReference', e.target.value)} className="field" />
                </Field>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <Field label="Additional instructions">
                <textarea
                  rows={4}
                  value={details.notes || ''}
                  onChange={(e) => updateDetail('notes', e.target.value)}
                  className="field resize-y"
                  placeholder="Provide any information you want ProInspect to consider when reviewing this request."
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t border-slate-200">
            <button type="button" onClick={() => setStep('document')} className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="w-4 h-4" /> Back to Documents
            </button>
            <button
              type="button"
              onClick={() => validateDetails() && setStep('review')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#007F82] hover:bg-[#006D70] text-white text-sm font-bold"
            >
              Review Request <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {step === 'review' && category && selectedDocument && (
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
              Review your document request
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-slate-600">
              Check the details below before submitting the request to ProInspect.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="bg-[#1A2B4A] text-white p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#00B5B8]">
                {categoryLabel(category)}
              </span>
              <h2 className="mt-1 text-xl font-extrabold">
                {selectedDocument.name}
                {selectedDocument.formCode ? ` (${selectedDocument.formCode})` : ''}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                Scheduled fee: ${selectedDocument.priceExGst} + GST
              </p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-xs text-slate-500">Property</span>
                <strong className="text-[#1A2B4A]">
                  {[details.unit, details.streetAddress, details.suburb, details.state, details.postcode].filter(Boolean).join(', ')}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-slate-500">Request contact</span>
                <strong className="text-[#1A2B4A]">{details.customerName}</strong>
                <span className="block text-slate-600">{details.customerEmail}</span>
                <span className="block text-slate-600">{details.customerPhone}</span>
              </div>
              {details.notes && (
                <div className="sm:col-span-2">
                  <span className="block text-xs text-slate-500">Instructions</span>
                  <span className="text-slate-700 whitespace-pre-wrap">{details.notes}</span>
                </div>
              )}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={isAcknowledged}
              onChange={(e) => setIsAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#007F82]"
            />
            <span className="text-sm text-slate-700 leading-relaxed">
              I confirm the request details are accurate and understand that ProInspect will review the request before the document is prepared or distributed.
            </span>
          </label>

          {submitError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {submitError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t border-slate-200">
            <button type="button" onClick={() => setStep('details')} className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="w-4 h-4" /> Edit Details
            </button>
            <button
              type="button"
              disabled={!isAcknowledged || isSubmitting}
              onClick={submit}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold ${
                isAcknowledged && !isSubmitting
                  ? 'bg-[#007F82] hover:bg-[#006D70] text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Submit Document Request
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}> = ({ label, required, error, children }) => (
  <label className="block">
    <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </span>
    {children}
    {error && <span className="block mt-1 text-xs font-medium text-rose-600">{error}</span>}
  </label>
);
