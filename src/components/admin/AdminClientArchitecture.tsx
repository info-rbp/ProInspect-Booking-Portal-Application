import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  FileUp,
  Link2,
  Loader2,
  RefreshCw,
  UserPlus,
  Users,
} from 'lucide-react';
import type {
  AdminTenantPortalSnapshot,
  ClientPropertyRole,
  ClientType,
  PortalAudience,
  TenantDocumentCategory,
} from '../../types/tenant';
import {
  createAdminClient,
  createAdminClientUser,
  fetchAdminTenantPortal,
  linkAdminClientProperty,
  uploadAdminPropertyDocument,
} from '../../services/api';

const CLIENT_TYPES: Array<{ value: ClientType; label: string }> = [
  { value: 'landlord', label: 'Landlord' },
  { value: 'agency', label: 'Agency' },
  { value: 'commercial_landlord', label: 'Commercial Landlord' },
  { value: 'strata_company', label: 'Strata Company' },
  { value: 'asset_manager', label: 'Asset Manager' },
  { value: 'other', label: 'Other' },
];

const CLIENT_PROPERTY_ROLES: Array<{ value: ClientPropertyRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'managing_agent', label: 'Managing Agent' },
  { value: 'asset_manager', label: 'Asset Manager' },
  { value: 'strata_manager', label: 'Strata Manager' },
  { value: 'other', label: 'Other' },
];

const DOCUMENT_CATEGORIES: TenantDocumentCategory[] = [
  'tenancy_agreement',
  'property_condition_report',
  'inspection_report',
  'inspection_notice',
  'maintenance',
  'quote',
  'invoice',
  'compliance',
  'property_report',
  'owner_statement',
  'correspondence',
  'other',
];

export const AdminClientArchitecture: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AdminTenantPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [clientForm, setClientForm] = useState<{
    name: string;
    clientType: ClientType;
    email: string;
    phone: string;
    externalReference: string;
  }>({
    name: '',
    clientType: 'landlord',
    email: '',
    phone: '',
    externalReference: '',
  });

  const [clientUserForm, setClientUserForm] = useState({
    clientId: '',
    displayName: '',
    email: '',
    phone: '',
  });

  const [linkForm, setLinkForm] = useState<{
    clientId: string;
    propertyId: string;
    role: ClientPropertyRole;
    primary: boolean;
  }>({
    clientId: '',
    propertyId: '',
    role: 'owner',
    primary: false,
  });

  const [documentForm, setDocumentForm] = useState<{
    propertyId: string;
    tenancyId: string;
    title: string;
    category: TenantDocumentCategory;
    audiences: PortalAudience[];
    file: File | null;
  }>({
    propertyId: '',
    tenancyId: '',
    title: '',
    category: 'property_report',
    audiences: ['client'],
    file: null,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminTenantPortal();
      setSnapshot(data);
      setClientUserForm((current) => ({
        ...current,
        clientId: current.clientId || data.clients[0]?.id || '',
      }));
      setLinkForm((current) => ({
        ...current,
        clientId: current.clientId || data.clients[0]?.id || '',
        propertyId: current.propertyId || data.properties[0]?.id || '',
      }));
      setDocumentForm((current) => ({
        ...current,
        propertyId: current.propertyId || data.properties[0]?.id || '',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client architecture.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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

  const clientById = useMemo(
    () => new Map(snapshot?.clients.map((client) => [client.id, client]) || []),
    [snapshot]
  );

  const propertyById = useMemo(
    () => new Map(snapshot?.properties.map((property) => [property.id, property]) || []),
    [snapshot]
  );

  const propertyTenancies = useMemo(
    () =>
      snapshot?.tenancies.filter(
        (tenancy) => tenancy.propertyId === documentForm.propertyId
      ) || [],
    [snapshot, documentForm.propertyId]
  );

  const linkedClientsForDocument = useMemo(() => {
    if (!snapshot || !documentForm.propertyId) return [];
    const ids = snapshot.clientPropertyLinks
      .filter((link) => link.active && link.propertyId === documentForm.propertyId)
      .map((link) => link.clientId);
    return snapshot.clients.filter((client) => ids.includes(client.id));
  }, [snapshot, documentForm.propertyId]);

  const toggleAudience = (audience: PortalAudience) => {
    setDocumentForm((current) => {
      const exists = current.audiences.includes(audience);
      const next = exists
        ? current.audiences.filter((item) => item !== audience)
        : [...current.audiences, audience];
      return { ...current, audiences: next };
    });
  };

  if (loading && !snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 flex items-center justify-center gap-3 text-sm text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-[#007F82]" />
        Loading client and property architecture…
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error || 'Client architecture is unavailable.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-[#1A2B4A]">Clients &amp; Properties</h2>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl">
            Shared Firestore relationships for client accounts, properties and documents. These records are designed to power a future client portal without duplicating property or document data.
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Clients</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.clients.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Client Users</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.clientUsers.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Property Links</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">{snapshot.clientPropertyLinks.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase font-bold text-slate-400">Shared Documents</div>
          <div className="mt-1 text-2xl font-black text-[#1A2B4A]">
            {snapshot.documents.filter((document) => document.audiences.includes('client')).length}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <form
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void withBusy(async () => {
              await createAdminClient({
                name: clientForm.name,
                clientType: clientForm.clientType,
                email: clientForm.email || undefined,
                phone: clientForm.phone || undefined,
                externalReference: clientForm.externalReference || undefined,
              });
              setClientForm({
                name: '',
                clientType: 'landlord',
                email: '',
                phone: '',
                externalReference: '',
              });
              setMessage('Client created.');
            });
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
            <Users className="w-4 h-4" />
            Create Client
          </div>
          <input required placeholder="Client / entity name" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <select value={clientForm.clientType} onChange={(e) => setClientForm({ ...clientForm, clientType: e.target.value as ClientType })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            {CLIENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input type="email" placeholder="Primary email (optional)" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input placeholder="Phone (optional)" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input placeholder="External / CRM reference" value={clientForm.externalReference} onChange={(e) => setClientForm({ ...clientForm, externalReference: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <button disabled={busy} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            Create Client
          </button>
        </form>

        <form
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void withBusy(async () => {
              const result = await createAdminClientUser({
                displayName: clientUserForm.displayName,
                email: clientUserForm.email,
                phone: clientUserForm.phone || undefined,
                clientIds: [clientUserForm.clientId],
              });
              setClientUserForm({
                ...clientUserForm,
                displayName: '',
                email: '',
                phone: '',
              });
              setMessage(`Client portal user created. Future portal route: ${result.portalUrl}`);
            });
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
            <UserPlus className="w-4 h-4" />
            Create Client Portal User
          </div>
          <select required value={clientUserForm.clientId} onChange={(e) => setClientUserForm({ ...clientUserForm, clientId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Select client</option>
            {snapshot.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <input required placeholder="User name" value={clientUserForm.displayName} onChange={(e) => setClientUserForm({ ...clientUserForm, displayName: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input required type="email" placeholder="Portal email" value={clientUserForm.email} onChange={(e) => setClientUserForm({ ...clientUserForm, email: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input placeholder="Phone (optional)" value={clientUserForm.phone} onChange={(e) => setClientUserForm({ ...clientUserForm, phone: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <button disabled={busy || snapshot.clients.length === 0} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            Create Client Access
          </button>
        </form>

        <form
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void withBusy(async () => {
              await linkAdminClientProperty(linkForm);
              setMessage('Client linked to property.');
            });
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
            <Link2 className="w-4 h-4" />
            Link Client to Property
          </div>
          <select required value={linkForm.clientId} onChange={(e) => setLinkForm({ ...linkForm, clientId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Select client</option>
            {snapshot.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select required value={linkForm.propertyId} onChange={(e) => setLinkForm({ ...linkForm, propertyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Select property</option>
            {snapshot.properties.map((property) => <option key={property.id} value={property.id}>{property.streetAddress}, {property.suburb}</option>)}
          </select>
          <select value={linkForm.role} onChange={(e) => setLinkForm({ ...linkForm, role: e.target.value as ClientPropertyRole })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            {CLIENT_PROPERTY_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={linkForm.primary} onChange={(e) => setLinkForm({ ...linkForm, primary: e.target.checked })} />
            Primary client for this property
          </label>
          <button disabled={busy || snapshot.clients.length === 0 || snapshot.properties.length === 0} className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
            Link Client
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <form
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!documentForm.file || documentForm.audiences.length === 0) return;

            void withBusy(async () => {
              await uploadAdminPropertyDocument({
                propertyId: documentForm.propertyId,
                tenancyId: documentForm.tenancyId || undefined,
                title: documentForm.title,
                category: documentForm.category,
                audiences: documentForm.audiences,
                file: documentForm.file!,
              });
              setDocumentForm({
                ...documentForm,
                title: '',
                file: null,
              });
              setMessage('Property document uploaded with portal visibility applied.');
            });
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[#1A2B4A]">
            <FileUp className="w-4 h-4" />
            Upload Shared Property Document
          </div>

          <select required value={documentForm.propertyId} onChange={(e) => setDocumentForm({ ...documentForm, propertyId: e.target.value, tenancyId: '' })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Select property</option>
            {snapshot.properties.map((property) => <option key={property.id} value={property.id}>{property.streetAddress}, {property.suburb}</option>)}
          </select>

          <select value={documentForm.tenancyId} onChange={(e) => setDocumentForm({ ...documentForm, tenancyId: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Property-level document (not tenancy-specific)</option>
            {propertyTenancies.map((tenancy) => (
              <option key={tenancy.id} value={tenancy.id}>
                Tenancy from {tenancy.startDate}{tenancy.endDate ? ` to ${tenancy.endDate}` : ''}
              </option>
            ))}
          </select>

          <input required placeholder="Document title" value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" />

          <select value={documentForm.category} onChange={(e) => setDocumentForm({ ...documentForm, category: e.target.value as TenantDocumentCategory })} className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm">
            {DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
          </select>

          <div>
            <div className="text-xs font-bold uppercase text-slate-500 mb-2">Visible in</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['client', 'Client Portal'],
                ['tenant', 'Tenant Portal'],
                ['staff', 'Staff Only'],
              ] as Array<[PortalAudience, string]>).map(([audience, label]) => (
                <label key={audience} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">
                  <input type="checkbox" checked={documentForm.audiences.includes(audience)} onChange={() => toggleAudience(audience)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {documentForm.audiences.includes('client') && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
              <strong className="text-slate-800">Linked clients:</strong>{' '}
              {linkedClientsForDocument.length > 0
                ? linkedClientsForDocument.map((client) => client.name).join(', ')
                : 'No client is linked to this property yet. Link a client before uploading a client-visible document.'}
            </div>
          )}

          <input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setDocumentForm({ ...documentForm, file: e.target.files?.[0] || null })} className="w-full text-sm" />

          <button
            disabled={
              busy ||
              !documentForm.file ||
              !documentForm.propertyId ||
              documentForm.audiences.length === 0 ||
              (documentForm.audiences.includes('client') && linkedClientsForDocument.length === 0)
            }
            className="w-full h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50"
          >
            Upload Property Document
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 font-extrabold text-[#1A2B4A]">
            Client ↔ Property Relationships
          </div>
          <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
            {snapshot.clientPropertyLinks.map((link) => {
              const client = clientById.get(link.clientId);
              const property = propertyById.get(link.propertyId);
              return (
                <div key={link.id} className="px-5 py-4">
                  <div className="font-bold text-sm text-slate-800">{client?.name || link.clientId}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {property ? `${property.streetAddress}, ${property.suburb}` : link.propertyId}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase text-slate-400">
                    {link.role.replaceAll('_', ' ')}{link.primary ? ' · primary' : ''}
                  </div>
                </div>
              );
            })}
            {snapshot.clientPropertyLinks.length === 0 && (
              <div className="p-8 text-sm text-center text-slate-500">No client-property relationships created yet.</div>
            )}
          </div>
        </div>
      </div>

      {busy && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-[#1A2B4A] text-white px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-bold">
          <Loader2 className="w-4 h-4 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  );
};
