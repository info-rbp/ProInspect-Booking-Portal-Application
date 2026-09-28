import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  HeartHandshake,
  Landmark,
  Loader2,
  PawPrint,
  Plus,
  Shield,
  ShieldAlert,
  Sofa,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import type { TenantDocument, TenantTenancyView } from '../../types/tenant';
import type {
  TenantFormDefinition,
  TenantFormRequest,
  TenantFormWorkflowType,
  TenantFormsDashboard,
} from '../../types/tenantForms';
import {
  createSensitiveTenantFormDraft,
  fetchTenantFormsDashboard,
  submitSensitiveTenantFormWorkflow,
  submitTenantFormRequest,
  uploadSensitiveTenantEvidence,
  uploadTenantFormAttachment,
} from '../../services/api';

type Props = {
  tenancies: TenantTenancyView[];
  documents: TenantDocument[];
};

type DistributionRow = {
  name: string;
  role: 'tenant' | 'landlord';
  amount: string;
};

type PcrRow = {
  area: string;
  item: string;
  agreement: 'agree' | 'disagree';
  comments: string;
};

const MINOR_MODIFICATIONS = [
  'Picture hooks',
  'Wall mount / shelf / bracket screw',
  'Wall anchoring device',
  'Water-saving shower head',
  'Hand-held shower head',
  'LED light bulbs without new fittings',
  'Window covering / curtains / blinds',
  'Curtain or blind cord anchor',
  'Child safety lock or device',
  'Pressure-mounted safety gate',
  'Letterbox or gate lock',
  'Wireless doorbell',
  'Vegetable or herb garden',
  'Flyscreens',
  'Draughtproofing',
  'Lever-style taps',
  'Phone or internet connection',
  'Painting a room',
  'Non-permanent window film',
  'Hard-wired security light / alarm / camera',
  'Other minor modification',
];

const FORM_ICONS: Record<TenantFormWorkflowType, React.ComponentType<{ className?: string }>> = {
  furniture_safety: Sofa,
  pet_request: PawPrint,
  minor_modification: Wrench,
  major_modification: Wrench,
  bond_release: Landmark,
  bond_variation: Landmark,
  pcr_response: FileText,
  family_violence_termination: ShieldAlert,
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  }).format(date);
}

function statusClass(status: string) {
  if (['approved', 'approved_with_conditions', 'agreed', 'processed', 'completed', 'closed'].includes(status)) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (['declined', 'disputed', 'commissioner_review_required'].includes(status)) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (['response_period_elapsed', 'action_required', 'more_information_required'].includes(status)) {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export const TenantStatutoryForms: React.FC<Props> = ({ tenancies, documents }) => {
  const [dashboard, setDashboard] = useState<TenantFormsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TenantFormDefinition | null>(null);
  const [tenancyId, setTenancyId] = useState(tenancies[0]?.tenancy.id || '');
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [distributions, setDistributions] = useState<DistributionRow[]>([
    { name: '', role: 'tenant', amount: '' },
  ]);
  const [pcrRows, setPcrRows] = useState<PcrRow[]>([
    { area: '', item: '', agreement: 'agree', comments: '' },
  ]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await fetchTenantFormsDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tenancy forms.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!tenancyId && tenancies[0]) setTenancyId(tenancies[0].tenancy.id);
  }, [tenancies, tenancyId]);

  const selectedTenancy = useMemo(
    () => tenancies.find((item) => item.tenancy.id === tenancyId),
    [tenancies, tenancyId]
  );

  const pcrDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.category === 'property_condition_report' &&
          (!document.tenancyId || document.tenancyId === tenancyId)
      ),
    [documents, tenancyId]
  );

  const normalDefinitions = useMemo(
    () => dashboard?.definitions.filter((definition) => !definition.sensitive) || [],
    [dashboard]
  );
  const privateDefinition = dashboard?.definitions.find(
    (definition) => definition.workflowType === 'family_violence_termination'
  );

  const requestDefinitions = normalDefinitions.filter((item) => item.category === 'request');
  const bondDefinitions = normalDefinitions.filter((item) => item.category === 'bond');
  const inspectionDefinitions = normalDefinitions.filter((item) => item.category === 'inspection');

  const reset = () => {
    setSelected(null);
    setPayload({});
    setFiles([]);
    setSuccess(null);
    setError(null);
    setDistributions([{ name: '', role: 'tenant', amount: '' }]);
    setPcrRows([{ area: '', item: '', agreement: 'agree', comments: '' }]);
  };

  const start = (definition: TenantFormDefinition) => {
    setSelected(definition);
    setSuccess(null);
    setError(null);
    setFiles([]);

    const next: Record<string, unknown> = {};
    if (definition.workflowType === 'bond_release') {
      next.bondReference = selectedTenancy?.tenancy.bondReference || '';
      next.tenancyEndDate = selectedTenancy?.tenancy.endDate || '';
    }
    if (definition.workflowType === 'pcr_response' && pcrDocuments[0]) {
      next.sourceDocumentId = pcrDocuments[0].id;
    }
    setPayload(next);
  };

  const set = (key: string, value: unknown) => {
    setPayload((current) => ({ ...current, [key]: value }));
  };

  const submitNormal = async () => {
    if (!selected || !tenancyId) return;
    setBusy(true);
    setError(null);
    try {
      const finalPayload: Record<string, unknown> = { ...payload };
      if (selected.workflowType === 'bond_release') {
        finalPayload.proposedDistributions = distributions
          .filter((row) => row.name.trim() && row.amount.trim())
          .map((row) => ({
            name: row.name.trim(),
            role: row.role,
            amount: Number(row.amount),
          }));
      }
      if (selected.workflowType === 'pcr_response') {
        finalPayload.responses = pcrRows
          .filter((row) => row.area.trim() && row.item.trim())
          .map((row) => ({
            area: row.area.trim(),
            item: row.item.trim(),
            agreement: row.agreement,
            comments: row.comments.trim(),
          }));
      }

      let request = await submitTenantFormRequest({
        tenancyId,
        formDefinitionId: selected.id,
        payload: finalPayload,
      });

      for (const file of files) {
        request = await uploadTenantFormAttachment(request.id, file);
      }

      setSuccess(`${request.reference} submitted successfully.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit tenancy form.');
    } finally {
      setBusy(false);
    }
  };

  const submitSensitive = async () => {
    if (!selected || !tenancyId) return;
    if (files.length === 0) {
      setError('At least one qualifying evidence document is required.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const draft = await createSensitiveTenantFormDraft({
        tenancyId,
        formDefinitionId: selected.id,
        payload,
      });
      for (const file of files) {
        await uploadSensitiveTenantEvidence(draft.id, file);
      }
      const submitted = await submitSensitiveTenantFormWorkflow(draft.id);
      setSuccess(`${submitted.reference} submitted to the restricted ProInspect workflow.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit private tenancy workflow.');
    } finally {
      setBusy(false);
    }
  };

  const card = (definition: TenantFormDefinition) => {
    const Icon = FORM_ICONS[definition.workflowType];
    return (
      <button
        key={definition.id}
        type="button"
        onClick={() => start(definition)}
        className="text-left rounded-xl border border-slate-200 bg-white p-5 hover:border-[#00B5B8] hover:shadow-sm transition-all"
      >
        <div className="w-10 h-10 rounded-lg bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div className="mt-3 font-extrabold text-[#1A2B4A]">{definition.shortName}</div>
        <div className="mt-1 text-xs text-slate-500 leading-relaxed">{definition.description}</div>
        <div className="mt-3 text-[10px] uppercase tracking-wider font-black text-[#007F82]">
          {definition.formCode.startsWith('BOND') ? definition.formCode.replaceAll('-', ' ') : `Form ${definition.formCode}`}
        </div>
      </button>
    );
  };

  if (loading && !dashboard) {
    return (
      <div className="py-12 flex justify-center items-center gap-2 text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-[#007F82]" />
        Loading tenancy forms…
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-xl font-extrabold text-[#1A2B4A]">Forms &amp; Tenancy Actions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Submit prescribed tenancy requests, bond workflows and your Property Condition Report response online.
        </p>
      </div>

      {error && !selected && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <section>
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Requests</h3>
        <div className="mt-3 grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {requestDefinitions.map(card)}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Bond</h3>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {bondDefinitions.map(card)}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Property Condition Report</h3>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {inspectionDefinitions.map(card)}
        </div>
        {pcrDocuments.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            A tenant-visible entry Property Condition Report must be uploaded before the online PCR response workflow can be submitted.
          </p>
        )}
      </section>

      {privateDefinition && (
        <section className="rounded-xl border border-slate-300 bg-slate-50 p-5">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-slate-700 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-extrabold text-[#1A2B4A]">Private &amp; Sensitive Support</h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                A restricted tenancy workflow is available for family-violence circumstances. Evidence is stored separately and is not shown in the normal Client Portal or Operations queue.
              </p>
              <button
                type="button"
                onClick={() => start(privateDefinition)}
                className="mt-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold"
              >
                Open Private Workflow
              </button>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Submitted Forms</h3>
        <div className="mt-3 space-y-3">
          {dashboard?.requests.map((request) => (
            <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-[#1A2B4A]">{request.formName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {request.reference} · submitted {formatDate(request.submittedAt)}
                  </div>
                  {request.responseDueAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      Response / action date: {formatDate(request.responseDueAt)}
                    </div>
                  )}
                </div>
                <span className={`self-start text-[10px] uppercase font-black px-2 py-1 rounded-full border ${statusClass(request.status)}`}>
                  {request.status.replaceAll('_', ' ')}
                </span>
              </div>
              {request.status === 'response_period_elapsed' && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  The recorded response period has elapsed. ProInspect should review the applicable statutory outcome before this request is treated as final.
                </div>
              )}
            </div>
          ))}
          {dashboard?.sensitiveRequests.map((request) => (
            <div key={request.id} className="rounded-xl border border-slate-300 bg-slate-50 p-4">
              <div className="flex justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-800">Private tenancy workflow</div>
                  <div className="mt-1 text-xs text-slate-500">{request.reference} · submitted {formatDate(request.submittedAt || request.createdAt)}</div>
                </div>
                <span className="self-start text-[10px] uppercase font-black px-2 py-1 rounded-full border border-slate-300 text-slate-600">
                  {request.status.replaceAll('_', ' ')}
                </span>
              </div>
            </div>
          ))}
          {!dashboard?.requests.length && !dashboard?.sensitiveRequests.length && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No tenancy forms have been submitted yet.
            </div>
          )}
        </div>
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 p-4 overflow-y-auto">
          <div className="max-w-3xl mx-auto my-5 rounded-2xl bg-white shadow-xl">
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-[#007F82]">
                  {selected.formCode.startsWith('BOND') ? selected.formCode.replaceAll('-', ' ') : `Form ${selected.formCode}`}
                </p>
                <h2 className="mt-1 text-xl font-extrabold text-[#1A2B4A]">{selected.name}</h2>
                <p className="mt-2 text-xs text-slate-500">{selected.description}</p>
              </div>
              <button type="button" onClick={reset} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            {selected.sensitive && (
              <div className="mx-5 sm:mx-6 mt-5 rounded-xl border border-slate-300 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-slate-700 mt-0.5" />
                  <div className="text-xs text-slate-700 leading-relaxed">
                    This is a restricted workflow. Your evidence is stored separately from normal tenancy documents and is not shown to other tenants, Client Portal users, contractors or the standard Operations queue.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.location.assign('/')}
                  className="mt-3 text-xs font-black text-slate-800 underline"
                >
                  Quick exit
                </button>
              </div>
            )}

            <div className="p-5 sm:p-6 space-y-5">
              {tenancies.length > 1 && (
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Tenancy / Property</span>
                  <select
                    value={tenancyId}
                    onChange={(event) => setTenancyId(event.target.value)}
                    className="mt-2 w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
                  >
                    {tenancies.map(({ tenancy, property }) => (
                      <option key={tenancy.id} value={tenancy.id}>
                        {property.unit ? `${property.unit}, ` : ''}{property.streetAddress}, {property.suburb}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selected.workflowType === 'furniture_safety' && (
                <>
                  <Field label="Furniture to be affixed" required>
                    <textarea rows={3} value={String(payload.furnitureDescription || '')} onChange={(e) => set('furnitureDescription', e.target.value)} className="field-textarea" placeholder="Describe each item of furniture." />
                  </Field>
                  <Field label="Room / location" required>
                    <input value={String(payload.location || '')} onChange={(e) => set('location', e.target.value)} className="field-input" placeholder="e.g. Bedroom 2 – east wall" />
                  </Field>
                  <Field label="Safety reason" required>
                    <select value={String(payload.safetyReason || '')} onChange={(e) => set('safetyReason', e.target.value)} className="field-input">
                      <option value="">Select reason</option>
                      <option value="child">Safety of a child</option>
                      <option value="disability">Safety of a person with a disability</option>
                    </select>
                  </Field>
                  <Field label="Proposed installation">
                    <textarea rows={3} value={String(payload.proposedInstallation || '')} onChange={(e) => set('proposedInstallation', e.target.value)} className="field-textarea" placeholder="Fixing method, installer and approximate wall penetrations." />
                  </Field>
                  <Field label="Restoration plan">
                    <textarea rows={3} value={String(payload.restorationPlan || '')} onChange={(e) => set('restorationPlan', e.target.value)} className="field-textarea" placeholder="How the wall will be restored at the end of the tenancy." />
                  </Field>
                </>
              )}

              {selected.workflowType === 'pet_request' && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Pet type" required><input value={String(payload.petType || '')} onChange={(e) => set('petType', e.target.value)} className="field-input" placeholder="Dog, cat, bird…" /></Field>
                    <Field label="Pet name" required><input value={String(payload.petName || '')} onChange={(e) => set('petName', e.target.value)} className="field-input" /></Field>
                    <Field label="Breed"><input value={String(payload.breed || '')} onChange={(e) => set('breed', e.target.value)} className="field-input" /></Field>
                    <Field label="Age"><input value={String(payload.age || '')} onChange={(e) => set('age', e.target.value)} className="field-input" /></Field>
                    <Field label="Size / weight"><input value={String(payload.sizeWeight || '')} onChange={(e) => set('sizeWeight', e.target.value)} className="field-input" /></Field>
                    <Field label="Registration / microchip"><input value={String(payload.registration || '')} onChange={(e) => set('registration', e.target.value)} className="field-input" /></Field>
                  </div>
                  <Field label="Pet description" required>
                    <textarea rows={3} value={String(payload.petDescription || '')} onChange={(e) => set('petDescription', e.target.value)} className="field-textarea" placeholder="Colour, temperament and other identifying details." />
                  </Field>
                  <Field label="Where the pet will be kept">
                    <textarea rows={3} value={String(payload.livingArrangement || '')} onChange={(e) => set('livingArrangement', e.target.value)} className="field-textarea" placeholder="Indoor, outdoor, containment and unattended arrangements." />
                  </Field>
                </>
              )}

              {selected.workflowType === 'minor_modification' && (
                <>
                  <Field label="Minor modification" required>
                    <select value={String(payload.modificationType || '')} onChange={(e) => set('modificationType', e.target.value)} className="field-input">
                      <option value="">Select modification</option>
                      {MINOR_MODIFICATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                  <Field label="Room / location" required><input value={String(payload.location || '')} onChange={(e) => set('location', e.target.value)} className="field-input" /></Field>
                  <Field label="Description of proposed modification" required><textarea rows={4} value={String(payload.description || '')} onChange={(e) => set('description', e.target.value)} className="field-textarea" /></Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Installer"><select value={String(payload.installerType || '')} onChange={(e) => set('installerType', e.target.value)} className="field-input"><option value="">Select</option><option value="tenant">Tenant</option><option value="qualified_contractor">Qualified contractor</option><option value="other">Other</option><option value="not_selected">Not selected yet</option></select></Field>
                    <Field label="Contractor / business"><input value={String(payload.contractorName || '')} onChange={(e) => set('contractorName', e.target.value)} className="field-input" /></Field>
                  </div>
                  <Field label="Reinstatement plan"><textarea rows={3} value={String(payload.reinstatementPlan || '')} onChange={(e) => set('reinstatementPlan', e.target.value)} className="field-textarea" /></Field>
                </>
              )}

              {selected.workflowType === 'major_modification' && (
                <>
                  <Field label="Description of major modification" required><textarea rows={4} value={String(payload.description || '')} onChange={(e) => set('description', e.target.value)} className="field-textarea" placeholder="Describe the proposed modification clearly." /></Field>
                  <Field label="Room / location" required><input value={String(payload.location || '')} onChange={(e) => set('location', e.target.value)} className="field-input" /></Field>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      ['electricalWork', 'Electrical work'],
                      ['plumbingWork', 'Plumbing work'],
                      ['structuralWork', 'Structural work'],
                      ['externalPenetration', 'External wall / roof penetration'],
                      ['commonProperty', 'Common property may be affected'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                        <input type="checkbox" checked={Boolean(payload[key])} onChange={(e) => set(key, e.target.checked)} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Contractor / company"><input value={String(payload.contractorName || '')} onChange={(e) => set('contractorName', e.target.value)} className="field-input" /></Field>
                    <Field label="Licence / registration"><input value={String(payload.contractorLicence || '')} onChange={(e) => set('contractorLicence', e.target.value)} className="field-input" /></Field>
                    <Field label="Estimated cost"><input type="number" min="0" step="0.01" value={String(payload.quoteAmount || '')} onChange={(e) => set('quoteAmount', e.target.value ? Number(e.target.value) : null)} className="field-input" /></Field>
                    <Field label="Proposed work date"><input type="date" value={String(payload.proposedWorkDate || '')} onChange={(e) => set('proposedWorkDate', e.target.value)} className="field-input" /></Field>
                  </div>
                  <Field label="Who is proposed to pay?"><select value={String(payload.payerProposal || '')} onChange={(e) => set('payerProposal', e.target.value)} className="field-input"><option value="">Select</option><option value="tenant">Tenant</option><option value="landlord">Landlord</option><option value="shared">Shared</option><option value="to_be_determined">To be determined</option></select></Field>
                  <Field label="Reinstatement proposal"><textarea rows={3} value={String(payload.reinstatementPlan || '')} onChange={(e) => set('reinstatementPlan', e.target.value)} className="field-textarea" /></Field>
                </>
              )}

              {selected.workflowType === 'bond_release' && (
                <>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
                    This workflow prepares a bond-release request for official lodgement. ProInspect does not replace Bonds Administration or BondsOnline.
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Bond reference"><input value={String(payload.bondReference || '')} onChange={(e) => set('bondReference', e.target.value)} className="field-input" /></Field>
                    <Field label="Tenancy end date" required><input type="date" value={String(payload.tenancyEndDate || '')} onChange={(e) => set('tenancyEndDate', e.target.value)} className="field-input" /></Field>
                  </div>
                  <Field label="Proposed distribution" required>
                    <div className="space-y-2">
                      {distributions.map((row, index) => (
                        <div key={index} className="grid grid-cols-[1fr_110px_110px_auto] gap-2">
                          <input value={row.name} onChange={(e) => setDistributions((rows) => rows.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} className="field-input" placeholder="Party name" />
                          <select value={row.role} onChange={(e) => setDistributions((rows) => rows.map((item, i) => i === index ? { ...item, role: e.target.value as 'tenant' | 'landlord' } : item))} className="field-input"><option value="tenant">Tenant</option><option value="landlord">Landlord</option></select>
                          <input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => setDistributions((rows) => rows.map((item, i) => i === index ? { ...item, amount: e.target.value } : item))} className="field-input" placeholder="$" />
                          <button type="button" onClick={() => setDistributions((rows) => rows.filter((_, i) => i !== index))} className="px-2 text-slate-500">×</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setDistributions((rows) => [...rows, { name: '', role: 'tenant', amount: '' }])} className="inline-flex items-center gap-2 text-xs font-bold text-[#006D70]"><Plus className="w-3.5 h-3.5" />Add party</button>
                    </div>
                  </Field>
                  <Field label="Claims / disputed deductions"><textarea rows={4} value={String(payload.claimDetails || '')} onChange={(e) => set('claimDetails', e.target.value)} className="field-textarea" placeholder="Describe any agreed or disputed claims and amounts." /></Field>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {[
                      ['finalInspectionCompleted', 'Final inspection completed'],
                      ['outgoingPcrReceived', 'Outgoing PCR received'],
                      ['keysReturned', 'Keys returned'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 border border-slate-200 rounded-lg p-3 text-xs text-slate-700"><input type="checkbox" checked={Boolean(payload[key])} onChange={(e) => set(key, e.target.checked)} />{label}</label>
                    ))}
                  </div>
                </>
              )}

              {selected.workflowType === 'bond_variation' && (
                <>
                  <Field label="What is changing?" required>
                    <select value={String(payload.changeType || '')} onChange={(e) => set('changeType', e.target.value)} className="field-input">
                      <option value="">Select change</option>
                      <option value="tenant_leaving">Tenant leaving – tenancy continues</option>
                      <option value="tenant_joining">New tenant joining</option>
                      <option value="tenant_replacement">Tenant replacement</option>
                      <option value="tenant_details">Tenant details correction</option>
                      <option value="bond_amount">Bond amount change</option>
                      <option value="pet_bond">Pet bond change</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Bond reference"><input value={String(payload.bondReference || selectedTenancy?.tenancy.bondReference || '')} onChange={(e) => set('bondReference', e.target.value)} className="field-input" /></Field>
                    <Field label="Effective date"><input type="date" value={String(payload.effectiveDate || '')} onChange={(e) => set('effectiveDate', e.target.value)} className="field-input" /></Field>
                    <Field label="Outgoing tenant"><input value={String(payload.outgoingTenantName || '')} onChange={(e) => set('outgoingTenantName', e.target.value)} className="field-input" /></Field>
                    <Field label="Incoming tenant"><input value={String(payload.incomingTenantName || '')} onChange={(e) => set('incomingTenantName', e.target.value)} className="field-input" /></Field>
                    <Field label="Incoming tenant email"><input type="email" value={String(payload.incomingTenantEmail || '')} onChange={(e) => set('incomingTenantEmail', e.target.value)} className="field-input" /></Field>
                    <Field label="Incoming tenant phone"><input value={String(payload.incomingTenantPhone || '')} onChange={(e) => set('incomingTenantPhone', e.target.value)} className="field-input" /></Field>
                  </div>
                  <Field label="Bond share / contribution details"><textarea rows={3} value={String(payload.bondContribution || '')} onChange={(e) => set('bondContribution', e.target.value)} className="field-textarea" /></Field>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Where the official manual bond form is used, the completed form must follow the current Bonds Administration signing/lodgement process. The online request records instructions for ProInspect; it does not itself lodge the bond variation.
                  </div>
                </>
              )}

              {selected.workflowType === 'pcr_response' && (
                <>
                  <Field label="Entry Property Condition Report" required>
                    <select value={String(payload.sourceDocumentId || '')} onChange={(e) => set('sourceDocumentId', e.target.value)} className="field-input">
                      <option value="">Select report</option>
                      {pcrDocuments.map((document) => <option key={document.id} value={document.id}>{document.title} · {formatDate(document.uploadedAt)}</option>)}
                    </select>
                  </Field>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
                    Add each room/item you have reviewed. Record whether you agree or disagree with the issued report and add comments where needed.
                  </div>
                  <div className="space-y-3">
                    {pcrRows.map((row, index) => (
                      <div key={index} className="rounded-lg border border-slate-200 p-3 grid sm:grid-cols-2 gap-3">
                        <input value={row.area} onChange={(e) => setPcrRows((rows) => rows.map((item, i) => i === index ? { ...item, area: e.target.value } : item))} className="field-input" placeholder="Room / area" />
                        <input value={row.item} onChange={(e) => setPcrRows((rows) => rows.map((item, i) => i === index ? { ...item, item: e.target.value } : item))} className="field-input" placeholder="Item e.g. walls / carpet" />
                        <select value={row.agreement} onChange={(e) => setPcrRows((rows) => rows.map((item, i) => i === index ? { ...item, agreement: e.target.value as 'agree' | 'disagree' } : item))} className="field-input"><option value="agree">Agree</option><option value="disagree">Disagree</option></select>
                        <input value={row.comments} onChange={(e) => setPcrRows((rows) => rows.map((item, i) => i === index ? { ...item, comments: e.target.value } : item))} className="field-input" placeholder="Tenant comments" />
                        <button type="button" onClick={() => setPcrRows((rows) => rows.filter((_, i) => i !== index))} className="sm:col-span-2 text-left text-xs font-bold text-slate-500">Remove row</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPcrRows((rows) => [...rows, { area: '', item: '', agreement: 'agree', comments: '' }])} className="inline-flex items-center gap-2 text-xs font-bold text-[#006D70]"><Plus className="w-3.5 h-3.5" />Add room/item</button>
                  </div>
                </>
              )}

              {selected.workflowType === 'family_violence_termination' && (
                <>
                  <Field label="Qualifying evidence type" required>
                    <select value={String(payload.evidenceType || '')} onChange={(e) => set('evidenceType', e.target.value)} className="field-input">
                      <option value="">Select evidence</option>
                      <option value="dvo">Family violence / restraining order</option>
                      <option value="family_court">Family Court injunction or application</option>
                      <option value="prosecution_or_conviction">Prosecution notice, indictment or court conviction record</option>
                      <option value="family_violence_evidence_form">Consumer Protection family violence evidence report</option>
                    </select>
                  </Field>
                  <Field label="Safe contact preference">
                    <select value={String(payload.safeContactPreference || '')} onChange={(e) => set('safeContactPreference', e.target.value)} className="field-input">
                      <option value="">Select</option>
                      <option value="portal_only">Portal only</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                    </select>
                  </Field>
                  <Field label="Safe contact details">
                    <input value={String(payload.safeContactDetails || '')} onChange={(e) => set('safeContactDetails', e.target.value)} className="field-input" placeholder="Only if safe to provide" />
                  </Field>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                    Do not upload ordinary tenancy material here. Upload only the qualifying evidence required for this restricted workflow.
                  </div>
                </>
              )}

              <Field label={selected.sensitive ? 'Qualifying evidence' : 'Supporting attachments'}>
                <div className="rounded-lg border border-dashed border-slate-300 p-4">
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(event) => setFiles(Array.from(event.target.files || []))}
                    className="block w-full text-sm text-slate-600"
                  />
                  <p className="mt-2 text-xs text-slate-400">
                    PDF or images, maximum 20 MB per file.
                  </p>
                </div>
              </Field>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
                Official source: <a href={selected.officialSourceUrl} target="_blank" rel="noreferrer" className="font-bold text-[#006D70] underline">WA Consumer Protection</a>
                {selected.responseDays ? ` · response period recorded: ${selected.responseDays} days` : ''}
                {selected.tenantResponseDays ? ` · tenant response period: ${selected.tenantResponseDays} days` : ''}
              </div>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                  <span>{success}</span>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button type="button" onClick={reset} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-600">
                <ArrowLeft className="w-4 h-4" />
                Close
              </button>
              {!success && (
                <button
                  type="button"
                  disabled={busy || (selected.workflowType === 'pcr_response' && pcrDocuments.length === 0)}
                  onClick={() => void (selected.sensitive ? submitSensitive() : submitNormal())}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {selected.sensitive ? 'Submit Privately' : 'Submit Form'}
                  {!busy && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .field-input { width: 100%; min-height: 2.75rem; border: 1px solid rgb(203 213 225); border-radius: .5rem; padding: .625rem .75rem; font-size: .875rem; outline: none; background: white; }
        .field-input:focus, .field-textarea:focus { border-color: #00B5B8; box-shadow: 0 0 0 2px rgba(0,181,184,.15); }
        .field-textarea { width: 100%; border: 1px solid rgb(203 213 225); border-radius: .5rem; padding: .75rem; font-size: .875rem; outline: none; resize: vertical; }
      `}</style>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, required, children }) => (
  <label className="block">
    <span className="text-xs font-bold uppercase text-slate-500">
      {label}{required ? ' *' : ''}
    </span>
    <div className="mt-2">{children}</div>
  </label>
);
