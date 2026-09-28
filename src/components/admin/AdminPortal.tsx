import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
  Plus,
  Search,
  Save,
  Archive,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  UserCog,
  BarChart3,
  Home,
  Layers3,
} from 'lucide-react';
import type {
  AdminAuditEvent,
  AdminDashboardSummary,
  AdminIntegrationStatus,
  AdminPermission,
  AdminReportSummary,
  AdminResourceName,
  AdminResourceRecord,
  AdminSession,
  AdminStaffUser,
  AdminRole,
} from '../../types/admin';
import type {
  BookingRecord,
  BookingStatus,
  BusinessSettings,
  InspectionService,
  ServiceAdminInput,
} from '../../types/booking';
import {
  archiveAdminResource,
  createAdminResource,
  createAdminService,
  createAdminStaff,
  fetchAdminAudit,
  fetchAdminBookings,
  fetchAdminDashboardSummary,
  fetchAdminIntegrations,
  fetchAdminReportSummary,
  fetchAdminResource,
  fetchAdminServices,
  fetchAdminSettings,
  fetchAdminStaff,
  reorderAdminServices,
  updateAdminBooking,
  updateAdminResource,
  updateAdminService,
  updateAdminSettings,
  updateAdminStaff,
  verifyAdminSession,
} from '../../services/api';
import { AdminServiceEditor } from './AdminServiceEditor';

type SectionId =
  | 'dashboard'
  | 'bookings'
  | 'schedule'
  | 'clients'
  | 'clientUsers'
  | 'clientMemberships'
  | 'properties'
  | 'propertyLinks'
  | 'tenancies'
  | 'tenants'
  | 'documents'
  | 'documentRequests'
  | 'maintenance'
  | 'services'
  | 'staff'
  | 'communications'
  | 'billing'
  | 'payments'
  | 'reports'
  | 'integrations'
  | 'settings'
  | 'audit';

interface AdminPortalProps {
  currentUser: User | null;
  onLogout: () => void;
  onBackToBooking: () => void;
  onServicesChanged?: (services: InspectionService[]) => void;
}

const navItems: Array<{
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: AdminPermission;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.read' },
  { id: 'bookings', label: 'Bookings & Work Orders', icon: ClipboardList, permission: 'bookings.read' },
  { id: 'schedule', label: 'Calendar & Scheduling', icon: CalendarDays, permission: 'bookings.read' },
  { id: 'clients', label: 'Clients', icon: Users, permission: 'clients.read' },
  { id: 'clientUsers', label: 'Client Users', icon: Users, permission: 'clients.read' },
  { id: 'clientMemberships', label: 'Client Memberships', icon: Link2, permission: 'clients.read' },
  { id: 'properties', label: 'Properties', icon: Building2, permission: 'properties.read' },
  { id: 'propertyLinks', label: 'Property Relationships', icon: Link2, permission: 'properties.read' },
  { id: 'tenancies', label: 'Tenancies', icon: Home, permission: 'tenants.read' },
  { id: 'tenants', label: 'Tenant Users', icon: Home, permission: 'tenants.read' },
  { id: 'documents', label: 'Documents & Reports', icon: FileText, permission: 'documents.read' },
  { id: 'documentRequests', label: 'Document Requests', icon: Layers3, permission: 'document_requests.read' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.read' },
  { id: 'services', label: 'Services', icon: Activity, permission: 'services.read' },
  { id: 'staff', label: 'Staff & Permissions', icon: UserCog, permission: 'users.read' },
  { id: 'communications', label: 'Communications', icon: Mail, permission: 'communications.read' },
  { id: 'billing', label: 'Subscriptions', icon: BadgeDollarSign, permission: 'billing.read' },
  { id: 'payments', label: 'Payments', icon: BadgeDollarSign, permission: 'billing.read' },
  { id: 'reports', label: 'Management Reporting', icon: BarChart3, permission: 'reports.read' },
  { id: 'integrations', label: 'Integrations', icon: Link2, permission: 'integrations.read' },
  { id: 'settings', label: 'Settings', icon: Settings, permission: 'settings.read' },
  { id: 'audit', label: 'Audit & Security', icon: ShieldCheck, permission: 'audit.read' },
];

const resourceMap: Partial<Record<SectionId, AdminResourceName>> = {
  clients: 'clients',
  clientUsers: 'clientUsers',
  clientMemberships: 'clientMemberships',
  properties: 'properties',
  propertyLinks: 'clientPropertyLinks',
  tenancies: 'tenancies',
  tenants: 'tenantUsers',
  documents: 'propertyDocuments',
  documentRequests: 'documentRequests',
  maintenance: 'workOrders',
  communications: 'communications',
  billing: 'subscriptions',
  payments: 'payments',
};

const sectionTitles: Record<SectionId, string> = {
  dashboard: 'Operational Dashboard',
  bookings: 'Bookings & Work Orders',
  schedule: 'Calendar & Scheduling',
  clients: 'Clients',
  clientUsers: 'Client Users',
  clientMemberships: 'Client Memberships',
  properties: 'Properties',
  propertyLinks: 'Property Relationships',
  tenancies: 'Tenancies',
  tenants: 'Tenant Users',
  documents: 'Documents & Reports',
  documentRequests: 'Document Requests',
  maintenance: 'Work Orders & Maintenance',
  services: 'Service Catalogue',
  staff: 'Staff & Permissions',
  communications: 'Communications',
  billing: 'Subscriptions',
  payments: 'Payments',
  reports: 'Management Reporting',
  integrations: 'Integrations',
  settings: 'Business Settings',
  audit: 'Audit & Security',
};

const resourceDefinitions: Record<
  AdminResourceName,
  {
    singular: string;
    managePermission: AdminPermission;
    fields: Array<{
      key: string;
      label: string;
      placeholder?: string;
      type?: 'text' | 'email' | 'select' | 'textarea' | 'csv' | 'json';
      options?: string[];
    }>;
    columns: string[];
  }
> = {
  clients: {
    singular: 'Client',
    managePermission: 'clients.manage',
    fields: [
      { key: 'name', label: 'Client / organisation name' },
      { key: 'clientType', label: 'Client type', type: 'select', options: ['landlord','agency','commercial_landlord','strata_company','asset_manager','other'] },
      { key: 'email', label: 'Primary email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'externalReference', label: 'External reference' },
      { key: 'status', label: 'Status', type: 'select', options: ['active','inactive'] },
    ],
    columns: ['name','clientType','email','status'],
  },
  clientUsers: {
    singular: 'Client User',
    managePermission: 'clients.manage',
    fields: [
      { key: 'displayName', label: 'Display name' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'clientIds', label: 'Client IDs', type: 'csv', placeholder: 'Comma-separated client IDs' },
      { key: 'clientRoles', label: 'Client roles', type: 'json', placeholder: '{"client-id":"owner"}' },
      { key: 'active', label: 'Active', type: 'select', options: ['true','false'] },
    ],
    columns: ['displayName','email','clientIds','active'],
  },
  clientMemberships: {
    singular: 'Client Membership',
    managePermission: 'clients.manage',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientUserId', label: 'Client user ID' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'role', label: 'Role', type: 'select', options: ['owner','admin','member','viewer'] },
      { key: 'status', label: 'Status', type: 'select', options: ['active','invited','revoked'] },
    ],
    columns: ['clientId','clientUserId','role','status'],
  },
  properties: {
    singular: 'Property',
    managePermission: 'properties.manage',
    fields: [
      { key: 'streetAddress', label: 'Street address' },
      { key: 'unit', label: 'Unit / lot' },
      { key: 'suburb', label: 'Suburb' },
      { key: 'state', label: 'State' },
      { key: 'postcode', label: 'Postcode' },
      { key: 'propertyType', label: 'Property type' },
      { key: 'primaryClientId', label: 'Primary client ID' },
      { key: 'clientReference', label: 'Client reference' },
      { key: 'status', label: 'Status', type: 'select', options: ['active','inactive'] },
    ],
    columns: ['streetAddress','suburb','propertyType','primaryClientId','status'],
  },
  clientPropertyLinks: {
    singular: 'Property Relationship',
    managePermission: 'properties.manage',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'role', label: 'Relationship', type: 'select', options: ['owner','landlord','managing_agent','asset_manager','strata_manager','other'] },
      { key: 'primary', label: 'Primary relationship', type: 'select', options: ['true','false'] },
      { key: 'active', label: 'Active', type: 'select', options: ['true','false'] },
    ],
    columns: ['clientId','propertyId','role','primary','active'],
  },
  tenancies: {
    singular: 'Tenancy',
    managePermission: 'tenants.manage',
    fields: [
      { key: 'propertyId', label: 'Property ID' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','active','ended'] },
      { key: 'startDate', label: 'Start date' },
      { key: 'endDate', label: 'End date' },
      { key: 'rentAmount', label: 'Rent amount' },
      { key: 'rentFrequency', label: 'Rent frequency', type: 'select', options: ['weekly','fortnightly','monthly'] },
      { key: 'bondReference', label: 'Bond reference' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: ['propertyId','clientId','startDate','endDate','status'],
  },
  tenantUsers: {
    singular: 'Tenant User',
    managePermission: 'tenants.manage',
    fields: [
      { key: 'displayName', label: 'Display name' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'tenancyIds', label: 'Tenancy IDs', type: 'csv', placeholder: 'Comma-separated tenancy IDs' },
      { key: 'active', label: 'Active', type: 'select', options: ['true','false'] },
    ],
    columns: ['displayName','email','tenancyIds','active'],
  },
  propertyDocuments: {
    singular: 'Document / Report',
    managePermission: 'documents.manage',
    fields: [
      { key: 'title', label: 'Document title' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'clientIds', label: 'Client IDs', type: 'csv' },
      { key: 'tenancyId', label: 'Tenancy ID' },
      { key: 'bookingId', label: 'Booking ID' },
      { key: 'workOrderId', label: 'Work order ID' },
      { key: 'requestId', label: 'Request ID' },
      { key: 'audiences', label: 'Audiences', type: 'csv', placeholder: 'client, tenant, staff' },
      { key: 'category', label: 'Document category' },
      { key: 'fileName', label: 'File name' },
      { key: 'storagePath', label: 'Storage path' },
      { key: 'contentType', label: 'Content type' },
      { key: 'size', label: 'Size (bytes)' },
      { key: 'version', label: 'Version' },
      { key: 'status', label: 'Status', type: 'select', options: ['draft','generated','review','approved','issued','archived'] },
      { key: 'uploadedBy', label: 'Uploaded by' },
    ],
    columns: ['title','category','propertyId','status','version'],
  },
  documentRequests: {
    singular: 'Document Request',
    managePermission: 'document_requests.manage',
    fields: [
      { key: 'reference', label: 'Reference' },
      { key: 'documentProductId', label: 'Document product ID' },
      { key: 'documentName', label: 'Document name' },
      { key: 'documentCategory', label: 'Category', type: 'select', options: ['residential','commercial','strata-building'] },
      { key: 'pricingMode', label: 'Pricing mode', type: 'select', options: ['fixed','quote'] },
      { key: 'priceExGst', label: 'Price ex GST' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientUserId', label: 'Client user ID' },
      { key: 'assignedStaffId', label: 'Assigned staff ID' },
      { key: 'requesterName', label: 'Requester name' },
      { key: 'requesterEmail', label: 'Requester email', type: 'email' },
      { key: 'requesterPhone', label: 'Requester phone' },
      { key: 'streetAddress', label: 'Street address' },
      { key: 'unit', label: 'Unit' },
      { key: 'suburb', label: 'Suburb' },
      { key: 'state', label: 'State' },
      { key: 'postcode', label: 'Postcode' },
      { key: 'status', label: 'Status', type: 'select', options: ['submitted','under_review','awaiting_information','in_preparation','review','ready','completed','cancelled'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: ['reference','documentName','propertyId','assignedStaffId','status'],
  },
  workOrders: {
    singular: 'Work Order',
    managePermission: 'maintenance.manage',
    fields: [
      { key: 'reference', label: 'Reference' },
      { key: 'sourceType', label: 'Source', type: 'select', options: ['tenant_request','client_request','booking','document_request','manual'] },
      { key: 'sourceId', label: 'Source ID' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'tenancyId', label: 'Tenancy ID' },
      { key: 'assignedStaffId', label: 'Assigned staff ID' },
      { key: 'title', label: 'Title' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['routine','priority','urgent','emergency'] },
      { key: 'status', label: 'Status', type: 'select', options: ['triage','quote_required','awaiting_approval','approved','assigned','scheduled','in_progress','report_pending','completed','cancelled'] },
      { key: 'contractorId', label: 'Contractor ID' },
      { key: 'quoteAmountExGst', label: 'Quote ex GST' },
      { key: 'scheduledStart', label: 'Scheduled start' },
      { key: 'scheduledEnd', label: 'Scheduled end' },
      { key: 'accessNotes', label: 'Access notes', type: 'textarea' },
      { key: 'completionNotes', label: 'Completion notes', type: 'textarea' },
      { key: 'completionDocumentIds', label: 'Completion document IDs', type: 'csv' },
    ],
    columns: ['reference','title','propertyId','priority','assignedStaffId','status'],
  },
  subscriptions: {
    singular: 'Subscription',
    managePermission: 'billing.manage',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'planCode', label: 'Plan code' },
      { key: 'name', label: 'Plan / arrangement name' },
      { key: 'monthlyFeeExGst', label: 'Monthly fee ex GST' },
      { key: 'status', label: 'Status', type: 'select', options: ['active','paused','ended','cancelled'] },
      { key: 'startDate', label: 'Start date' },
      { key: 'endDate', label: 'End date' },
      { key: 'allowances', label: 'Allowances', type: 'json', placeholder: '[{"code":"maintenance","name":"Maintenance","includedUnits":2,"unit":"hours"}]' },
      { key: 'xeroContactId', label: 'Xero contact ID' },
      { key: 'invoiceReference', label: 'Invoice reference' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: ['name','clientId','propertyId','monthlyFeeExGst','status'],
  },
  payments: {
    singular: 'Payment',
    managePermission: 'billing.manage',
    fields: [
      { key: 'reference', label: 'Reference' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'sourceType', label: 'Source type', type: 'select', options: ['booking','document_request','work_order','subscription','other'] },
      { key: 'sourceId', label: 'Source ID' },
      { key: 'description', label: 'Description' },
      { key: 'amountExGst', label: 'Amount ex GST' },
      { key: 'gstAmount', label: 'GST amount' },
      { key: 'totalAmount', label: 'Total amount' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','payment_required','paid','failed','refunded','waived'] },
      { key: 'provider', label: 'Provider', type: 'select', options: ['manual','external','xero'] },
      { key: 'invoiceReference', label: 'Invoice reference' },
    ],
    columns: ['reference','description','totalAmount','status','provider'],
  },
  communications: {
    singular: 'Communication',
    managePermission: 'communications.manage',
    fields: [
      { key: 'title', label: 'Subject / title' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'propertyId', label: 'Property ID' },
      { key: 'tenancyId', label: 'Tenancy ID' },
      { key: 'bookingId', label: 'Booking ID' },
      { key: 'workOrderId', label: 'Work order ID' },
      { key: 'recipient', label: 'Recipient' },
      { key: 'channel', label: 'Channel', type: 'select', options: ['email','phone','sms','portal','internal'] },
      { key: 'direction', label: 'Direction', type: 'select', options: ['outbound','inbound','internal'] },
      { key: 'status', label: 'Status', type: 'select', options: ['draft','queued','sent','failed','received','logged'] },
      { key: 'body', label: 'Communication body', type: 'textarea' },
    ],
    columns: ['title','recipient','channel','propertyId','status'],
  },
};

function hasPermission(session: AdminSession | null, permission?: AdminPermission): boolean {
  return !permission || Boolean(session?.permissions.includes(permission));
}

function roleLabel(role: AdminRole): string {
  return {
    administrator: 'Administrator',
    operations_manager: 'Operations Manager',
    inspector: 'Staff / Inspector',
    read_only: 'Read Only',
  }[role];
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dateTimeLabel(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function ResourceEditor({
  resource,
  record,
  onClose,
  onSaved,
}: {
  resource: AdminResourceName;
  record: AdminResourceRecord | null;
  onClose: () => void;
  onSaved: (record: AdminResourceRecord) => void;
}) {
  const definition = resourceDefinitions[resource];
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(definition.fields.map((field) => [field.key, valueText(record?.[field.key]) === '—' ? '' : valueText(record?.[field.key])]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        definition.fields.map((field) => {
          const raw = (form[field.key] || '').trim();
          if (field.type === 'csv') {
            return [field.key, raw ? raw.split(',').map((value) => value.trim()).filter(Boolean) : []];
          }
          if (field.type === 'json') {
            if (!raw) return [field.key, field.key === 'allowances' ? [] : {}];
            try {
              return [field.key, JSON.parse(raw)];
            } catch {
              throw new Error(`${field.label} must contain valid JSON.`);
            }
          }
          return [field.key, raw];
        })
      );
      const saved = record
        ? await updateAdminResource(resource, record.id, payload)
        : await createAdminResource(resource, payload);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-3">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-[#1A2B4A]">{record ? 'Edit' : 'Add'} {definition.singular}</h2>
            <p className="text-xs text-slate-500">Changes are stored in Firestore and recorded in the audit trail.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {definition.fields.map((field) => (
              <label key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
                <span className="text-xs font-bold text-slate-700">{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    value={form[field.key] || ''}
                    onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                    className="w-full min-h-24 px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-[#007F82]"
                  />
                ) : field.type === 'json' ? (
                  <textarea
                    value={form[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                    className="w-full min-h-24 px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono outline-none focus:border-[#007F82]"
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={form[field.key] || field.options?.[0] || ''}
                    onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-[#007F82]"
                  >
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : 'text'}
                    value={form[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm outline-none focus:border-[#007F82]"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg border border-slate-300 text-sm font-bold text-slate-600">Cancel</button>
            <button disabled={saving} className="inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResourcePanel({
  section,
  session,
}: {
  section: SectionId;
  session: AdminSession;
}) {
  const resource = resourceMap[section];
  if (!resource) return null;
  const definition = resourceDefinitions[resource];
  const [records, setRecords] = useState<AdminResourceRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<AdminResourceRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission(session, definition.managePermission);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchAdminResource(resource));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [resource]);

  const filtered = records.filter((record) =>
    JSON.stringify(record).toLowerCase().includes(query.toLowerCase())
  );

  const archive = async (record: AdminResourceRecord) => {
    if (!window.confirm(`Archive this ${definition.singular.toLowerCase()}?`)) return;
    try {
      const updated = await archiveAdminResource(resource, record.id);
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive record.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${definition.singular.toLowerCase()} records…`}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-600">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {canManage && (
            <button onClick={() => setEditor(null)} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#007F82] text-white text-sm font-bold">
              <Plus className="w-4 h-4" /> Add {definition.singular}
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1A2B4A] text-white uppercase tracking-wider">
              <tr>
                {definition.columns.map((column) => <th key={column} className="px-4 py-3">{column.replace(/([A-Z])/g, ' $1')}</th>)}
                <th className="px-4 py-3">Updated</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={definition.columns.length + 2} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={definition.columns.length + 2} className="px-4 py-10 text-center text-slate-400">No records found.</td></tr>
              ) : filtered.map((record) => (
                <tr key={record.id} className={record.active === false ? 'opacity-55' : 'hover:bg-slate-50'}>
                  {definition.columns.map((column) => <td key={column} className="px-4 py-3 max-w-[220px] truncate">{valueText(record[column])}</td>)}
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{dateTimeLabel(record.updatedAt)}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditor(record)} className="text-[#006D70] font-bold mr-3">Edit</button>
                      {record.active !== false && <button onClick={() => archive(record)} className="text-rose-600 font-bold">Archive</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editor !== undefined && (
        <ResourceEditor
          resource={resource}
          record={editor}
          onClose={() => setEditor(undefined)}
          onSaved={(saved) =>
            setRecords((current) => {
              const exists = current.some((record) => record.id === saved.id);
              return exists
                ? current.map((record) => record.id === saved.id ? saved : record)
                : [saved, ...current];
            })
          }
        />
      )}
    </div>
  );
}

function DashboardPanel({ summary }: { summary: AdminDashboardSummary | null }) {
  if (!summary) return <div className="text-sm text-slate-500">Loading dashboard…</div>;
  const cards = [
    ['Today', summary.bookings.today],
    ['Upcoming', summary.bookings.upcoming],
    ['Unassigned', summary.bookings.unassigned],
    ['Access Attention', summary.bookings.accessAttention],
    ['Document Requests', summary.documentRequests.outstanding],
    ['Urgent Maintenance', summary.maintenance.urgent],
    ['Reports to Review', summary.documents.awaitingReview],
    ['Active Staff', summary.activeStaff],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(([label, count]) => (
          <div key={String(label)} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="text-3xl font-black text-[#1A2B4A] mt-2">{count}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="font-black text-[#1A2B4A]">Items requiring attention</h3>
          <div className="mt-4 space-y-2">
            {summary.alerts.length === 0 ? (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-emerald-50 text-emerald-800 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" /> No current operational exceptions.
              </div>
            ) : summary.alerts.map((alert) => (
              <div key={alert.type} className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="w-4 h-4" /> {alert.label}</div>
                <span className="text-lg font-black text-amber-800">{alert.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="font-black text-[#1A2B4A]">Platform records</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Clients</span><strong>{summary.clients}</strong></div>
            <div className="flex justify-between"><span className="text-slate-500">Properties</span><strong>{summary.properties}</strong></div>
            <div className="flex justify-between"><span className="text-slate-500">Tenants</span><strong>{summary.tenants}</strong></div>
            <div className="flex justify-between"><span className="text-slate-500">Total bookings</span><strong>{summary.bookings.total}</strong></div>
            <div className="flex justify-between"><span className="text-slate-500">Maintenance items</span><strong>{summary.maintenance.total}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingsPanel({
  session,
  bookings,
  staff,
  onBookingChanged,
}: {
  session: AdminSession;
  bookings: BookingRecord[];
  staff: AdminStaffUser[];
  onBookingChanged: (booking: BookingRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canUpdate = hasPermission(session, 'bookings.update');
  const canCancel = hasPermission(session, 'bookings.cancel');

  const filtered = bookings.filter((booking) =>
    JSON.stringify(booking).toLowerCase().includes(query.toLowerCase())
  );

  const patch = async (booking: BookingRecord, updates: Parameters<typeof updateAdminBooking>[1]) => {
    setWorking(booking.id);
    setError(null);
    try {
      onBookingChanged(await updateAdminBooking(booking.id, updates));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update booking.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference, address, client or service…" className="w-full h-10 pl-9 pr-3 border border-slate-300 rounded-lg bg-white text-sm" />
      </div>
      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1A2B4A] text-white uppercase tracking-wider">
              <tr>
                <th className="p-3">Reference</th>
                <th className="p-3">Appointment</th>
                <th className="p-3">Property</th>
                <th className="p-3">Service</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Status</th>
                <th className="p-3">Readiness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((booking) => (
                <tr key={booking.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-[#1A2B4A]">{booking.bookingReference}</td>
                  <td className="p-3 whitespace-nowrap"><strong>{booking.appointment.dateString}</strong><div className="text-slate-500">{booking.appointment.timeString}</div></td>
                  <td className="p-3 max-w-[220px]">{booking.property.unit ? `${booking.property.unit}, ` : ''}{booking.property.streetAddress}<div className="text-slate-500">{booking.property.suburb}</div></td>
                  <td className="p-3">{booking.serviceName}</td>
                  <td className="p-3 min-w-[180px]">
                    {canUpdate ? (
                      <select
                        disabled={working === booking.id}
                        value={booking.assignedStaffId || ''}
                        onChange={(e) => patch(booking, { assignedStaffId: e.target.value })}
                        className="w-full h-8 rounded border border-slate-300 px-2"
                      >
                        <option value="">Unassigned</option>
                        {staff.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                      </select>
                    ) : valueText(staff.find((member) => member.id === booking.assignedStaffId)?.displayName)}
                  </td>
                  <td className="p-3 min-w-[140px]">
                    {canUpdate ? (
                      <select
                        disabled={working === booking.id}
                        value={booking.status}
                        onChange={(e) => {
                          const status = e.target.value as BookingStatus;
                          if (status === 'cancelled' && !canCancel) return;
                          void patch(booking, { status });
                        }}
                        className="w-full h-8 rounded border border-slate-300 px-2"
                      >
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                        {canCancel && <option value="cancelled">Cancelled</option>}
                      </select>
                    ) : booking.status}
                  </td>
                  <td className="p-3">{booking.readinessStatus.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SchedulePanel({ bookings, staff }: { bookings: BookingRecord[]; staff: AdminStaffUser[] }) {
  const upcoming = [...bookings]
    .filter((booking) => booking.status === 'confirmed')
    .sort((a, b) => a.appointment.start.localeCompare(b.appointment.start));
  const grouped = upcoming.reduce<Record<string, BookingRecord[]>>((groups, booking) => {
    (groups[booking.appointment.dateKey] ||= []).push(booking);
    return groups;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).slice(0, 14).map(([date, dayBookings]) => (
        <div key={date} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-black text-[#1A2B4A]">{dayBookings[0]?.appointment.dateString || date}</div>
          <div className="divide-y divide-slate-100">
            {dayBookings.map((booking) => (
              <div key={booking.id} className="p-4 grid grid-cols-1 md:grid-cols-[110px_1.5fr_1fr_1fr] gap-2 text-sm">
                <strong>{booking.appointment.timeString}</strong>
                <div>{booking.property.streetAddress}, {booking.property.suburb}</div>
                <div className="text-slate-500">{booking.serviceName}</div>
                <div className="font-semibold">{staff.find((member) => member.id === booking.assignedStaffId)?.displayName || 'Unassigned'}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {upcoming.length === 0 && <div className="p-10 bg-white rounded-xl border border-slate-200 text-center text-slate-400">No upcoming bookings.</div>}
    </div>
  );
}

function StaffPanel({ session }: { session: AdminSession }) {
  const [staff, setStaff] = useState<AdminStaffUser[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AdminRole>('inspector');
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission(session, 'users.manage');

  const load = async () => {
    try { setStaff(await fetchAdminStaff()); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load staff.'); }
  };
  useEffect(() => { void load(); }, []);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const created = await createAdminStaff({ email, displayName, role });
      setStaff((current) => [created, ...current.filter((member) => member.id !== created.id)]);
      setEmail(''); setDisplayName(''); setRole('inspector');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to create staff access.'); }
  };

  const patch = async (member: AdminStaffUser, updates: Parameters<typeof updateAdminStaff>[1]) => {
    try {
      const updated = await updateAdminStaff(member.id, updates);
      setStaff((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update staff.'); }
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <form onSubmit={add} className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_220px_auto] gap-3 items-end">
          <label className="space-y-1"><span className="text-xs font-bold text-slate-700">Display name</span><input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold text-slate-700">Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm" /></label>
          <label className="space-y-1"><span className="text-xs font-bold text-slate-700">Role</span><select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"><option value="administrator">Administrator</option><option value="operations_manager">Operations Manager</option><option value="inspector">Staff / Inspector</option><option value="read_only">Read Only</option></select></label>
          <button className="h-10 px-4 rounded-lg bg-[#007F82] text-white text-sm font-bold">Add Staff</button>
        </form>
      )}
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#1A2B4A] text-white uppercase tracking-wider"><tr><th className="p-3">Staff member</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Last login</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((member) => (
              <tr key={member.id}>
                <td className="p-3"><strong>{member.displayName}</strong><div className="text-slate-500">{member.email}</div></td>
                <td className="p-3">
                  {canManage ? <select value={member.role} onChange={(e) => void patch(member, { role: e.target.value as AdminRole })} className="h-8 px-2 border border-slate-300 rounded"><option value="administrator">Administrator</option><option value="operations_manager">Operations Manager</option><option value="inspector">Staff / Inspector</option><option value="read_only">Read Only</option></select> : roleLabel(member.role)}
                </td>
                <td className="p-3">{canManage ? <button onClick={() => void patch(member, { active: !member.active })} className={`px-2 py-1 rounded font-bold ${member.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{member.active ? 'Active' : 'Inactive'}</button> : member.active ? 'Active' : 'Inactive'}</td>
                <td className="p-3 text-slate-500">{dateTimeLabel(member.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
        <strong className="text-[#1A2B4A]">Role model:</strong> Administrators have full control; Operations Managers manage operational records but not security; Inspectors execute operational work; Read Only users cannot modify records. Explicit permission grants/revokes remain supported in Firestore for exceptional cases.
      </div>
    </div>
  );
}

function ServicesPanel({
  session,
  services,
  setServices,
  onServicesChanged,
}: {
  session: AdminSession;
  services: InspectionService[];
  setServices: React.Dispatch<React.SetStateAction<InspectionService[]>>;
  onServicesChanged?: (services: InspectionService[]) => void;
}) {
  const canManage = hasPermission(session, 'services.manage');
  const [editor, setEditor] = useState<InspectionService | null | undefined>(undefined);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: InspectionService[]) => {
    const ordered = [...next].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    setServices(ordered);
    onServicesChanged?.(ordered.filter((service) => service.active && service.publiclyBookable));
  };

  const save = async (input: ServiceAdminInput) => {
    if (editor) {
      const updated = await updateAdminService(editor.id, input);
      apply(services.map((service) => service.id === updated.id ? updated : service));
    } else {
      const created = await createAdminService(input);
      apply([...services, created]);
    }
  };

  const patch = async (service: InspectionService, updates: Partial<ServiceAdminInput>) => {
    setWorking(service.id);
    setError(null);
    try {
      const updated = await updateAdminService(service.id, updates);
      apply(services.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update service.');
    } finally { setWorking(null); }
  };

  const move = async (serviceId: string, delta: number) => {
    const ordered = [...services].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((service) => service.id === serviceId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    try { apply(await reorderAdminServices(ordered.map((service) => service.id))); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to reorder services.'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{canManage && <button onClick={() => setEditor(null)} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#007F82] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Add Service</button>}</div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">{error}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {services.map((service, index) => (
          <div key={service.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex justify-between gap-3"><div><h3 className="font-black text-[#1A2B4A]">{service.name}</h3><p className="text-xs text-slate-500 mt-1">{service.publicDescription}</p></div><span className={`text-[10px] h-fit px-2 py-1 rounded font-bold uppercase ${service.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{service.active ? 'Active' : 'Inactive'}</span></div>
            <div className="grid grid-cols-4 gap-2 text-xs"><div><span className="text-slate-400 block">Duration</span><strong>{service.duration}m</strong></div><div><span className="text-slate-400 block">Notice</span><strong>{service.minimumNoticeHours}h</strong></div><div><span className="text-slate-400 block">Buffer</span><strong>{service.bufferBefore}/{service.bufferAfter}m</strong></div><div><span className="text-slate-400 block">Public</span><strong>{service.publiclyBookable ? 'Yes' : 'No'}</strong></div></div>
            {canManage && <div className="pt-3 border-t border-slate-100 flex gap-2 flex-wrap"><button disabled={index === 0} onClick={() => void move(service.id, -1)} className="px-2 h-8 rounded border border-slate-300">↑</button><button disabled={index === services.length - 1} onClick={() => void move(service.id, 1)} className="px-2 h-8 rounded border border-slate-300">↓</button><button disabled={working === service.id} onClick={() => void patch(service, { publiclyBookable: !service.publiclyBookable })} className="px-3 h-8 rounded border border-slate-300 text-xs font-bold">{service.publiclyBookable ? 'Make Internal' : 'Make Public'}</button><button disabled={working === service.id} onClick={() => void patch(service, { active: !service.active })} className="px-3 h-8 rounded border border-slate-300 text-xs font-bold">{service.active ? 'Deactivate' : 'Activate'}</button><button onClick={() => setEditor(service)} className="ml-auto px-3 h-8 rounded bg-slate-100 text-xs font-bold">Edit</button></div>}
          </div>
        ))}
      </div>
      {editor !== undefined && <AdminServiceEditor service={editor} suggestedOrder={services.length + 1} onClose={() => setEditor(undefined)} onSave={save} />}
    </div>
  );
}

function ReportsPanel({ report }: { report: AdminReportSummary | null }) {
  if (!report) return <div className="text-sm text-slate-500">Loading management summary…</div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5"><h3 className="font-black text-[#1A2B4A]">Bookings by status</h3><div className="mt-4 space-y-2">{Object.entries(report.bookingsByStatus).map(([name, count]) => <div key={name} className="flex justify-between text-sm"><span className="capitalize">{name}</span><strong>{count}</strong></div>)}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-5"><h3 className="font-black text-[#1A2B4A]">Work by service</h3><div className="mt-4 space-y-2">{report.bookingsByService.slice(0, 12).map((item) => <div key={item.name} className="flex justify-between text-sm"><span>{item.name}</span><strong>{item.count}</strong></div>)}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-5"><h3 className="font-black text-[#1A2B4A]">Staff workload</h3><div className="mt-4 space-y-2">{report.bookingsByStaff.map((item) => <div key={item.name} className="flex justify-between text-sm"><span>{item.name}</span><strong>{item.completed}/{item.count} complete</strong></div>)}</div></div>
      <div className="bg-white border border-slate-200 rounded-xl p-5"><h3 className="font-black text-[#1A2B4A]">Portfolio</h3><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span>Clients</span><strong>{report.clientCount}</strong></div><div className="flex justify-between"><span>Properties</span><strong>{report.propertyCount}</strong></div><div className="flex justify-between"><span>Active subscriptions</span><strong>{report.activeSubscriptionCount}</strong></div></div></div>
    </div>
  );
}

function IntegrationsPanel({ integrations }: { integrations: AdminIntegrationStatus[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {integrations.map((integration) => (
        <div key={integration.id} className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between"><h3 className="font-black text-[#1A2B4A]">{integration.name}</h3><span className={`text-[10px] uppercase font-black px-2 py-1 rounded ${integration.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : integration.status === 'optional' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>{integration.status.replace(/_/g, ' ')}</span></div>
          <p className="text-sm text-slate-500 mt-3">{integration.detail}</p>
          <p className="text-xs text-slate-400 mt-3">{integration.configured ? 'Configuration detected by the server.' : 'No active server configuration detected.'}</p>
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({ session, settings, setSettings }: { session: AdminSession; settings: BusinessSettings | null; setSettings: (settings: BusinessSettings) => void }) {
  const [notice, setNotice] = useState(settings?.minimumNoticeHours || 24);
  const [horizon, setHorizon] = useState(settings?.maxFutureBookingDays || 60);
  const [status, setStatus] = useState<string | null>(null);
  const canUpdate = hasPermission(session, 'settings.update');
  useEffect(() => { if (settings) { setNotice(settings.minimumNoticeHours); setHorizon(settings.maxFutureBookingDays); } }, [settings]);

  if (!settings) return <div className="text-sm text-slate-500">Loading settings…</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-3xl space-y-5">
      <div><h3 className="font-black text-[#1A2B4A]">Scheduling defaults</h3><p className="text-xs text-slate-500 mt-1">Service-specific rules may impose stricter limits.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1"><span className="text-xs font-bold">Minimum notice (hours)</span><input disabled={!canUpdate} type="number" min={0} max={720} value={notice} onChange={(e) => setNotice(Number(e.target.value))} className="w-full h-10 px-3 border border-slate-300 rounded-lg" /></label>
        <label className="space-y-1"><span className="text-xs font-bold">Booking horizon (days)</span><input disabled={!canUpdate} type="number" min={1} max={365} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-full h-10 px-3 border border-slate-300 rounded-lg" /></label>
      </div>
      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm"><div><strong>Timezone:</strong> {settings.timezone}</div><div><strong>Locale:</strong> {settings.locale}</div><div><strong>Calendar:</strong> {settings.calendarConnected ? 'Connected' : 'Configuration required'}</div></div>
      {status && <div className="text-sm font-semibold text-[#006D70]">{status}</div>}
      {canUpdate && <button onClick={async () => { try { const updated = await updateAdminSettings({ minimumNoticeHours: notice, maxFutureBookingDays: horizon }); setSettings(updated); setStatus('Settings saved.'); } catch (err) { setStatus(err instanceof Error ? err.message : 'Unable to save settings.'); } }} className="inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-[#007F82] text-white text-sm font-bold"><Save className="w-4 h-4" /> Save Settings</button>}
    </div>
  );
}

function AuditPanel({ events }: { events: AdminAuditEvent[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-left text-xs">
        <thead className="bg-[#1A2B4A] text-white uppercase tracking-wider">
          <tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3">Summary</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((event) => (
            <tr key={event.id}>
              <td className="p-3 whitespace-nowrap">{dateTimeLabel(event.createdAt)}</td>
              <td className="p-3">{event.actor.displayName || event.actor.email || event.actor.id || event.actor.type}</td>
              <td className="p-3 font-mono">{event.action}</td>
              <td className="p-3">{event.entityType} / {event.entityId}</td>
              <td className="p-3">{event.summary || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  currentUser,
  onLogout,
  onBackToBooking,
  onServicesChanged,
}) => {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [section, setSection] = useState<SectionId>('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [services, setServices] = useState<InspectionService[]>([]);
  const [staff, setStaff] = useState<AdminStaffUser[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [report, setReport] = useState<AdminReportSummary | null>(null);
  const [integrations, setIntegrations] = useState<AdminIntegrationStatus[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const visibleNav = useMemo(
    () => navItems.filter((item) => hasPermission(session, item.permission)),
    [session]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resolved = await verifyAdminSession();
        if (cancelled) return;
        setSession(resolved);

        const tasks: Promise<unknown>[] = [];
        if (hasPermission(resolved, 'dashboard.read')) tasks.push(fetchAdminDashboardSummary().then(setSummary));
        if (hasPermission(resolved, 'bookings.read')) tasks.push(fetchAdminBookings().then(setBookings));
        if (hasPermission(resolved, 'services.read')) tasks.push(fetchAdminServices().then(setServices));
        if (hasPermission(resolved, 'users.read')) tasks.push(fetchAdminStaff().then(setStaff));
        if (hasPermission(resolved, 'settings.read')) tasks.push(fetchAdminSettings().then(setSettings));
        if (hasPermission(resolved, 'reports.read')) tasks.push(fetchAdminReportSummary().then(setReport));
        if (hasPermission(resolved, 'integrations.read')) tasks.push(fetchAdminIntegrations().then(setIntegrations));
        if (hasPermission(resolved, 'audit.read')) tasks.push(fetchAdminAudit().then(setAudit));
        await Promise.allSettled(tasks);
      } catch (err) {
        if (!cancelled) setFatalError(err instanceof Error ? err.message : 'Unable to open the Admin Portal.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!visibleNav.some((item) => item.id === section)) {
      setSection(visibleNav[0]?.id || 'dashboard');
    }
  }, [session, visibleNav, section]);

  const refreshDashboard = async () => {
    if (!session || !hasPermission(session, 'dashboard.read')) return;
    setSummary(await fetchAdminDashboardSummary());
  };

  if (loading) return <div className="max-w-6xl mx-auto p-8 text-sm text-slate-500">Loading ProInspect Admin Portal…</div>;
  if (fatalError || !session) return <div className="max-w-3xl mx-auto p-8"><div className="p-5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800">{fatalError || 'Administration access is unavailable.'}</div></div>;

  return (
    <div className="min-h-[76vh] lg:grid lg:grid-cols-[250px_minmax(0,1fr)] gap-5 max-w-[1500px] mx-auto">
      <aside className={`${mobileNav ? 'fixed inset-0 z-40 bg-slate-950/50 lg:static lg:bg-transparent' : 'hidden lg:block'}`}>
        <div className={`${mobileNav ? 'w-[290px] h-full overflow-y-auto' : 'sticky top-4'} bg-[#14243F] text-white lg:rounded-2xl p-3 shadow-lg`}>
          <div className="px-3 py-4 flex items-start justify-between">
            <div><div className="text-lg font-black">ProInspect</div><div className="text-xs text-slate-300">Admin Portal</div></div>
            <button onClick={() => setMobileNav(false)} className="lg:hidden p-1"><X className="w-5 h-5" /></button>
          </div>
          <nav className="space-y-1">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} onClick={() => { setSection(item.id); setMobileNav(false); }} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-bold transition-colors ${section === item.id ? 'bg-[#007F82] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Icon className="w-4 h-4 shrink-0" /><span>{item.label}</span></button>;
            })}
          </nav>
          <div className="mt-4 pt-4 border-t border-white/10 px-3 pb-2">
            <div className="text-xs font-bold">{session.displayName || currentUser?.displayName || session.email}</div>
            <div className="text-[11px] text-slate-400 mt-1">{roleLabel(session.role)}</div>
          </div>
        </div>
      </aside>

      <section className="min-w-0 space-y-5">
        <header className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileNav(true)} className="lg:hidden p-2 rounded-lg bg-slate-100"><Menu className="w-5 h-5" /></button>
            <div className="min-w-0"><h1 className="text-xl font-black text-[#1A2B4A] truncate">{sectionTitles[section]}</h1><p className="text-xs text-slate-500 truncate">{session.email}</p></div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {section === 'dashboard' && <button onClick={() => void refreshDashboard()} className="hidden sm:inline-flex items-center gap-2 px-3 h-9 rounded-lg border border-slate-300 text-xs font-bold text-slate-600"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>}
            <button onClick={onBackToBooking} className="hidden sm:block px-3 h-9 rounded-lg bg-slate-100 text-xs font-bold text-slate-700">Public Hub</button>
            <button onClick={onLogout} className="inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold"><LogOut className="w-3.5 h-3.5" /> Sign Out</button>
          </div>
        </header>

        <main className="pb-8">
          {section === 'dashboard' && <DashboardPanel summary={summary} />}
          {section === 'bookings' && <BookingsPanel session={session} bookings={bookings} staff={staff} onBookingChanged={(updated) => { setBookings((current) => current.map((booking) => booking.id === updated.id ? updated : booking)); void refreshDashboard(); }} />}
          {section === 'schedule' && <SchedulePanel bookings={bookings} staff={staff} />}
          {resourceMap[section] && <ResourcePanel section={section} session={session} />}
          {section === 'services' && <ServicesPanel session={session} services={services} setServices={setServices} onServicesChanged={onServicesChanged} />}
          {section === 'staff' && <StaffPanel session={session} />}
          {section === 'reports' && <ReportsPanel report={report} />}
          {section === 'integrations' && <IntegrationsPanel integrations={integrations} />}
          {section === 'settings' && <SettingsPanel session={session} settings={settings} setSettings={setSettings} />}
          {section === 'audit' && <AuditPanel events={audit} />}
        </main>
      </section>
    </div>
  );
};
