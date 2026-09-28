import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarPlus,
  FileUp,
  Loader2,
  RefreshCw,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import type {
  AdminTenantPortalSnapshot,
  TenantDocumentCategory,
  TenantInspection,
  TenantRequestStatus,
} from '../../types/tenant';
import {
  createAdminTenancy,
  createAdminTenantInspection,
  createAdminTenantProperty,
  createAdminTenantUser,
  fetchAdminTenantPortal,
  updateAdminTenantRequest,
  uploadAdminTenantDocument,
} from '../../services/api';

type Section = 'requests' | 'onboarding' | 'documents' | 'inspections';

const STATUS_OPTIONS: TenantRequestStatus[] = [
  'submitted',
  'under_review',
  'action_required',
  'approved',
  'declined',
  'in_progress',
  'completed',
  'closed',
];

const DOCUMENT_CATEGORIES: TenantDocumentCategory[] = [
  'tenancy_agreement',
  'property_condition_report',
  'bond',
  'inspection_notice',
  'rent_notice',
  'breach_notice',
  'variation',
  'pet_modification',
  'termination',
  'correspondence',
  'other',
];

export const AdminTenantPortal: React.FC = () => {
  const [section, setSection] = useState<Section>('requests');
  const [snapshot, setSnapshot] = useState<AdminTenantPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [propertyForm, setPropertyForm] = useState({
    streetAddress: '',
    unit: '',
    suburb: '',
    state: 'WA',
    postcode: '',
    propertyType: 'House',
    clientName: '',
    clientReference: '',
  });

  const [tenancyForm, setTenancyForm] = useState({
    propertyId: '',
    startDate: '',
    endDate: '',
    rentAmount: '',
    rentFrequency: 'weekly',
    bondReference: '',
  });

  const [tenantForm, setTenantForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    tenancyId: '',
  });

  const [documentForm, setDocumentForm] = useState<{
    tenancyId: string;
    title: string;
    category: TenantDocumentCategory;
    file: File | null;
  }>({
    tenancyId: '',
    title: '',
    category: 'tenancy_agreement',
    file: null,
  });

  const [inspectionForm, setInspectionForm] = useState<{
    tenancyId: string;
    type: TenantInspection['type'];
    scheduledStart: string;
    scheduledEnd: string;
    notes: string;
  }>({
    tenancyId: '',
    type: 'routine',
    scheduledStart: '',
    scheduledEnd: '',
    notes: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminTenantPortal();
      setSnapshot(data);
      setTenancyForm((current) => ({
        ...current,
        propertyId: current.propertyId || data.properties[0]?.id || '',
      }));
      setTenantForm((current) => ({
        ...current,
        tenancyId: current.tenancyId || data.tenancies[0]?.id || '',
      }));
      setDocumentForm((current) => ({
        ...current,
        tenancyId: current.tenancyId || data.tenancies[0]?.id || '',
      }));
      setInspectionForm((current) => ({
        ...current,
        tenancyId: current.tenancyId || data.tenancies[0]?.id || '',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tenant portal administration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const propertyById = useMemo(
    () => new Map(snapshot?.properties.map((item) => [item.id, item]) || []),
    [snapshot]
  );

  const tenancyById = useMemo(
    () => new Map(snapshot?.tenancies.map((item) => [item.id, item]) || []),
    [snapshot]
  );

  const tenantById = useMemo(
    () => new Map(snapshot?.tenantUsers.map((item) => [item.id, item]) || []),
    [snapshot]
  );

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 flex items-center justify-center gap-3 text-sm text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-[#007F82]" />
        Loading tenant portal operations…
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error || 'Tenant portal administration is unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#1A2B4A]">Tenant Portal Operations</h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage tenant access, tenancy records, documents, inspections and incoming requests.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Properties</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.properties.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Tenancies</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.tenancies.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Tenant Users</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.tenantUsers.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Open Requests</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">
            {snapshot.requests.filter((item) => !['completed', 'closed', 'declined'].includes(item.status)).length}
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {([
          ['requests', 'Requests', Wrench],
          ['onboarding', 'Onboarding', Users],
          ['documents', 'Documents', FileUp],
          ['inspections', 'Inspections', CalendarPlus],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border ${
              section === key
                ? 'bg-[#007F82] text-white border-[#007F82]'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          {message}
        </div>
      )}

      {section === 'requests' && (
        <div className="space-y-3">
          {snapshot.requests.map((request) => {
            const property = propertyById.get(request.propertyId);
            const tenant = tenantById.get(request.tenantUserId);
            return (
              <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#007F82]">{request.reference}</span>
                      <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {request.requestType.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <h3 className="mt-2 font-extrabold text-[#1A2B4A]">{request.title}</h3>
                    <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{request.details}</p>
                    <p className="mt-3 text-xs text-slate-500">
                      {tenant?.displayName || 'Tenant'} · {property ? `${property.streetAddress}, ${property.suburb}` : request.propertyId}
                    </p>
                  </div>

                  <div className="w-full lg:w-64 space-y-2">
                    <select
                      value={request.status}
                      disabled={busy}
                      onChange={(event) => {
                        const status = event.target.value as TenantRequestStatus;
                        void withBusy(async () => {
                          await updateAdminTenantRequest(request.id, { status });
                          setMessage(`${request.reference} updated to ${status.replaceAll('_', ' ')}.`);
                        });
                      }}
                      className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold bg-white"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                      ))}
                    </select>
                    <textarea
                      defaultValue={request.adminNotes || ''}
                      rows={3}
                      placeholder="Internal notes"
                      className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                      onBlur={(event) => {
                        const adminNotes = event.target.value;
                        void withBusy(async () => {
                          await updateAdminTenantRequest(request.id, { adminNotes });
                          setMessage(`${request.reference} notes saved.`);
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {snapshot.requests.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              No tenant requests have been submitted.
            </div>
          )}
        </div>
      )}

      {section === 'onboarding' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <form
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void withBusy(async () => {
                await createAdminTenantProperty(propertyForm);
                setPropertyForm({
                  streetAddress: '', unit: '', suburb: '', state: 'WA', postcode: '',
                  propertyType: 'House', clientName: '', clientReference: '',
                });
                setMessage('Property created.');
              });
            }}
          >
            <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
              <Building2 className="w-4 h-4" /> 1. Create Property
            </div>
            <input required placeholder="Street address" value={propertyForm.streetAddress} onChange={(e) => setPropertyForm({ ...propertyForm, streetAddress: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input placeholder="Unit" value={propertyForm.unit} onChange={(e) => setPropertyForm({ ...propertyForm, unit: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required placeholder="Suburb" value={propertyForm.suburb} onChange={(e) => setPropertyForm({ ...propertyForm, suburb: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input required placeholder="State" value={propertyForm.state} onChange={(e) => setPropertyForm({ ...propertyForm, state: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input required placeholder="Postcode" value={propertyForm.postcode} onChange={(e) => setPropertyForm({ ...propertyForm, postcode: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            </div>
            <input placeholder="Client / landlord" value={propertyForm.clientName} onChange={(e) => setPropertyForm({ ...propertyForm, clientName: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <button disabled={busy} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">Create Property</button>
          </form>

          <form
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void withBusy(async () => {
                await createAdminTenancy({
                  propertyId: tenancyForm.propertyId,
                  startDate: tenancyForm.startDate,
                  endDate: tenancyForm.endDate || undefined,
                  rentAmount: tenancyForm.rentAmount ? Number(tenancyForm.rentAmount) : undefined,
                  rentFrequency: tenancyForm.rentFrequency as 'weekly' | 'fortnightly' | 'monthly',
                  bondReference: tenancyForm.bondReference || undefined,
                });
                setMessage('Tenancy created.');
              });
            }}
          >
            <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
              <Users className="w-4 h-4" /> 2. Create Tenancy
            </div>
            <select required value={tenancyForm.propertyId} onChange={(e) => setTenancyForm({ ...tenancyForm, propertyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">Select property</option>
              {snapshot.properties.map((property) => (
                <option key={property.id} value={property.id}>{property.streetAddress}, {property.suburb}</option>
              ))}
            </select>
            <label className="block text-xs font-bold text-slate-500">Start date<input required type="date" value={tenancyForm.startDate} onChange={(e) => setTenancyForm({ ...tenancyForm, startDate: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="block text-xs font-bold text-slate-500">End date<input type="date" value={tenancyForm.endDate} onChange={(e) => setTenancyForm({ ...tenancyForm, endDate: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <input type="number" min="0" step="0.01" placeholder="Rent amount" value={tenancyForm.rentAmount} onChange={(e) => setTenancyForm({ ...tenancyForm, rentAmount: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <select value={tenancyForm.rentFrequency} onChange={(e) => setTenancyForm({ ...tenancyForm, rentFrequency: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input placeholder="Bond reference" value={tenancyForm.bondReference} onChange={(e) => setTenancyForm({ ...tenancyForm, bondReference: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <button disabled={busy || snapshot.properties.length === 0} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">Create Tenancy</button>
          </form>

          <form
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void withBusy(async () => {
                const result = await createAdminTenantUser({
                  displayName: tenantForm.displayName,
                  email: tenantForm.email,
                  phone: tenantForm.phone || undefined,
                  tenancyIds: [tenantForm.tenancyId],
                });
                setTenantForm({ displayName: '', email: '', phone: '', tenancyId: tenantForm.tenancyId });
                setMessage(`Tenant user created. Portal: ${result.portalUrl}`);
              });
            }}
          >
            <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
              <UserPlus className="w-4 h-4" /> 3. Add Tenant User
            </div>
            <select required value={tenantForm.tenancyId} onChange={(e) => setTenantForm({ ...tenantForm, tenancyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">Select tenancy</option>
              {snapshot.tenancies.map((tenancy) => {
                const property = propertyById.get(tenancy.propertyId);
                return <option key={tenancy.id} value={tenancy.id}>{property ? `${property.streetAddress}, ${property.suburb}` : tenancy.id}</option>;
              })}
            </select>
            <input required placeholder="Tenant name" value={tenantForm.displayName} onChange={(e) => setTenantForm({ ...tenantForm, displayName: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required type="email" placeholder="Tenant email" value={tenantForm.email} onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input placeholder="Phone" value={tenantForm.phone} onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <button disabled={busy || snapshot.tenancies.length === 0} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">Create Tenant Access</button>
          </form>
        </div>
      )}

      {section === 'documents' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!documentForm.file) return;
              void withBusy(async () => {
                await uploadAdminTenantDocument({
                  tenancyId: documentForm.tenancyId,
                  title: documentForm.title,
                  category: documentForm.category,
                  file: documentForm.file!,
                });
                setDocumentForm({ ...documentForm, title: '', file: null });
                setMessage('Tenant document uploaded.');
              });
            }}
          >
            <div className="font-extrabold text-[#1A2B4A]">Upload Tenant Document</div>
            <select required value={documentForm.tenancyId} onChange={(e) => setDocumentForm({ ...documentForm, tenancyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">Select tenancy</option>
              {snapshot.tenancies.map((tenancy) => {
                const property = propertyById.get(tenancy.propertyId);
                return <option key={tenancy.id} value={tenancy.id}>{property ? `${property.streetAddress}, ${property.suburb}` : tenancy.id}</option>;
              })}
            </select>
            <input required placeholder="Document title" value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <select value={documentForm.category} onChange={(e) => setDocumentForm({ ...documentForm, category: e.target.value as TenantDocumentCategory })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              {DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
            </select>
            <input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setDocumentForm({ ...documentForm, file: e.target.files?.[0] || null })} className="w-full text-sm" />
            <button disabled={busy || !documentForm.file} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">Upload Document</button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 font-extrabold text-[#1A2B4A]">Recent Documents</div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {snapshot.documents.map((document) => (
                <div key={document.id} className="px-5 py-3">
                  <div className="font-bold text-sm text-slate-800">{document.title}</div>
                  <div className="text-xs text-slate-500 mt-1">{document.category.replaceAll('_', ' ')} · {document.fileName}</div>
                </div>
              ))}
              {snapshot.documents.length === 0 && <div className="p-8 text-sm text-center text-slate-500">No documents uploaded.</div>}
            </div>
          </div>
        </div>
      )}

      {section === 'inspections' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const tenancy = tenancyById.get(inspectionForm.tenancyId);
              if (!tenancy) return;
              void withBusy(async () => {
                await createAdminTenantInspection({
                  tenancyId: tenancy.id,
                  propertyId: tenancy.propertyId,
                  type: inspectionForm.type,
                  scheduledStart: new Date(inspectionForm.scheduledStart).toISOString(),
                  scheduledEnd: inspectionForm.scheduledEnd ? new Date(inspectionForm.scheduledEnd).toISOString() : undefined,
                  notes: inspectionForm.notes || undefined,
                });
                setMessage('Inspection added to the tenant portal.');
              });
            }}
          >
            <div className="font-extrabold text-[#1A2B4A]">Schedule Portal Inspection</div>
            <select required value={inspectionForm.tenancyId} onChange={(e) => setInspectionForm({ ...inspectionForm, tenancyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">Select tenancy</option>
              {snapshot.tenancies.map((tenancy) => {
                const property = propertyById.get(tenancy.propertyId);
                return <option key={tenancy.id} value={tenancy.id}>{property ? `${property.streetAddress}, ${property.suburb}` : tenancy.id}</option>;
              })}
            </select>
            <select value={inspectionForm.type} onChange={(e) => setInspectionForm({ ...inspectionForm, type: e.target.value as TenantInspection['type'] })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="routine">Routine</option>
              <option value="entry">Entry</option>
              <option value="exit">Exit</option>
              <option value="maintenance">Maintenance</option>
              <option value="other">Other</option>
            </select>
            <label className="block text-xs font-bold text-slate-500">Start<input required type="datetime-local" value={inspectionForm.scheduledStart} onChange={(e) => setInspectionForm({ ...inspectionForm, scheduledStart: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="block text-xs font-bold text-slate-500">End<input type="datetime-local" value={inspectionForm.scheduledEnd} onChange={(e) => setInspectionForm({ ...inspectionForm, scheduledEnd: e.target.value })} className="mt-1 w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <textarea rows={3} placeholder="Portal notes" value={inspectionForm.notes} onChange={(e) => setInspectionForm({ ...inspectionForm, notes: e.target.value })} className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
            <button disabled={busy || snapshot.tenancies.length === 0} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">Add Inspection</button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 font-extrabold text-[#1A2B4A]">Portal Inspections</div>
            <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {snapshot.inspections.map((inspection) => {
                const property = propertyById.get(inspection.propertyId);
                return (
                  <div key={inspection.id} className="px-5 py-3">
                    <div className="font-bold text-sm text-slate-800 capitalize">{inspection.type} inspection</div>
                    <div className="text-xs text-slate-500 mt-1">{property?.streetAddress || inspection.propertyId}</div>
                    <div className="text-xs text-slate-500">{new Date(inspection.scheduledStart).toLocaleString('en-AU')}</div>
                  </div>
                );
              })}
              {snapshot.inspections.length === 0 && <div className="p-8 text-sm text-center text-slate-500">No inspections listed.</div>}
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-[#1A2B4A] text-white px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
          <Loader2 className="w-4 h-4 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  );
};
