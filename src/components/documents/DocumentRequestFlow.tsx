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
  Plus,
  Trash2,
} from 'lucide-react';
import type { ServiceCategory } from '../../types/booking';
import type {
  DocumentParty,
  DocumentProduct,
  DocumentRequesterRole,
  DocumentRequestDetails,
  DocumentWorkflowAnswer,
  DocumentWorkflowDefinition,
  DocumentWorkflowField,
  PublicDocumentRequestSummary,
} from '../../types/documentRequest';
import {
  getDocumentWorkflowDefinition,
  isWorkflowAnswerPresent,
  isWorkflowFieldVisible,
  sensitiveWorkflowFieldIds,
  validateDocumentWorkflowRules,
} from '../../documents/documentWorkflowDefinitions';
import {
  fetchDocumentProducts,
  submitDocumentRequest,
} from '../../services/api';
import {
  isValidAustralianPhone,
  isValidEmail,
  isWAPostcode,
} from '../../utils/australianValidation';

type DocumentStep =
  | 'category'
  | 'document'
  | 'common'
  | 'parties'
  | 'workflow'
  | 'review';

interface DocumentRequestFlowProps {
  onBackToHub: () => void;
}

const DRAFT_KEY = 'proinspect_document_request_draft_v2';

const CATEGORY_OPTIONS: Array<{
  id: ServiceCategory;
  title: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: 'residential',
    title: 'Residential',
    description:
      'Residential tenancy agreements, prescribed notices, bond forms and related documents.',
    icon: Home,
  },
  {
    id: 'commercial',
    title: 'Commercial',
    description:
      'Commercial property documents will be added to this catalogue in a later stage.',
    icon: Building2,
  },
  {
    id: 'strata-building',
    title: 'Strata / Building',
    description:
      'Strata and building documents will be added to this catalogue in a later stage.',
    icon: Landmark,
  },
];

const requesterRoles: Array<{
  value: DocumentRequesterRole;
  label: string;
}> = [
  { value: 'lessor', label: 'Landlord / lessor' },
  { value: 'property-manager', label: 'Property manager / agent' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'other', label: 'Other authorised requester' },
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

function emptyParty(): DocumentParty {
  return {
    id: `party_${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    address: '',
    postcode: '',
    email: '',
    phone: '',
  };
}

function currencyDisplay(value: unknown): string {
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(raw)
    ? new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: 2,
      }).format(raw)
    : '';
}

function maskSensitiveValue(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= 4) return '••••';
  return `•••• ${text.slice(-4)}`;
}

function cloneDraftAnswers(
  definition: DocumentWorkflowDefinition | undefined,
  answers: Record<string, DocumentWorkflowAnswer>
): Record<string, DocumentWorkflowAnswer> {
  if (!definition) return answers;
  const sensitive = sensitiveWorkflowFieldIds(definition);
  return Object.fromEntries(
    Object.entries(answers).filter(([fieldId]) => !sensitive.has(fieldId))
  );
}

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
  const [requesterRole, setRequesterRole] =
    useState<DocumentRequesterRole>('lessor');
  const [lessors, setLessors] = useState<DocumentParty[]>([emptyParty()]);
  const [tenants, setTenants] = useState<DocumentParty[]>([emptyParty()]);
  const [answers, setAnswers] = useState<
    Record<string, DocumentWorkflowAnswer>
  >({});
  const [workflowSectionIndex, setWorkflowSectionIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] =
    useState<PublicDocumentRequestSummary | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    fetchDocumentProducts()
      .then(setProducts)
      .catch((error) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load document products.'
        );
      })
      .finally(() => setIsLoadingProducts(false));
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as {
          category?: ServiceCategory;
          documentId?: string;
          details?: DocumentRequestDetails;
          requesterRole?: DocumentRequesterRole;
          lessors?: DocumentParty[];
          tenants?: DocumentParty[];
          answers?: Record<string, DocumentWorkflowAnswer>;
        };

        if (draft.category) setCategory(draft.category);
        if (draft.documentId) setDocumentId(draft.documentId);
        if (draft.details) setDetails({ ...emptyDetails, ...draft.details });
        if (draft.requesterRole) setRequesterRole(draft.requesterRole);
        if (draft.lessors?.length) setLessors(draft.lessors);
        if (draft.tenants?.length) setTenants(draft.tenants);
        if (draft.answers) setAnswers(draft.answers);
      }
    } catch (error) {
      console.warn('Unable to restore document request draft:', error);
    } finally {
      setDraftRestored(true);
    }
  }, []);

  const selectedDocument = products.find(
    (product) => product.id === documentId
  );
  const workflowDefinition = documentId
    ? getDocumentWorkflowDefinition(documentId)
    : undefined;

  useEffect(() => {
    if (!draftRestored) return;

    try {
      window.sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          category,
          documentId,
          details,
          requesterRole,
          lessors,
          tenants,
          answers: cloneDraftAnswers(workflowDefinition, answers),
        })
      );
    } catch (error) {
      console.warn('Unable to save document request draft:', error);
    }
  }, [
    draftRestored,
    category,
    documentId,
    details,
    requesterRole,
    lessors,
    tenants,
    answers,
    workflowDefinition,
  ]);

  const availableProducts = useMemo(
    () =>
      category
        ? products.filter((product) => product.categories.includes(category))
        : [],
    [category, products]
  );

  const totalSteps = workflowDefinition
    ? 5 + workflowDefinition.sections.length
    : 5;

  const stepNumber =
    step === 'category'
      ? 1
      : step === 'document'
        ? 2
        : step === 'common'
          ? 3
          : step === 'parties'
            ? 4
            : step === 'workflow'
              ? 5 + workflowSectionIndex
              : totalSteps;

  const progress = Math.min(
    100,
    Math.max(1, Math.round((stepNumber / totalSteps) * 100))
  );

  const currentSection =
    workflowDefinition?.sections[workflowSectionIndex] || undefined;

  const selectCategory = (nextCategory: ServiceCategory) => {
    if (nextCategory !== category) {
      setCategory(nextCategory);
      setDocumentId(null);
      setAnswers({});
      setWorkflowSectionIndex(0);
      setSubmitError(null);
      setErrors({});
      setStep('category');
    }
  };

  const selectDocument = (nextDocumentId: string) => {
    if (nextDocumentId !== documentId) {
      setDocumentId(nextDocumentId);
      setAnswers({});
      setWorkflowSectionIndex(0);
      setErrors({});
      setSubmitError(null);
      setIsAcknowledged(false);

      if (nextDocumentId === 'termination-family-violence-form-2') {
        setDetails((current) => ({ ...current, notes: '' }));
      }
    }
  };

  const updateDetail = (
    field: keyof DocumentRequestDetails,
    value: string
  ) => {
    setDetails((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: '' }));
    }
  };

  const updateParty = (
    kind: 'lessors' | 'tenants',
    id: string,
    field: keyof DocumentParty,
    value: string
  ) => {
    const setter = kind === 'lessors' ? setLessors : setTenants;
    setter((current) =>
      current.map((party) =>
        party.id === id ? { ...party, [field]: value } : party
      )
    );
  };

  const addParty = (kind: 'lessors' | 'tenants') => {
    const setter = kind === 'lessors' ? setLessors : setTenants;
    setter((current) => [...current, emptyParty()]);
  };

  const removeParty = (kind: 'lessors' | 'tenants', id: string) => {
    const setter = kind === 'lessors' ? setLessors : setTenants;
    setter((current) =>
      current.length > 1
        ? current.filter((party) => party.id !== id)
        : current
    );
  };

  const useRequesterForFirstParty = (kind: 'lessors' | 'tenants') => {
    const setter = kind === 'lessors' ? setLessors : setTenants;
    setter((current) => {
      const next = [...current];
      const first = next[0] || emptyParty();
      next[0] = {
        ...first,
        name: details.customerName,
        email: details.customerEmail,
        phone: details.customerPhone,
      };
      return next;
    });
  };

  const setAnswer = (fieldId: string, value: DocumentWorkflowAnswer) => {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((current) => ({ ...current, [fieldId]: '' }));
    }
  };

  const validateCommon = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!details.streetAddress.trim()) {
      nextErrors.streetAddress = 'Street address is required.';
    }
    if (!details.suburb.trim()) nextErrors.suburb = 'Suburb is required.';
    if (!isWAPostcode(details.postcode)) {
      nextErrors.postcode = 'Enter a valid Western Australian postcode.';
    }
    if (!details.customerName.trim()) {
      nextErrors.customerName = 'Contact name is required.';
    }
    if (!isValidEmail(details.customerEmail)) {
      nextErrors.customerEmail = 'Enter a valid email address.';
    }
    if (!isValidAustralianPhone(details.customerPhone)) {
      nextErrors.customerPhone = 'Enter a valid Australian phone number.';
    }

    if (
      workflowDefinition?.allowedRequesterRoles &&
      !workflowDefinition.allowedRequesterRoles.includes(requesterRole)
    ) {
      nextErrors.requesterRole =
        'This document is not designed for the selected requester role.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateParties = (): boolean => {
    if (!workflowDefinition) return false;
    const nextErrors: Record<string, string> = {};

    const minimumLessors = workflowDefinition.minimumLessors ?? 0;
    const minimumTenants = workflowDefinition.minimumTenants ?? 0;
    const namedLessors = lessors.filter((party) => party.name.trim());
    const namedTenants = tenants.filter((party) => party.name.trim());

    if (namedLessors.length < minimumLessors) {
      nextErrors.lessors = `Enter at least ${minimumLessors} landlord / lessor name${minimumLessors === 1 ? '' : 's'}.`;
    }
    if (namedTenants.length < minimumTenants) {
      nextErrors.tenants = `Enter at least ${minimumTenants} tenant name${minimumTenants === 1 ? '' : 's'}.`;
    }

    for (const party of [...namedLessors, ...namedTenants]) {
      if (party.email && !isValidEmail(party.email)) {
        nextErrors[`party-${party.id}`] =
          'Check the email address entered for this party.';
      }
      if (party.phone && !isValidAustralianPhone(party.phone)) {
        nextErrors[`party-${party.id}`] =
          'Check the phone number entered for this party.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateWorkflowSection = (): boolean => {
    if (!currentSection) return false;
    const nextErrors: Record<string, string> = {};

    for (const field of currentSection.fields) {
      if (!isWorkflowFieldVisible(field, answers)) continue;
      const value = answers[field.id];

      if (field.required && !isWorkflowAnswerPresent(field, value)) {
        nextErrors[field.id] = 'This information is required.';
        continue;
      }

      if (
        field.type === 'email' &&
        typeof value === 'string' &&
        value.trim() &&
        !isValidEmail(value)
      ) {
        nextErrors[field.id] = 'Enter a valid email address.';
      }

      if (
        field.type === 'phone' &&
        typeof value === 'string' &&
        value.trim() &&
        !isValidAustralianPhone(value)
      ) {
        nextErrors[field.id] = 'Enter a valid Australian phone number.';
      }

      if (
        field.type === 'party-electronic-consents' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const map = value as Record<string, unknown>;
        const namedParties = [
          ...lessors.filter((party) => party.name.trim()),
          ...tenants.filter((party) => party.name.trim()),
        ];

        const incomplete = namedParties.some((party) => {
          const entry =
            map[party.id] &&
            typeof map[party.id] === 'object' &&
            !Array.isArray(map[party.id])
              ? (map[party.id] as Record<string, unknown>)
              : {};

          if (
            !['yes', 'no'].includes(String(entry.email || '')) ||
            !['yes', 'no'].includes(String(entry.fax || ''))
          ) {
            return true;
          }

          if (entry.email === 'yes' && !party.email?.trim()) return true;
          if (
            entry.fax === 'yes' &&
            !String(entry.faxNumber || '').trim()
          ) {
            return true;
          }

          return false;
        });

        if (incomplete) {
          nextErrors[field.id] =
            'Complete email and fax preferences for every named party. An email address is required when email notices are accepted, and a fax number is required when fax notices are accepted.';
        }
      }

      if (
        field.type === 'party-payouts' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const map = value as Record<string, unknown>;
        const namedParties = [
          ...tenants.filter((party) => party.name.trim()),
          ...lessors.filter((party) => party.name.trim()),
        ];

        const incomplete = namedParties.some((party) => {
          const entry =
            map[party.id] &&
            typeof map[party.id] === 'object' &&
            !Array.isArray(map[party.id])
              ? (map[party.id] as Record<string, unknown>)
              : {};
          const amount = Number(entry.amount);

          if (!Number.isFinite(amount) || amount < 0) return true;
          if (amount === 0) return false;

          return !(
            String(entry.accountName || '').trim() &&
            String(entry.bsb || '').trim() &&
            String(entry.accountNumber || '').trim() &&
            String(entry.institution || '').trim()
          );
        });

        if (incomplete) {
          nextErrors[field.id] =
            'Enter a payment amount for every named party. For each party receiving bond money, complete the Australian bank account details.';
        }
      }
    }

    if (documentId) {
      const currentFieldIds = new Set(
        currentSection.fields.map((field) => field.id)
      );
      for (const ruleError of validateDocumentWorkflowRules(
        documentId,
        answers
      )) {
        if (
          currentFieldIds.has(ruleError.fieldId) &&
          !nextErrors[ruleError.fieldId]
        ) {
          nextErrors[ruleError.fieldId] = ruleError.message;
        }
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleCommonNext = () => {
    if (!validateCommon()) return;

    if (requesterRole === 'lessor' && !lessors[0]?.name.trim()) {
      useRequesterForFirstParty('lessors');
    }
    if (requesterRole === 'tenant' && !tenants[0]?.name.trim()) {
      useRequesterForFirstParty('tenants');
    }

    if (
      documentId === 'residential-tenancy-lease-agreement-form-1aa' &&
      requesterRole === 'property-manager'
    ) {
      setAnswers((current) => ({
        ...current,
        propertyManagerIncluded:
          current.propertyManagerIncluded || 'yes',
        propertyManagerName:
          current.propertyManagerName ||
          details.clientName ||
          details.customerName,
        propertyManagerPhone:
          current.propertyManagerPhone || details.customerPhone,
        propertyManagerEmail:
          current.propertyManagerEmail || details.customerEmail,
      }));
    }

    setStep('parties');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePartiesNext = () => {
    if (!validateParties()) return;
    setWorkflowSectionIndex(0);
    setStep('workflow');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleWorkflowNext = () => {
    if (!workflowDefinition || !validateWorkflowSection()) return;

    if (workflowSectionIndex < workflowDefinition.sections.length - 1) {
      setWorkflowSectionIndex((index) => index + 1);
    } else {
      setStep('review');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleWorkflowBack = () => {
    if (workflowSectionIndex > 0) {
      setWorkflowSectionIndex((index) => index - 1);
    } else {
      setStep('parties');
    }
    setErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    if (
      !category ||
      !selectedDocument ||
      !workflowDefinition ||
      !isAcknowledged
    ) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitDocumentRequest({
        documentId: selectedDocument.id,
        documentCategory: category,
        details,
        workflow: {
          version: 1,
          requesterRole,
          lessors: lessors.filter((party) => party.name.trim()),
          tenants: tenants.filter((party) => party.name.trim()),
          answers,
        },
      });

      window.sessionStorage.removeItem(DRAFT_KEY);
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
            Your form-specific information has been recorded for ProInspect
            review. You will not need to re-enter the information collected in
            this request.
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm space-y-3">
            <div>
              <span className="block text-xs text-slate-500">Reference</span>
              <strong className="text-[#1A2B4A]">
                {confirmed.requestReference}
              </strong>
            </div>
            <div>
              <span className="block text-xs text-slate-500">Document</span>
              <strong className="text-[#1A2B4A]">
                {confirmed.documentName}
              </strong>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <span className="block text-xs text-slate-500">Category</span>
                <span className="font-semibold text-slate-800">
                  {categoryLabel(confirmed.documentCategory)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-slate-500">
                  Scheduled fee
                </span>
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
        <span className="font-bold text-slate-500">
          Document Request · Step {stepNumber} of {totalSteps}
        </span>
      </div>

      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full bg-[#007F82] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {step === 'category' && (
        <section className="space-y-6">
          <PageIntro
            title="What type of document do you need?"
            description="Select the property category first. The next step will only show documents available for that category."
          />

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
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        selected
                          ? 'border-[#00B5B8] bg-[#007F82] text-white'
                          : 'border-slate-300'
                      }`}
                    >
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

          <WizardActions
            nextLabel="Continue to Documents"
            nextDisabled={!category}
            onNext={() => category && setStep('document')}
          />
        </section>
      )}

      {step === 'document' && category && (
        <section className="space-y-6">
          <PageIntro
            title={`Select a ${categoryLabel(category)} Document`}
            description={`Showing document products currently available for ${categoryLabel(category)} properties.`}
          />

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
              <strong className="block">
                No documents are configured for this category yet.
              </strong>
              <span className="text-xs">
                Residential tenancy documents are available now. Commercial and
                Strata / Building document catalogues will be added separately.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {availableProducts.map((product) => {
                const selected = documentId === product.id;
                const definition = getDocumentWorkflowDefinition(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectDocument(product.id)}
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
                      <span
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                          selected
                            ? 'border-[#00B5B8] bg-[#007F82] text-white'
                            : 'border-slate-300'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                      {product.publicDescription}
                    </p>
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <span className="text-sm font-extrabold text-[#1A2B4A]">
                        ${product.priceExGst} + GST
                      </span>
                      {definition && (
                        <span className="text-[11px] font-semibold text-[#007F82]">
                          Guided workflow
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <WizardActions
            backLabel="Change Category"
            onBack={() => setStep('category')}
            nextLabel="Start Document Request"
            nextDisabled={!selectedDocument || !workflowDefinition}
            onNext={() =>
              selectedDocument && workflowDefinition && setStep('common')
            }
          />
        </section>
      )}

      {step === 'common' && selectedDocument && workflowDefinition && (
        <section className="space-y-6">
          <PageIntro
            title="Property and requester"
            description="Enter this information once. It will be reused throughout the document workflow."
          />

          {workflowDefinition.intro && (
            <InfoNotice>{workflowDefinition.intro}</InfoNotice>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6">
            <div>
              <h2 className="font-bold text-[#1A2B4A]">Property</h2>
              <p className="mt-1 text-xs text-slate-500">
                Current Residential document workflows are for Western
                Australian properties.
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Street address"
                  required
                  error={errors.streetAddress}
                >
                  <input
                    value={details.streetAddress}
                    onChange={(event) =>
                      updateDetail('streetAddress', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Unit / lot">
                  <input
                    value={details.unit || ''}
                    onChange={(event) =>
                      updateDetail('unit', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Suburb" required error={errors.suburb}>
                  <input
                    value={details.suburb}
                    onChange={(event) =>
                      updateDetail('suburb', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="State" required>
                    <input
                      value="WA"
                      readOnly
                      className="field bg-slate-100"
                    />
                  </Field>
                  <Field label="Postcode" required error={errors.postcode}>
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={details.postcode}
                      onChange={(event) =>
                        updateDetail(
                          'postcode',
                          event.target.value.replace(/\D/g, '').slice(0, 4)
                        )
                      }
                      className="field"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100">
              <h2 className="font-bold text-[#1A2B4A]">
                Person making this request
              </h2>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Your role"
                  required
                  error={errors.requesterRole}
                >
                  <select
                    value={requesterRole}
                    onChange={(event) =>
                      setRequesterRole(
                        event.target.value as DocumentRequesterRole
                      )
                    }
                    className="field"
                  >
                    {requesterRoles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Contact name"
                  required
                  error={errors.customerName}
                >
                  <input
                    value={details.customerName}
                    onChange={(event) =>
                      updateDetail('customerName', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Email" required error={errors.customerEmail}>
                  <input
                    type="email"
                    value={details.customerEmail}
                    onChange={(event) =>
                      updateDetail('customerEmail', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Phone" required error={errors.customerPhone}>
                  <input
                    type="tel"
                    value={details.customerPhone}
                    onChange={(event) =>
                      updateDetail('customerPhone', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Agency / client name">
                  <input
                    value={details.clientName || ''}
                    onChange={(event) =>
                      updateDetail('clientName', event.target.value)
                    }
                    className="field"
                  />
                </Field>
                <Field label="Client / property reference">
                  <input
                    value={details.clientReference || ''}
                    onChange={(event) =>
                      updateDetail('clientReference', event.target.value)
                    }
                    className="field"
                  />
                </Field>
              </div>
            </div>

            {documentId !== 'termination-family-violence-form-2' && (
              <div className="pt-5 border-t border-slate-100">
                <Field label="Additional instructions">
                  <textarea
                    rows={3}
                    value={details.notes || ''}
                    onChange={(event) =>
                      updateDetail('notes', event.target.value)
                    }
                    className="field resize-y"
                    placeholder="Optional instructions for ProInspect."
                  />
                </Field>
              </div>
            )}
          </div>

          <WizardActions
            backLabel="Back to Documents"
            onBack={() => setStep('document')}
            nextLabel="Continue to Parties"
            onNext={handleCommonNext}
          />
        </section>
      )}

      {step === 'parties' && workflowDefinition && (
        <section className="space-y-6">
          <PageIntro
            title="People named on the document"
            description="Enter each landlord and tenant once. These details are reused wherever the selected form needs them."
          />

          <PartyList
            title="Landlord / lessor"
            parties={lessors}
            kind="lessors"
            minimum={workflowDefinition.minimumLessors ?? 0}
            error={errors.lessors}
            canUseRequester={requesterRole === 'lessor'}
            onUseRequester={() => useRequesterForFirstParty('lessors')}
            onUpdate={updateParty}
            onAdd={addParty}
            onRemove={removeParty}
            partyErrors={errors}
          />

          <PartyList
            title="Tenant"
            parties={tenants}
            kind="tenants"
            minimum={workflowDefinition.minimumTenants ?? 0}
            error={errors.tenants}
            canUseRequester={requesterRole === 'tenant'}
            onUseRequester={() => useRequesterForFirstParty('tenants')}
            onUpdate={updateParty}
            onAdd={addParty}
            onRemove={removeParty}
            partyErrors={errors}
          />

          <WizardActions
            backLabel="Back to Property"
            onBack={() => setStep('common')}
            nextLabel="Continue"
            onNext={handlePartiesNext}
          />
        </section>
      )}

      {step === 'workflow' &&
        workflowDefinition &&
        selectedDocument &&
        currentSection && (
          <section className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">
                {selectedDocument.formCode || selectedDocument.name}
              </p>
              <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
                {currentSection.title}
              </h1>
              {currentSection.description && (
                <p className="mt-1.5 text-sm sm:text-base text-slate-600">
                  {currentSection.description}
                </p>
              )}
            </div>

            {currentSection.notice && (
              <InfoNotice>{currentSection.notice}</InfoNotice>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5">
              {currentSection.fields.map((field) =>
                isWorkflowFieldVisible(field, answers) ? (
                  <WorkflowFieldControl
                    key={field.id}
                    field={field}
                    value={answers[field.id]}
                    answers={answers}
                    lessors={lessors.filter((party) => party.name.trim())}
                    tenants={tenants.filter((party) => party.name.trim())}
                    error={errors[field.id]}
                    onChange={(value) => setAnswer(field.id, value)}
                  />
                ) : null
              )}
            </div>

            <WizardActions
              backLabel={
                workflowSectionIndex === 0
                  ? 'Back to Parties'
                  : 'Previous Section'
              }
              onBack={handleWorkflowBack}
              nextLabel={
                workflowSectionIndex === workflowDefinition.sections.length - 1
                  ? 'Review Request'
                  : 'Continue'
              }
              onNext={handleWorkflowNext}
            />
          </section>
        )}

      {step === 'review' &&
        category &&
        selectedDocument &&
        workflowDefinition && (
          <section className="space-y-6">
            <PageIntro
              title="Review your document request"
              description="Confirm the details below before submitting. Use Edit to return to any section."
            />

            <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
              <div className="bg-[#1A2B4A] text-white p-5 sm:p-6">
                <span className="text-xs font-bold uppercase tracking-wider text-[#00B5B8]">
                  {categoryLabel(category)}
                </span>
                <h2 className="mt-1 text-xl font-extrabold">
                  {selectedDocument.name}
                  {selectedDocument.formCode
                    ? ` (${selectedDocument.formCode})`
                    : ''}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Scheduled fee: ${selectedDocument.priceExGst} + GST
                </p>
              </div>

              <ReviewSection
                title="Property and requester"
                onEdit={() => setStep('common')}
                items={[
                  [
                    'Property',
                    [
                      details.unit,
                      details.streetAddress,
                      details.suburb,
                      details.state,
                      details.postcode,
                    ]
                      .filter(Boolean)
                      .join(', '),
                  ],
                  ['Requester', details.customerName],
                  ['Email', details.customerEmail],
                  ['Phone', details.customerPhone],
                  [
                    'Role',
                    requesterRoles.find(
                      (role) => role.value === requesterRole
                    )?.label || requesterRole,
                  ],
                  ...(details.clientName
                    ? [['Agency / client', details.clientName] as [string, string]]
                    : []),
                  ...(details.clientReference
                    ? [['Reference', details.clientReference] as [string, string]]
                    : []),
                ]}
              />

              <ReviewSection
                title="Parties"
                onEdit={() => setStep('parties')}
                items={[
                  [
                    'Landlord / lessor',
                    lessors
                      .filter((party) => party.name.trim())
                      .map((party) => party.name)
                      .join('; '),
                  ],
                  [
                    'Tenant',
                    tenants
                      .filter((party) => party.name.trim())
                      .map((party) => party.name)
                      .join('; '),
                  ],
                ]}
              />

              {workflowDefinition.sections.map((section, sectionIndex) => (
                <ReviewSection
                  key={section.id}
                  title={section.title}
                  onEdit={() => {
                    setWorkflowSectionIndex(sectionIndex);
                    setStep('workflow');
                  }}
                  items={section.fields
                    .filter((field) =>
                      isWorkflowFieldVisible(field, answers)
                    )
                    .map((field) => [
                      field.label,
                      formatWorkflowAnswer(
                        field,
                        answers[field.id],
                        lessors,
                        tenants
                      ),
                    ])
                    .filter(([, value]) => Boolean(value))}
                />
              ))}

              {details.notes && (
                <ReviewSection
                  title="Additional instructions"
                  onEdit={() => setStep('common')}
                  items={[['Instructions', details.notes]]}
                />
              )}
            </div>

            {workflowDefinition.reviewNotice && (
              <InfoNotice>{workflowDefinition.reviewNotice}</InfoNotice>
            )}

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={isAcknowledged}
                onChange={(event) =>
                  setIsAcknowledged(event.target.checked)
                }
                className="mt-0.5 w-4 h-4 accent-[#007F82]"
              />
              <span className="text-sm text-slate-700 leading-relaxed">
                I confirm the information above is accurate and understand
                that ProInspect will review the request before the prescribed
                form is prepared, signed or distributed.
              </span>
            </label>

            {submitError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                {submitError}
              </div>
            )}

            <WizardActions
              backLabel="Back"
              onBack={() => {
                setWorkflowSectionIndex(
                  Math.max(0, workflowDefinition.sections.length - 1)
                );
                setStep('workflow');
              }}
              nextLabel={
                isSubmitting ? 'Submitting...' : 'Submit Document Request'
              }
              nextDisabled={!isAcknowledged || isSubmitting}
              onNext={submit}
              loading={isSubmitting}
            />
          </section>
        )}
    </div>
  );
};

const PageIntro: React.FC<{ title: string; description?: string }> = ({
  title,
  description,
}) => (
  <div>
    <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
      {title}
    </h1>
    {description && (
      <p className="mt-1.5 text-sm sm:text-base text-slate-600">
        {description}
      </p>
    )}
  </div>
);

const InfoNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700 leading-relaxed">
    {children}
  </div>
);

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
    {error && (
      <span className="block mt-1 text-xs font-medium text-rose-600">
        {error}
      </span>
    )}
  </label>
);

const WizardActions: React.FC<{
  backLabel?: string;
  onBack?: () => void;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  loading?: boolean;
}> = ({
  backLabel,
  onBack,
  nextLabel,
  onNext,
  nextDisabled,
  loading,
}) => (
  <div
    className={`flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-200 ${
      onBack ? 'justify-between' : 'justify-end'
    }`}
  >
    {onBack && (
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50"
      >
        <ArrowLeft className="w-4 h-4" />
        {backLabel || 'Back'}
      </button>
    )}
    <button
      type="button"
      disabled={nextDisabled}
      onClick={onNext}
      className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-bold ${
        nextDisabled
          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
          : 'bg-[#007F82] hover:bg-[#006D70] text-white'
      }`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <ArrowRight className="w-4 h-4" />
      )}
      {nextLabel}
    </button>
  </div>
);

const PartyList: React.FC<{
  title: string;
  parties: DocumentParty[];
  kind: 'lessors' | 'tenants';
  minimum: number;
  error?: string;
  canUseRequester: boolean;
  onUseRequester: () => void;
  onUpdate: (
    kind: 'lessors' | 'tenants',
    id: string,
    field: keyof DocumentParty,
    value: string
  ) => void;
  onAdd: (kind: 'lessors' | 'tenants') => void;
  onRemove: (kind: 'lessors' | 'tenants', id: string) => void;
  partyErrors: Record<string, string>;
}> = ({
  title,
  parties,
  kind,
  minimum,
  error,
  canUseRequester,
  onUseRequester,
  onUpdate,
  onAdd,
  onRemove,
  partyErrors,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-bold text-[#1A2B4A]">{title}</h2>
        <p className="text-xs text-slate-500">
          {minimum > 0
            ? `At least ${minimum} named party is required.`
            : 'Add parties where applicable.'}
        </p>
      </div>
      {canUseRequester && (
        <button
          type="button"
          onClick={onUseRequester}
          className="text-xs font-bold text-[#006D70] hover:underline"
        >
          Use my contact details
        </button>
      )}
    </div>

    {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

    {parties.map((party, index) => (
      <div
        key={party.id}
        className="rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <strong className="text-sm text-[#1A2B4A]">
            {title} {index + 1}
          </strong>
          {parties.length > 1 && (
            <button
              type="button"
              onClick={() => onRemove(kind, party.id)}
              className="text-slate-400 hover:text-rose-600"
              aria-label={`Remove ${title} ${index + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Legal name"
            required={index < minimum}
            error={partyErrors[`party-${party.id}`]}
          >
            <input
              value={party.name}
              onChange={(event) =>
                onUpdate(kind, party.id, 'name', event.target.value)
              }
              className="field"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={party.email || ''}
              onChange={(event) =>
                onUpdate(kind, party.id, 'email', event.target.value)
              }
              className="field"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={party.phone || ''}
              onChange={(event) =>
                onUpdate(kind, party.id, 'phone', event.target.value)
              }
              className="field"
            />
          </Field>
          <Field label="Postcode">
            <input
              inputMode="numeric"
              maxLength={4}
              value={party.postcode || ''}
              onChange={(event) =>
                onUpdate(
                  kind,
                  party.id,
                  'postcode',
                  event.target.value.replace(/\D/g, '').slice(0, 4)
                )
              }
              className="field"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Postal / service address">
              <input
                value={party.address || ''}
                onChange={(event) =>
                  onUpdate(kind, party.id, 'address', event.target.value)
                }
                className="field"
              />
            </Field>
          </div>
        </div>
      </div>
    ))}

    <button
      type="button"
      onClick={() => onAdd(kind)}
      className="inline-flex items-center gap-2 text-xs font-bold text-[#006D70] hover:underline"
    >
      <Plus className="w-4 h-4" />
      Add another {title.toLowerCase()}
    </button>
  </div>
);

const WorkflowFieldControl: React.FC<{
  field: DocumentWorkflowField;
  value: DocumentWorkflowAnswer | undefined;
  answers: Record<string, DocumentWorkflowAnswer>;
  lessors: DocumentParty[];
  tenants: DocumentParty[];
  error?: string;
  onChange: (value: DocumentWorkflowAnswer) => void;
}> = ({
  field,
  value,
  lessors,
  tenants,
  error,
  onChange,
}) => {
  if (field.type === 'party-electronic-consents') {
    const consentMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const parties = [
      ...lessors.map((party) => ({ ...party, typeLabel: 'Lessor' })),
      ...tenants.map((party) => ({ ...party, typeLabel: 'Tenant' })),
    ];

    const updateConsent = (
      partyId: string,
      fieldName: string,
      nextValue: string
    ) => {
      const current =
        consentMap[partyId] &&
        typeof consentMap[partyId] === 'object' &&
        !Array.isArray(consentMap[partyId])
          ? (consentMap[partyId] as Record<string, unknown>)
          : {};

      onChange({
        ...consentMap,
        [partyId]: {
          ...current,
          [fieldName]: nextValue,
        },
      });
    };

    return (
      <div>
        <WorkflowLabel field={field} />
        <div className="space-y-3">
          {parties.map((party) => {
            const current =
              consentMap[party.id] &&
              typeof consentMap[party.id] === 'object' &&
              !Array.isArray(consentMap[party.id])
                ? (consentMap[party.id] as Record<string, unknown>)
                : {};

            return (
              <div
                key={party.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <strong className="text-sm text-[#1A2B4A]">
                  {party.typeLabel}: {party.name}
                </strong>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Email notices">
                    <select
                      value={String(current.email || '')}
                      onChange={(event) =>
                        updateConsent(
                          party.id,
                          'email',
                          event.target.value
                        )
                      }
                      className="field"
                    >
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>
                  <Field label="Fax notices">
                    <select
                      value={String(current.fax || '')}
                      onChange={(event) =>
                        updateConsent(party.id, 'fax', event.target.value)
                      }
                      className="field"
                    >
                      <option value="">Select...</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>
                  {current.fax === 'yes' && (
                    <Field label="Fax number">
                      <input
                        value={String(current.faxNumber || '')}
                        onChange={(event) =>
                          updateConsent(
                            party.id,
                            'faxNumber',
                            event.target.value
                          )
                        }
                        className="field"
                      />
                    </Field>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {field.help && (
          <p className="mt-2 text-xs text-slate-500">{field.help}</p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  if (field.type === 'party-payouts') {
    const payoutMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const parties = [
      ...tenants.map((party) => ({ ...party, typeLabel: 'Tenant' })),
      ...lessors.map((party) => ({ ...party, typeLabel: 'Lessor' })),
    ];

    const updatePayout = (
      partyId: string,
      fieldName: string,
      nextValue: string
    ) => {
      const current =
        payoutMap[partyId] &&
        typeof payoutMap[partyId] === 'object' &&
        !Array.isArray(payoutMap[partyId])
          ? (payoutMap[partyId] as Record<string, unknown>)
          : {};

      onChange({
        ...payoutMap,
        [partyId]: {
          ...current,
          [fieldName]: nextValue,
        },
      });
    };

    return (
      <div>
        <WorkflowLabel field={field} />
        <div className="space-y-3">
          {parties.map((party) => {
            const current =
              payoutMap[party.id] &&
              typeof payoutMap[party.id] === 'object' &&
              !Array.isArray(payoutMap[party.id])
                ? (payoutMap[party.id] as Record<string, unknown>)
                : {};

            return (
              <div
                key={party.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <strong className="text-sm text-[#1A2B4A]">
                  {party.typeLabel}: {party.name}
                </strong>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Amount to be paid">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(current.amount || '')}
                      onChange={(event) =>
                        updatePayout(
                          party.id,
                          'amount',
                          event.target.value
                        )
                      }
                      className="field"
                    />
                  </Field>
                  <Field label="Account name">
                    <input
                      value={String(current.accountName || '')}
                      onChange={(event) =>
                        updatePayout(
                          party.id,
                          'accountName',
                          event.target.value
                        )
                      }
                      className="field"
                    />
                  </Field>
                  <Field label="BSB">
                    <input
                      value={String(current.bsb || '')}
                      onChange={(event) =>
                        updatePayout(party.id, 'bsb', event.target.value)
                      }
                      className="field"
                    />
                  </Field>
                  <Field label="Account number">
                    <input
                      value={String(current.accountNumber || '')}
                      onChange={(event) =>
                        updatePayout(
                          party.id,
                          'accountNumber',
                          event.target.value
                        )
                      }
                      className="field"
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Australian financial institution">
                      <input
                        value={String(current.institution || '')}
                        onChange={(event) =>
                          updatePayout(
                            party.id,
                            'institution',
                            event.target.value
                          )
                        }
                        className="field"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {field.help && (
          <p className="mt-2 text-xs text-slate-500">{field.help}</p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  if (field.type === 'tenant-select') {
    return (
      <Field label={field.label} required={field.required} error={error}>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="field"
        >
          <option value="">Select tenant...</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
        {field.help && (
          <span className="block mt-1 text-xs text-slate-500">
            {field.help}
          </span>
        )}
      </Field>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#007F82]"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-800">
              {field.label}
              {field.required && (
                <span className="text-rose-500"> *</span>
              )}
            </span>
            {field.help && (
              <span className="block mt-1 text-xs text-slate-500">
                {field.help}
              </span>
            )}
          </span>
        </label>
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];

    const toggle = (optionValue: string) => {
      onChange(
        selected.includes(optionValue)
          ? selected.filter((item) => item !== optionValue)
          : [...selected, optionValue]
      );
    };

    return (
      <div>
        <WorkflowLabel field={field} />
        <div className="grid grid-cols-1 gap-2">
          {(field.options || []).map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                className="mt-0.5 w-4 h-4 accent-[#007F82]"
              />
              <span className="text-sm text-slate-700">{option.label}</span>
            </label>
          ))}
        </div>
        {field.help && (
          <p className="mt-2 text-xs text-slate-500">{field.help}</p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  const stringValue =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';

  if (field.type === 'textarea') {
    return (
      <Field label={field.label} required={field.required} error={error}>
        <textarea
          rows={4}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          className="field resize-y"
        />
        {field.help && (
          <span className="block mt-1 text-xs text-slate-500">
            {field.help}
          </span>
        )}
      </Field>
    );
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label} required={field.required} error={error}>
        <select
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          className="field"
        >
          <option value="">Select...</option>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.help && (
          <span className="block mt-1 text-xs text-slate-500">
            {field.help}
          </span>
        )}
      </Field>
    );
  }

  if (field.type === 'radio') {
    return (
      <div>
        <WorkflowLabel field={field} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(field.options || []).map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer ${
                stringValue === option.value
                  ? 'border-[#00B5B8] bg-[#F0FBFB]'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name={field.id}
                value={option.value}
                checked={stringValue === option.value}
                onChange={() => onChange(option.value)}
                className="mt-0.5 accent-[#007F82]"
              />
              <span className="text-sm text-slate-700">{option.label}</span>
            </label>
          ))}
        </div>
        {field.help && (
          <p className="mt-2 text-xs text-slate-500">{field.help}</p>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  return (
    <Field label={field.label} required={field.required} error={error}>
      <input
        type={
          field.type === 'date'
            ? 'date'
            : field.type === 'number' || field.type === 'currency'
              ? 'number'
              : field.type === 'email'
                ? 'email'
                : field.type === 'phone'
                  ? 'tel'
                  : 'text'
        }
        min={field.min}
        max={field.max}
        step={field.type === 'currency' ? '0.01' : undefined}
        value={stringValue}
        onChange={(event) =>
          onChange(
            field.type === 'number' || field.type === 'currency'
              ? event.target.value
              : event.target.value
          )
        }
        placeholder={field.placeholder}
        className="field"
      />
      {field.help && (
        <span className="block mt-1 text-xs text-slate-500">
          {field.help}
        </span>
      )}
    </Field>
  );
};

const WorkflowLabel: React.FC<{ field: DocumentWorkflowField }> = ({
  field,
}) => (
  <div className="mb-2">
    <span className="block text-xs font-bold uppercase tracking-wider text-slate-700">
      {field.label}
      {field.required && <span className="text-rose-500"> *</span>}
    </span>
  </div>
);

const FieldError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="block mt-1 text-xs font-medium text-rose-600">
    {children}
  </span>
);

const ReviewSection: React.FC<{
  title: string;
  items: Array<[string, string]>;
  onEdit: () => void;
}> = ({ title, items, onEdit }) => (
  <div className="p-5 border-t border-slate-200">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h3 className="font-bold text-[#1A2B4A]">{title}</h3>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs font-bold text-[#006D70] hover:underline"
      >
        Edit
      </button>
    </div>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([label, value]) => (
        <div key={`${title}-${label}`}>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">
            {label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-800 whitespace-pre-wrap">
            {value || '—'}
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

function formatWorkflowAnswer(
  field: DocumentWorkflowField,
  value: DocumentWorkflowAnswer | undefined,
  lessors: DocumentParty[],
  tenants: DocumentParty[]
): string {
  if (value === undefined || value === null || value === '') return '';

  if (field.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }

  if (field.type === 'currency') {
    return currencyDisplay(value);
  }

  if (field.type === 'select' || field.type === 'radio') {
    return (
      field.options?.find((option) => option.value === String(value))?.label ||
      String(value)
    );
  }

  if (field.type === 'multiselect' && Array.isArray(value)) {
    return value
      .map(
        (item) =>
          field.options?.find((option) => option.value === item)?.label ||
          String(item)
      )
      .join('; ');
  }

  if (field.type === 'tenant-select') {
    return (
      tenants.find((tenant) => tenant.id === String(value))?.name ||
      String(value)
    );
  }

  if (
    field.type === 'party-electronic-consents' &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const consentMap = value as Record<string, unknown>;
    return [...lessors, ...tenants]
      .map((party) => {
        const entry =
          consentMap[party.id] &&
          typeof consentMap[party.id] === 'object' &&
          !Array.isArray(consentMap[party.id])
            ? (consentMap[party.id] as Record<string, unknown>)
            : {};
        return `${party.name}: email ${String(entry.email || 'not selected')}, fax ${String(entry.fax || 'not selected')}`;
      })
      .join('\n');
  }

  if (
    field.type === 'party-payouts' &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const payoutMap = value as Record<string, unknown>;
    return [...tenants, ...lessors]
      .map((party) => {
        const entry =
          payoutMap[party.id] &&
          typeof payoutMap[party.id] === 'object' &&
          !Array.isArray(payoutMap[party.id])
            ? (payoutMap[party.id] as Record<string, unknown>)
            : {};
        const amount = currencyDisplay(entry.amount);
        const account = maskSensitiveValue(entry.accountNumber);
        return `${party.name}: ${amount || '$0.00'}${account ? ` to account ${account}` : ''}`;
      })
      .join('\n');
  }

  if (field.sensitive) {
    return maskSensitiveValue(value);
  }

  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') return 'Recorded securely';
  return String(value);
}
