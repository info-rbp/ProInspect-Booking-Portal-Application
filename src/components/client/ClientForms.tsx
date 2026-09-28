import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, FileText, Loader2, Plus, Upload, Wrench } from 'lucide-react';
import type {
  ClientDocumentRequestInput,
  ClientMaintenanceRequestInput,
  ClientOnboardingInput,
  ClientPortalDashboard,
  ClientProperty,
  ClientPropertyInput,
  ClientRequestSummary,
} from '../../types/clientPortal';
import type { PropertyType, ServiceCategory } from '../../types/booking';
import {
  completeClientOnboarding,
  createClientDocumentRequest,
  createClientMaintenanceRequest,
  createClientProperty,
  generateClientDocumentDraft,
  updateClientProperty,
  uploadClientFile,
} from '../../services/api';

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

const CATEGORY_OPTIONS: Array<{ value: ServiceCategory; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'strata-building', label: 'Strata / Building' },
];

const inputClass =
  'w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-[#00B5B8]';
const textareaClass =
  'w-full px-3 py-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-[#00B5B8]';

function PropertyFields({
  value,
  onChange,
}: {
  value: ClientPropertyInput;
  onChange: (value: ClientPropertyInput) => void;
}) {
  function set<K extends keyof ClientPropertyInput>(
    key: K,
    next: ClientPropertyInput[K]
  ) {
    onChange({ ...value, [key]: next });
  }

  const toggleCategory = (category: ServiceCategory) => {
    const categories = value.categories.includes(category)
      ? value.categories.filter((item) => item !== category)
      : [...value.categories, category];
    set('categories', categories);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Street address</label>
          <input className={inputClass} value={value.streetAddress} onChange={(e) => set('streetAddress', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Unit / Lot</label>
          <input className={inputClass} value={value.unit || ''} onChange={(e) => set('unit', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_110px] gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Suburb</label>
          <input className={inputClass} value={value.suburb} onChange={(e) => set('suburb', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">State</label>
          <select className={inputClass} value={value.state} onChange={(e) => set('state', e.target.value)}>
            {['WA','NSW','VIC','QLD','SA','TAS','ACT','NT'].map((state) => <option key={state}>{state}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Postcode</label>
          <input className={inputClass} inputMode="numeric" maxLength={4} value={value.postcode} onChange={(e) => set('postcode', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Property type</label>
          <select className={inputClass} value={value.propertyType} onChange={(e) => set('propertyType', e.target.value as PropertyType)}>
            {PROPERTY_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Property name / nickname</label>
          <input className={inputClass} value={value.nickname || ''} onChange={(e) => set('nickname', e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-2">Service categories</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleCategory(option.value)}
              className={`px-3 py-2 rounded-lg border text-xs font-bold ${
                value.categories.includes(option.value)
                  ? 'border-[#00B5B8] bg-[#F0FBFB] text-[#006D70]'
                  : 'border-slate-300 text-slate-600'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Client / property reference</label>
        <input className={inputClass} value={value.clientReference || ''} onChange={(e) => set('clientReference', e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Property notes</label>
        <textarea className={textareaClass} rows={3} value={value.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Optional operational notes" />
      </div>
    </div>
  );
}

const emptyProperty = (): ClientPropertyInput => ({
  streetAddress: '',
  unit: '',
  suburb: '',
  state: 'WA',
  postcode: '',
  propertyType: 'House',
  categories: ['residential'],
  nickname: '',
  clientReference: '',
  notes: '',
});

export function AddPropertyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (property: ClientProperty) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<ClientPropertyInput>(emptyProperty());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const property = await createClientProperty(value);
      onCreated(property);
    } catch (err: any) {
      setError(err?.message || 'Unable to add property.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h2 className="font-bold text-lg text-[#1A2B4A]">Add a property</h2>
      <p className="mt-1 text-sm text-slate-500">Create a saved property that can be used across bookings, requests and documents.</p>
      <div className="mt-5"><PropertyFields value={value} onChange={setValue} /></div>
      {error && <div className="mt-4 text-sm text-rose-700">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button>
        <button type="button" disabled={saving} onClick={submit} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Property
        </button>
      </div>
    </div>
  );
}

export function EditPropertyForm({
  property,
  onSaved,
  onArchived,
  onCancel,
}: {
  property: ClientProperty;
  onSaved: () => void;
  onArchived: () => void;
  onCancel: () => void;
}) {
  const [nickname, setNickname] = useState(property.nickname || '');
  const [clientReference, setClientReference] = useState(property.clientReference || '');
  const [categories, setCategories] = useState<ServiceCategory[]>(property.categories);
  const [notes, setNotes] = useState(property.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (category: ServiceCategory) => {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    );
  };

  const save = async () => {
    if (categories.length === 0) {
      setError('Select at least one property service category.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateClientProperty(property.id, {
        nickname: nickname.trim() || undefined,
        clientReference: clientReference.trim() || undefined,
        categories,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Unable to update this property.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (
      !window.confirm(
        'Archive this property? Existing bookings, requests and documents will be retained, but the property will no longer appear in the active property list.'
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateClientProperty(property.id, { status: 'inactive' });
      onArchived();
    } catch (err: any) {
      setError(err?.message || 'Unable to archive this property.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#00B5B8]/30 bg-white p-5 sm:p-6">
      <h2 className="font-bold text-lg text-[#1A2B4A]">Edit property</h2>
      <p className="mt-1 text-xs text-slate-500">
        The property address is fixed to preserve booking and document links. Create a new property if the address itself changes.
      </p>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Property name / nickname</label>
          <input className={inputClass} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Client / property reference</label>
          <input className={inputClass} value={clientReference} onChange={(e) => setClientReference(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-600 mb-2">Service categories</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleCategory(option.value)}
                className={`px-3 py-2 rounded-lg border text-xs font-bold ${
                  categories.includes(option.value)
                    ? 'border-[#00B5B8] bg-[#F0FBFB] text-[#006D70]'
                    : 'border-slate-300 text-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-600 mb-1">Property notes</label>
          <textarea className={textareaClass} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {error && <div className="mt-4 text-sm text-rose-700">{error}</div>}

      <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={archive}
          className="px-4 py-2.5 text-sm font-semibold text-rose-600 disabled:opacity-50"
        >
          Archive Property
        </button>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onCancel} className="px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Property
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientOnboardingWizard({
  dashboard,
  onComplete,
  onCancel,
}: {
  dashboard: ClientPortalDashboard;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [includeProperty, setIncludeProperty] = useState(dashboard.properties.length === 0);
  const [value, setValue] = useState<ClientOnboardingInput>({
    displayName: dashboard.profile.displayName,
    phone: dashboard.profile.phone || '',
    organisationName: dashboard.organisation.name,
    entityType: dashboard.organisation.entityType,
    abn: dashboard.organisation.abn || '',
    acn: dashboard.organisation.acn || '',
    billingEmail: dashboard.organisation.billingEmail || dashboard.profile.email,
  });
  const [property, setProperty] = useState<ClientPropertyInput>(emptyProperty());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      await completeClientOnboarding({
        ...value,
        firstProperty: includeProperty ? property : undefined,
      });
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Unable to complete onboarding.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">Client onboarding · Step {step} of 3</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#1A2B4A]">
          {step === 1 ? 'Your contact details' : step === 2 ? 'Organisation details' : 'Property setup'}
        </h1>

        {step === 1 && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Your name</label>
              <input className={inputClass} value={value.displayName} onChange={(e) => setValue({ ...value, displayName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
              <input className={inputClass} value={value.phone || ''} onChange={(e) => setValue({ ...value, phone: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">Account email</label>
              <input className={inputClass} value={dashboard.profile.email} disabled />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">Organisation / ownership name</label>
              <input className={inputClass} value={value.organisationName} onChange={(e) => setValue({ ...value, organisationName: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Entity type</label>
              <select className={inputClass} value={value.entityType} onChange={(e) => setValue({ ...value, entityType: e.target.value as ClientOnboardingInput['entityType'] })}>
                <option value="individual">Individual</option>
                <option value="company">Company</option>
                <option value="trust">Trust</option>
                <option value="partnership">Partnership</option>
                <option value="strata">Strata company</option>
                <option value="agency">Agency / business</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Billing email</label>
              <input className={inputClass} value={value.billingEmail || ''} onChange={(e) => setValue({ ...value, billingEmail: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">ABN</label>
              <input className={inputClass} value={value.abn || ''} onChange={(e) => setValue({ ...value, abn: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">ACN</label>
              <input className={inputClass} value={value.acn || ''} onChange={(e) => setValue({ ...value, acn: e.target.value })} placeholder="Optional" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-6">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-5">
              <input type="checkbox" checked={includeProperty} onChange={(e) => setIncludeProperty(e.target.checked)} />
              Add the first property now
            </label>
            {includeProperty ? <PropertyFields value={property} onChange={setProperty} /> : (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-5 text-sm text-slate-600">
                You can add properties from the Properties area after onboarding.
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-5 flex items-start gap-2 text-sm text-rose-700"><AlertCircle className="w-4 h-4 mt-0.5" />{error}</div>}

        <div className="mt-7 flex justify-between gap-3">
          <button type="button" disabled={step === 1 || saving} onClick={() => setStep(step - 1)} className="px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-30">
            Back
          </button>
          {step < 3 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" disabled={saving} onClick={finish} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Complete Onboarding
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilePicker({
  files,
  setFiles,
}: {
  files: File[];
  setFiles: (files: File[]) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1">Supporting files</label>
      <label className="flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-xl p-4 text-sm font-semibold text-slate-600 hover:border-[#00B5B8] cursor-pointer">
        <Upload className="w-4 h-4" />
        Add files (up to 10 MB each)
        <input
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt,.csv"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </label>
      {files.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {files.map((file) => <div key={file.name}>{file.name} · {Math.ceil(file.size / 1024)} KB</div>)}
        </div>
      )}
    </div>
  );
}

export function DocumentRequestForm({
  dashboard,
  initialPropertyId,
  onSubmitted,
  onCancel,
}: {
  dashboard: ClientPortalDashboard;
  initialPropertyId?: string;
  onSubmitted: (request: ClientRequestSummary) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<ClientDocumentRequestInput>({
    propertyId: initialPropertyId || dashboard.properties[0]?.id || '',
    documentType: 'Commercial Lease',
    counterpartyName: '',
    commencementDate: '',
    term: '',
    rent: '',
    permittedUse: '',
    specialConditions: '',
    instructions: '',
    dueDate: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [generateDraft, setGenerateDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const request = await createClientDocumentRequest(value);
      for (const file of files) {
        await uploadClientFile({
          file,
          propertyId: value.propertyId,
          requestId: request.id,
          documentType: 'Document Request Supporting File',
        });
      }
      if (generateDraft) {
        await generateClientDocumentDraft(request.id);
      }
      onSubmitted(request);
    } catch (err: any) {
      setError(err?.message || 'Unable to submit document request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#1A2B4A]">Request a Document</h1>
            <p className="mt-1 text-sm text-slate-500">Provide structured instructions so the request is attached to the correct client and property records.</p>
          </div>
        </div>
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Property</label>
            <select className={inputClass} value={value.propertyId || ''} onChange={(e) => setValue({ ...value, propertyId: e.target.value || undefined })}>
              <option value="">No specific property</option>
              {dashboard.properties.map((property) => <option key={property.id} value={property.id}>{property.nickname || property.streetAddress}, {property.suburb}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Document type</label>
            <select className={inputClass} value={value.documentType} onChange={(e) => setValue({ ...value, documentType: e.target.value as ClientDocumentRequestInput['documentType'] })}>
              {['Commercial Lease','Lease Variation','Lease Renewal / Extension','Notice / Letter','Authority / Agreement','Other'].map((type) => <option key={type}>{type}</option>)}
            </select>
          </div>
          {value.documentType === 'Other' && (
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Document title</label>
              <input className={inputClass} value={value.title || ''} onChange={(e) => setValue({ ...value, title: e.target.value })} />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Counterparty / recipient</label><input className={inputClass} value={value.counterpartyName || ''} onChange={(e) => setValue({ ...value, counterpartyName: e.target.value })} /></div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Commencement date</label><input type="date" className={inputClass} value={value.commencementDate || ''} onChange={(e) => setValue({ ...value, commencementDate: e.target.value })} /></div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Term</label><input className={inputClass} value={value.term || ''} onChange={(e) => setValue({ ...value, term: e.target.value })} placeholder="e.g. 5 years + 5 year option" /></div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Rent / consideration</label><input className={inputClass} value={value.rent || ''} onChange={(e) => setValue({ ...value, rent: e.target.value })} placeholder="Optional" /></div>
          </div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Permitted use</label><input className={inputClass} value={value.permittedUse || ''} onChange={(e) => setValue({ ...value, permittedUse: e.target.value })} /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Special conditions</label><textarea className={textareaClass} rows={3} value={value.specialConditions || ''} onChange={(e) => setValue({ ...value, specialConditions: e.target.value })} /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Drafting instructions *</label><textarea className={textareaClass} rows={5} value={value.instructions} onChange={(e) => setValue({ ...value, instructions: e.target.value })} /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Required by</label><input type="date" className={inputClass} value={value.dueDate || ''} onChange={(e) => setValue({ ...value, dueDate: e.target.value })} /></div>
          <FilePicker files={files} setFiles={setFiles} />
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
            <input type="checkbox" checked={generateDraft} onChange={(e) => setGenerateDraft(e.target.checked)} className="mt-1" />
            <span><strong>Generate a preparation summary now.</strong><br /><span className="text-xs text-slate-500">The summary records your drafting instructions for review. It is not the completed legal or statutory document and cannot be issued or signed as one.</span></span>
          </label>
        </div>
        {error && <div className="mt-4 text-sm text-rose-700">{error}</div>}
        <div className="mt-6 flex justify-end">
          <button type="button" disabled={saving} onClick={submit} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Document Request
          </button>
        </div>
      </div>
    </div>
  );
}

export function MaintenanceRequestForm({
  dashboard,
  initialPropertyId,
  onSubmitted,
  onCancel,
}: {
  dashboard: ClientPortalDashboard;
  initialPropertyId?: string;
  onSubmitted: (request: ClientRequestSummary) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<ClientMaintenanceRequestInput>({
    propertyId: initialPropertyId || dashboard.properties[0]?.id || '',
    issueType: 'General Repair',
    title: '',
    description: '',
    location: '',
    priority: 'routine',
    activeWater: false,
    powerAffected: false,
    propertySecure: true,
    accessNotes: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const request = await createClientMaintenanceRequest(value);
      for (const file of files) {
        await uploadClientFile({
          file,
          propertyId: value.propertyId,
          requestId: request.id,
          documentType: 'Maintenance Attachment',
        });
      }
      onSubmitted(request);
    } catch (err: any) {
      setError(err?.message || 'Unable to submit maintenance request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0"><Wrench className="w-5 h-5" /></div>
          <div><h1 className="text-2xl font-extrabold text-[#1A2B4A]">Maintenance Request</h1><p className="mt-1 text-sm text-slate-500">Create a trackable property maintenance request and attach supporting photos or documents.</p></div>
        </div>
        <div className="mt-6 space-y-4">
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Property *</label><select className={inputClass} value={value.propertyId} onChange={(e) => setValue({ ...value, propertyId: e.target.value })}><option value="">Select property</option>{dashboard.properties.map((property) => <option key={property.id} value={property.id}>{property.nickname || property.streetAddress}, {property.suburb}</option>)}</select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Issue type *</label><select className={inputClass} value={value.issueType} onChange={(e) => setValue({ ...value, issueType: e.target.value as ClientMaintenanceRequestInput['issueType'] })}>{['Plumbing','Electrical','Air Conditioning','Appliance','Door / Window','Security','Water Ingress','General Repair','Other'].map((type) => <option key={type}>{type}</option>)}</select></div>
            <div><label className="block text-xs font-bold text-slate-600 mb-1">Priority *</label><select className={inputClass} value={value.priority} onChange={(e) => setValue({ ...value, priority: e.target.value as ClientMaintenanceRequestInput['priority'] })}><option value="routine">Routine</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Request title *</label><input className={inputClass} value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder="e.g. Rear roller door not closing" /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Location</label><input className={inputClass} value={value.location || ''} onChange={(e) => setValue({ ...value, location: e.target.value })} placeholder="Room, common area or location" /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Describe the issue *</label><textarea className={textareaClass} rows={5} value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(value.activeWater)} onChange={(e) => setValue({ ...value, activeWater: e.target.checked })} /> Active water / leak</label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(value.powerAffected)} onChange={(e) => setValue({ ...value, powerAffected: e.target.checked })} /> Power affected</label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={value.propertySecure !== false} onChange={(e) => setValue({ ...value, propertySecure: e.target.checked })} /> Property secure</label>
          </div>
          {(value.priority === 'urgent' ||
            value.activeWater ||
            value.powerAffected ||
            value.propertySecure === false) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
              <strong>Urgent maintenance is not an emergency-response service.</strong>{' '}
              If there is an immediate threat to life or safety, call 000. Where it is safe to do so,
              take reasonable steps to prevent further damage and use the appropriate emergency
              contractor or authority while ProInspect reviews this request.
            </div>
          )}
          <div><label className="block text-xs font-bold text-slate-600 mb-1">Access / contractor notes</label><textarea className={textareaClass} rows={3} value={value.accessNotes || ''} onChange={(e) => setValue({ ...value, accessNotes: e.target.value })} /></div>
          <FilePicker files={files} setFiles={setFiles} />
        </div>
        {error && <div className="mt-4 text-sm text-rose-700">{error}</div>}
        <div className="mt-6 flex justify-end">
          <button type="button" disabled={saving} onClick={submit} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Submit Maintenance Request
          </button>
        </div>
      </div>
    </div>
  );
}
