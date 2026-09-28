import type {
  InspectionService,
  BusinessSettings,
  AppointmentSlot,
  BookingRecord,
  PublicBookingSummary,
  ServiceAdminInput,
  AddressSuggestion,
  AddressValidationResult,
  PropertyDetails,
  ServiceCategory,
} from '../types/booking';
import type {
  AdminTenantPortalSnapshot,
  ClientPropertyLink,
  ClientPropertyRole,
  ClientRecord,
  ClientType,
  ClientUserRecord,
  PortalAudience,
  TenancyRecord,
  TenantDocument,
  TenantDocumentCategory,
  TenantInspection,
  TenantPortalDashboard,
  TenantProperty,
  TenantRequest,
  TenantRequestCreateInput,
  TenantRequestStatus,
  TenantUserRecord,
} from '../types/tenant';
import type {
  AuditEvent,
  ClientApproval,
  ClientRequest,
  Contractor,
  DocumentProduct,
  DocumentRequest,
  OperationsQueueItem,
  PaymentRecord,
  UnifiedClientDashboard,
  WorkOrder,
} from '../types/platform';
import type {
  SensitiveTenantFormRequest,
  SensitiveTenantFormStatus,
  TenantFormRequest,
  TenantFormStatus,
  TenantFormsDashboard,
} from '../types/tenantForms';
import type {
  AdminAuditEvent,
  AdminDashboardSummary,
  AdminIntegrationStatus,
  AdminReportSummary,
  AdminResourceName,
  AdminResourceRecord,
  AdminRole,
  AdminSession,
  AdminStaffUser,
} from '../types/admin';
import { getAdminIdToken, getCurrentIdToken } from './firebase';

type ApiErrorResponse = {
  error?: string;
  conflict?: boolean;
};

type ServicesResponse = { services: InspectionService[] };
type SettingsResponse = { settings: BusinessSettings };
type AvailabilityResponse = { slots: AppointmentSlot[]; message?: string };
type BookingCreateResponse = {
  success: boolean;
  booking: PublicBookingSummary;
  message?: string;
} & ApiErrorResponse;
type AdminBookingsResponse = { bookings: BookingRecord[] };
type AdminServicesResponse = { services: InspectionService[] };
type AdminSettingsResponse = { settings: BusinessSettings };
type AdminBookingUpdateResponse = { booking: BookingRecord } & ApiErrorResponse;
type AdminServiceMutationResponse = { service: InspectionService } & ApiErrorResponse;
type AdminServiceReorderResponse = { services: InspectionService[] } & ApiErrorResponse;
type PublicBookingResponse = { booking: PublicBookingSummary } & ApiErrorResponse;
type AddressAutocompleteResponse = { suggestions: AddressSuggestion[] } & ApiErrorResponse;
type AddressValidationResponse = { result: AddressValidationResult } & ApiErrorResponse;

export async function fetchServices(): Promise<InspectionService[]> {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services.');
  const data = (await res.json()) as ServicesResponse;
  return data.services;
}

export async function fetchSettings(): Promise<BusinessSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings.');
  const data = (await res.json()) as SettingsResponse;
  return data.settings;
}

export async function fetchAddressSuggestions(
  input: string
): Promise<AddressSuggestion[]> {
  const query = new URLSearchParams({ input });
  const res = await fetch(`/api/address/autocomplete?${query.toString()}`);
  const data = (await res.json()) as AddressAutocompleteResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Address suggestions are unavailable.');
  }

  return data.suggestions || [];
}

export async function validateAddress(input: {
  formattedAddress?: string;
  property?: Partial<PropertyDetails>;
}): Promise<AddressValidationResult> {
  const res = await fetch('/api/address/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as AddressValidationResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Address validation is unavailable.');
  }

  return data.result;
}

export async function fetchAvailability(
  date: string,
  serviceId: string
): Promise<{ slots: AppointmentSlot[]; message?: string }> {
  const query = new URLSearchParams({ date, serviceId });
  const res = await fetch(`/api/calendar/availability?${query.toString()}`);
  const data = (await res.json()) as AvailabilityResponse & ApiErrorResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch availability.');
  }

  return data;
}

export async function submitBooking(payload: {
  serviceId: string;
  serviceCategory: ServiceCategory;
  property: unknown;
  access: unknown;
  appointment: { start: string };
}): Promise<{ success: boolean; booking: PublicBookingSummary; message?: string }> {
  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as BookingCreateResponse;

  if (!res.ok) {
    const error = new Error(data.error || 'Failed to confirm booking.');
    (error as any).conflict = Boolean(data.conflict);
    throw error;
  }

  return data;
}

async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getAdminIdToken();

  if (!idToken) {
    throw new Error('Administrator authentication is required.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function verifyAdminSession(): Promise<AdminSession> {
  const res = await adminFetch('/api/admin/session');
  const data = (await res.json().catch(() => ({}))) as {
    session?: AdminSession;
    error?: string;
  };
  if (!res.ok || !data.session) {
    throw new Error(data.error || 'This Google account is not authorised for ProInspect administration.');
  }
  return data.session;
}

export async function fetchAdminBookings(): Promise<BookingRecord[]> {
  const res = await adminFetch('/api/admin/bookings');
  if (!res.ok) throw new Error('Failed to load bookings.');
  const data = (await res.json()) as AdminBookingsResponse;
  return data.bookings;
}

export async function fetchAdminServices(): Promise<InspectionService[]> {
  const res = await adminFetch('/api/admin/services');
  if (!res.ok) throw new Error('Failed to load services.');
  const data = (await res.json()) as AdminServicesResponse;
  return data.services;
}

export async function fetchAdminSettings(): Promise<BusinessSettings> {
  const res = await adminFetch('/api/admin/settings');
  if (!res.ok) throw new Error('Failed to load settings.');
  const data = (await res.json()) as AdminSettingsResponse;
  return data.settings;
}

export async function createAdminService(
  input: ServiceAdminInput
): Promise<InspectionService> {
  const res = await adminFetch('/api/admin/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = (await res.json()) as AdminServiceMutationResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to create service.');
  }

  return data.service;
}

export async function updateAdminService(
  serviceId: string,
  updates: Partial<ServiceAdminInput>
): Promise<InspectionService> {
  const res = await adminFetch(
    `/api/admin/services/${encodeURIComponent(serviceId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );

  const data = (await res.json()) as AdminServiceMutationResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to update service.');
  }

  return data.service;
}

export async function reorderAdminServices(
  serviceIds: string[]
): Promise<InspectionService[]> {
  const res = await adminFetch('/api/admin/services/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceIds }),
  });

  const data = (await res.json()) as AdminServiceReorderResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to reorder services.');
  }

  return data.services;
}

export async function updateAdminBooking(
  id: string,
  updates: { status?: string; adminNotes?: string; assignedStaffId?: string; clientId?: string; propertyId?: string }
): Promise<BookingRecord> {
  const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  const data = (await res.json()) as AdminBookingUpdateResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to update booking.');
  }

  return data.booking;
}

export async function cancelBookingByToken(
  token: string
): Promise<PublicBookingSummary> {
  const res = await fetch(
    `/api/bookings/manage/${encodeURIComponent(token)}/cancel`,
    { method: 'POST' }
  );
  const data = (await res.json()) as PublicBookingResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Unable to cancel this booking.');
  }

  return data.booking;
}

export async function fetchBookingByToken(token: string): Promise<PublicBookingSummary> {
  const res = await fetch(`/api/bookings/manage/${encodeURIComponent(token)}`);
  const data = (await res.json()) as PublicBookingResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Booking not found.');
  }

  return data.booking;
}


async function tenantFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getCurrentIdToken();
  if (!idToken) throw new Error('Tenant authentication is required.');

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function verifyTenantSession(): Promise<{
  tenant: Pick<TenantUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
}> {
  const res = await tenantFetch('/api/tenant/session');
  const data = (await res.json()) as {
    tenant?: Pick<TenantUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
    error?: string;
  };
  if (!res.ok || !data.tenant) {
    throw new Error(data.error || 'This account is not authorised for the tenant portal.');
  }
  return { tenant: data.tenant };
}

export async function fetchTenantDashboard(): Promise<TenantPortalDashboard> {
  const res = await tenantFetch('/api/tenant/dashboard');
  const data = (await res.json()) as { dashboard?: TenantPortalDashboard; error?: string };
  if (!res.ok || !data.dashboard) {
    throw new Error(data.error || 'Unable to load the tenant portal.');
  }
  return data.dashboard;
}

export async function fetchTenantFormsDashboard(): Promise<TenantFormsDashboard> {
  const res = await tenantFetch('/api/tenant/forms');
  const data = (await res.json()) as { dashboard?: TenantFormsDashboard; error?: string };
  if (!res.ok || !data.dashboard) {
    throw new Error(data.error || 'Unable to load tenancy forms.');
  }
  return data.dashboard;
}

export async function submitTenantFormRequest(input: {
  tenancyId: string;
  formDefinitionId: string;
  payload: Record<string, unknown>;
}): Promise<TenantFormRequest> {
  const res = await tenantFetch('/api/tenant/forms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { request?: TenantFormRequest; error?: string };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Unable to submit tenancy form.');
  }
  return data.request;
}

export async function uploadTenantFormAttachment(
  requestId: string,
  file: File
): Promise<TenantFormRequest> {
  const res = await tenantFetch(
    `/api/tenant/forms/${encodeURIComponent(requestId)}/attachments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': file.name,
      },
      body: file,
    }
  );
  const data = (await res.json()) as { request?: TenantFormRequest; error?: string };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Unable to upload attachment.');
  }
  return data.request;
}

export async function getTenantFormAttachmentDownloadUrl(
  requestId: string,
  attachmentId: string
): Promise<string> {
  const res = await tenantFetch(
    `/api/tenant/forms/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open attachment.');
  return data.url;
}

export async function createSensitiveTenantFormDraft(input: {
  tenancyId: string;
  formDefinitionId: string;
  payload: Record<string, unknown>;
}): Promise<SensitiveTenantFormRequest> {
  const res = await tenantFetch('/api/tenant/forms-sensitive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { request?: SensitiveTenantFormRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to start private tenancy workflow.');
  return data.request;
}

export async function uploadSensitiveTenantEvidence(
  requestId: string,
  file: File
): Promise<void> {
  const res = await tenantFetch(
    `/api/tenant/forms-sensitive/${encodeURIComponent(requestId)}/evidence`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': file.name,
      },
      body: file,
    }
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Unable to upload private evidence.');
  }
}

export async function submitSensitiveTenantFormWorkflow(
  requestId: string
): Promise<Pick<SensitiveTenantFormRequest, 'id' | 'reference' | 'formName' | 'status' | 'submittedAt'>> {
  const res = await tenantFetch(
    `/api/tenant/forms-sensitive/${encodeURIComponent(requestId)}/submit`,
    { method: 'POST' }
  );
  const data = (await res.json()) as {
    request?: Pick<SensitiveTenantFormRequest, 'id' | 'reference' | 'formName' | 'status' | 'submittedAt'>;
    error?: string;
  };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to submit private tenancy workflow.');
  return data.request;
}

export async function getSensitiveTenantEvidenceDownloadUrl(
  requestId: string,
  attachmentId: string
): Promise<string> {
  const res = await tenantFetch(
    `/api/tenant/forms-sensitive/${encodeURIComponent(requestId)}/evidence/${encodeURIComponent(attachmentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open private evidence.');
  return data.url;
}

export async function submitTenantRequest(
  input: TenantRequestCreateInput
): Promise<TenantRequest> {
  const res = await tenantFetch('/api/tenant/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { request?: TenantRequest; error?: string };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Unable to submit the request.');
  }
  return data.request;
}

export async function uploadTenantRequestAttachment(
  requestId: string,
  file: File
): Promise<TenantRequest> {
  const res = await tenantFetch(
    `/api/tenant/requests/${encodeURIComponent(requestId)}/attachments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': file.name,
      },
      body: file,
    }
  );
  const data = (await res.json()) as { request?: TenantRequest; error?: string };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Unable to upload the attachment.');
  }
  return data.request;
}

export async function getTenantDocumentDownloadUrl(documentId: string): Promise<string> {
  const res = await tenantFetch(
    `/api/tenant/documents/${encodeURIComponent(documentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Unable to open the document.');
  }
  return data.url;
}

export async function getTenantAttachmentDownloadUrl(
  requestId: string,
  attachmentId: string
): Promise<string> {
  const res = await tenantFetch(
    `/api/tenant/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Unable to open the attachment.');
  }
  return data.url;
}

export async function fetchAdminTenantPortal(): Promise<AdminTenantPortalSnapshot> {
  const res = await adminFetch('/api/admin/tenant-portal');
  const data = (await res.json()) as { snapshot?: AdminTenantPortalSnapshot; error?: string };
  if (!res.ok || !data.snapshot) {
    throw new Error(data.error || 'Unable to load tenant portal data.');
  }
  return data.snapshot;
}

export async function createAdminTenantProperty(input: {
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType?: string;
  primaryClientId?: string;
  clientName?: string;
  clientReference?: string;
}): Promise<TenantProperty> {
  const res = await adminFetch('/api/admin/tenant-properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { property?: TenantProperty; error?: string };
  if (!res.ok || !data.property) throw new Error(data.error || 'Unable to create property.');
  return data.property;
}

export async function createAdminTenancy(input: {
  propertyId: string;
  startDate: string;
  endDate?: string;
  rentAmount?: number;
  rentFrequency?: TenancyRecord['rentFrequency'];
  bondReference?: string;
  notes?: string;
  status?: TenancyRecord['status'];
}): Promise<TenancyRecord> {
  const res = await adminFetch('/api/admin/tenancies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { tenancy?: TenancyRecord; error?: string };
  if (!res.ok || !data.tenancy) throw new Error(data.error || 'Unable to create tenancy.');
  return data.tenancy;
}

export async function createAdminTenantUser(input: {
  email: string;
  displayName: string;
  phone?: string;
  tenancyIds: string[];
}): Promise<{ tenant: TenantUserRecord; portalUrl: string }> {
  const res = await adminFetch('/api/admin/tenant-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    tenant?: TenantUserRecord;
    portalUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.tenant) throw new Error(data.error || 'Unable to create tenant user.');
  return { tenant: data.tenant, portalUrl: data.portalUrl || '/tenant' };
}

export async function updateAdminTenantRequest(
  requestId: string,
  changes: { status?: TenantRequestStatus; adminNotes?: string }
): Promise<TenantRequest> {
  const res = await adminFetch(
    `/api/admin/tenant-requests/${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }
  );
  const data = (await res.json()) as { request?: TenantRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to update tenant request.');
  return data.request;
}

export async function uploadAdminTenantDocument(params: {
  tenancyId: string;
  title: string;
  category: TenantDocumentCategory;
  file: File;
}): Promise<TenantDocument> {
  const res = await adminFetch(
    `/api/admin/tenant-documents/${encodeURIComponent(params.tenancyId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': params.file.type || 'application/octet-stream',
        'X-File-Name': params.file.name,
        'X-Document-Title': params.title,
        'X-Document-Category': params.category,
      },
      body: params.file,
    }
  );
  const data = (await res.json()) as { document?: TenantDocument; error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || 'Unable to upload document.');
  return data.document;
}

export async function createAdminTenantInspection(input: {
  tenancyId: string;
  propertyId: string;
  type: TenantInspection['type'];
  scheduledStart: string;
  scheduledEnd?: string;
  noticeDocumentId?: string;
  notes?: string;
}): Promise<TenantInspection> {
  const res = await adminFetch('/api/admin/tenant-inspections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { inspection?: TenantInspection; error?: string };
  if (!res.ok || !data.inspection) throw new Error(data.error || 'Unable to create inspection.');
  return data.inspection;
}


export async function updateAdminTenancy(
  tenancyId: string,
  changes: { status?: TenancyRecord['status']; endDate?: string; notes?: string }
): Promise<TenancyRecord> {
  const res = await adminFetch(
    `/api/admin/tenancies/${encodeURIComponent(tenancyId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }
  );
  const data = (await res.json()) as { tenancy?: TenancyRecord; error?: string };
  if (!res.ok || !data.tenancy) throw new Error(data.error || 'Unable to update tenancy.');
  return data.tenancy;
}

export async function updateAdminTenantUser(
  tenantUserId: string,
  changes: {
    active?: boolean;
    displayName?: string;
    phone?: string;
    tenancyIds?: string[];
  }
): Promise<TenantUserRecord> {
  const res = await adminFetch(
    `/api/admin/tenant-users/${encodeURIComponent(tenantUserId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }
  );
  const data = (await res.json()) as { tenant?: TenantUserRecord; error?: string };
  if (!res.ok || !data.tenant) throw new Error(data.error || 'Unable to update tenant access.');
  return data.tenant;
}


export async function createAdminClient(input: {
  name: string;
  clientType: ClientType;
  email?: string;
  phone?: string;
  externalReference?: string;
}): Promise<ClientRecord> {
  const res = await adminFetch('/api/admin/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { client?: ClientRecord; error?: string };
  if (!res.ok || !data.client) throw new Error(data.error || 'Unable to create client.');
  return data.client;
}

export async function createAdminClientUser(input: {
  email: string;
  displayName: string;
  phone?: string;
  clientIds: string[];
  role: 'owner' | 'admin' | 'member' | 'viewer';
}): Promise<{ clientUser: ClientUserRecord; portalUrl: string }> {
  const res = await adminFetch('/api/admin/client-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    clientUser?: ClientUserRecord;
    portalUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.clientUser) throw new Error(data.error || 'Unable to create client portal user.');
  return { clientUser: data.clientUser, portalUrl: data.portalUrl || '/client' };
}

export async function linkAdminClientProperty(input: {
  clientId: string;
  propertyId: string;
  role: ClientPropertyRole;
  primary?: boolean;
}): Promise<ClientPropertyLink> {
  const res = await adminFetch('/api/admin/client-property-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { link?: ClientPropertyLink; error?: string };
  if (!res.ok || !data.link) throw new Error(data.error || 'Unable to link client to property.');
  return data.link;
}

export async function uploadAdminPropertyDocument(params: {
  propertyId: string;
  tenancyId?: string;
  title: string;
  category: TenantDocumentCategory;
  clientIds?: string[];
  audiences: PortalAudience[];
  file: File;
}): Promise<TenantDocument> {
  const headers = new Headers({
    'Content-Type': params.file.type || 'application/octet-stream',
    'X-File-Name': params.file.name,
    'X-Document-Title': params.title,
    'X-Document-Category': params.category,
    'X-Document-Audiences': params.audiences.join(','),
  });

  if (params.tenancyId) headers.set('X-Tenancy-Id', params.tenancyId);
  if (params.clientIds?.length) headers.set('X-Client-Ids', params.clientIds.join(','));

  const res = await adminFetch(
    `/api/admin/property-documents/${encodeURIComponent(params.propertyId)}`,
    {
      method: 'POST',
      headers,
      body: params.file,
    }
  );
  const data = (await res.json()) as { document?: TenantDocument; error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || 'Unable to upload property document.');
  return data.document;
}

async function clientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getCurrentIdToken();
  if (!idToken) throw new Error('Client authentication is required.');

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);
  return fetch(input, { ...init, headers });
}

export async function verifyClientSession(): Promise<{
  clientUser: Pick<ClientUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
}> {
  const res = await clientFetch('/api/client/session');
  const data = (await res.json()) as {
    clientUser?: Pick<ClientUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
    error?: string;
  };
  if (!res.ok || !data.clientUser) {
    throw new Error(data.error || 'This account is not authorised for the client portal.');
  }
  return { clientUser: data.clientUser };
}

export async function fetchClientDashboard(): Promise<UnifiedClientDashboard> {
  const res = await clientFetch('/api/client/dashboard');
  const data = (await res.json()) as { dashboard?: UnifiedClientDashboard; error?: string };
  if (!res.ok || !data.dashboard) throw new Error(data.error || 'Unable to load the client portal.');
  return data.dashboard;
}

export async function getClientDocumentDownloadUrl(documentId: string): Promise<string> {
  const res = await clientFetch(
    `/api/client/documents/${encodeURIComponent(documentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open the document.');
  return data.url;
}


export async function fetchDocumentProducts(): Promise<DocumentProduct[]> {
  const res = await fetch('/api/document-products');
  const data = (await res.json()) as { documents?: DocumentProduct[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Unable to load document products.');
  return data.documents || [];
}

export async function submitDocumentRequest(input: {
  documentId: string;
  documentCategory: ServiceCategory;
  details: {
    streetAddress: string;
    unit?: string;
    suburb: string;
    state: string;
    postcode: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    propertyId?: string;
    clientId?: string;
    clientUserId?: string;
    notes?: string;
  };
}): Promise<DocumentRequest> {
  const res = await fetch('/api/document-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { request?: DocumentRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to submit document request.');
  return data.request;
}

export async function createClientRequest(input: {
  clientId: string;
  propertyId?: string;
  type: 'maintenance' | 'document' | 'general';
  title: string;
  details: string;
  priority?: 'routine' | 'priority' | 'urgent';
  payload?: Record<string, string | number | boolean | null>;
}): Promise<ClientRequest> {
  const res = await clientFetch('/api/client/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { request?: ClientRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to submit request.');
  return data.request;
}

export async function respondClientApproval(
  approvalId: string,
  input: { status: 'approved' | 'approved_with_conditions' | 'changes_requested' | 'declined'; comment?: string }
): Promise<ClientApproval> {
  const res = await clientFetch(`/api/client/approvals/${encodeURIComponent(approvalId)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { approval?: ClientApproval; error?: string };
  if (!res.ok || !data.approval) throw new Error(data.error || 'Unable to save approval response.');
  return data.approval;
}

export async function markClientNotificationRead(notificationId: string): Promise<void> {
  const res = await clientFetch(`/api/client/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Unable to update notification.');
  }
}

export async function fetchAdminOperations(): Promise<{
  queue: OperationsQueueItem[];
  workOrders: WorkOrder[];
  contractors: Contractor[];
  approvals: ClientApproval[];
  clientRequests: ClientRequest[];
  documentRequests: DocumentRequest[];
  payments: PaymentRecord[];
  auditEvents: AuditEvent[];
}> {
  const res = await adminFetch('/api/admin/operations');
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data.error || 'Unable to load operations.');
  return data;
}

export async function createAdminContractor(input: {
  name: string;
  trade?: string;
  email?: string;
  phone?: string;
  notes?: string;
}): Promise<Contractor> {
  const res = await adminFetch('/api/admin/contractors', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(input),
  });
  const data = (await res.json()) as { contractor?: Contractor; error?: string };
  if (!res.ok || !data.contractor) throw new Error(data.error || 'Unable to create contractor.');
  return data.contractor;
}

export async function createAdminWorkOrder(input: {
  sourceType?: WorkOrder['sourceType'];
  sourceId?: string;
  propertyId: string;
  clientId?: string;
  tenancyId?: string;
  title: string;
  description: string;
  priority?: WorkOrder['priority'];
  accessNotes?: string;
}): Promise<WorkOrder> {
  const res = await adminFetch('/api/admin/work-orders', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(input),
  });
  const data = (await res.json()) as { workOrder?: WorkOrder; error?: string };
  if (!res.ok || !data.workOrder) throw new Error(data.error || 'Unable to create work order.');
  return data.workOrder;
}

export async function updateAdminWorkOrder(
  id: string,
  changes: Partial<Pick<WorkOrder,
    'status' | 'contractorId' | 'quoteAmountExGst' | 'quoteDocumentId' |
    'invoiceDocumentId' | 'scheduledStart' | 'scheduledEnd' | 'accessNotes' |
    'completionNotes' | 'completionDocumentIds'>>
): Promise<WorkOrder> {
  const res = await adminFetch(`/api/admin/work-orders/${encodeURIComponent(id)}`, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(changes),
  });
  const data = (await res.json()) as { workOrder?: WorkOrder; error?: string };
  if (!res.ok || !data.workOrder) throw new Error(data.error || 'Unable to update work order.');
  return data.workOrder;
}

export async function createAdminApproval(input: {
  clientId: string;
  propertyId?: string;
  clientUserId?: string;
  workOrderId?: string;
  documentId?: string;
  requestId?: string;
  type: ClientApproval['type'];
  title: string;
  summary?: string;
  amountExGst?: number;
}): Promise<ClientApproval> {
  const res = await adminFetch('/api/admin/approvals', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(input),
  });
  const data = (await res.json()) as { approval?: ClientApproval; error?: string };
  if (!res.ok || !data.approval) throw new Error(data.error || 'Unable to create approval.');
  return data.approval;
}

export async function updateAdminClientRequest(
  id: string,
  changes: { status?: ClientRequest['status']; adminNotes?: string }
): Promise<ClientRequest> {
  const res = await adminFetch(`/api/admin/client-requests/${encodeURIComponent(id)}`, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(changes),
  });
  const data = (await res.json()) as { request?: ClientRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to update client request.');
  return data.request;
}

export async function updateAdminDocumentRequest(
  id: string,
  changes: Partial<Pick<DocumentRequest, 'status' | 'generatedDocumentId' | 'propertyId' | 'clientId'>>
): Promise<DocumentRequest> {
  const res = await adminFetch(`/api/admin/document-requests/${encodeURIComponent(id)}`, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(changes),
  });
  const data = (await res.json()) as { request?: DocumentRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to update document request.');
  return data.request;
}

export async function updateAdminPayment(id: string, status: PaymentRecord['status']): Promise<PaymentRecord> {
  const res = await adminFetch(`/api/admin/payments/${encodeURIComponent(id)}`, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ status }),
  });
  const data = (await res.json()) as { payment?: PaymentRecord; error?: string };
  if (!res.ok || !data.payment) throw new Error(data.error || 'Unable to update payment.');
  return data.payment;
}


export async function createClientPropertySelf(input: {
  clientId: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType?: string;
  clientReference?: string;
}): Promise<TenantProperty> {
  const res = await clientFetch('/api/client/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { property?: TenantProperty; error?: string };
  if (!res.ok || !data.property) throw new Error(data.error || 'Unable to add property.');
  return data.property;
}

export async function createClientTeamUser(input: {
  clientId: string;
  displayName: string;
  email: string;
  phone?: string;
  role: 'admin' | 'member' | 'viewer';
}): Promise<{ clientUser: ClientUserRecord; portalUrl: string }> {
  const res = await clientFetch('/api/client/team-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    clientUser?: ClientUserRecord;
    portalUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.clientUser) throw new Error(data.error || 'Unable to add portal user.');
  return { clientUser: data.clientUser, portalUrl: data.portalUrl || '/client' };
}


export async function updateClientTeamMembership(input: {
  clientUserId: string;
  clientId: string;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
  revoke?: boolean;
}): Promise<ClientUserRecord> {
  const res = await clientFetch(
    `/api/client/team-users/${encodeURIComponent(input.clientUserId)}/membership`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId,
        role: input.role,
        revoke: input.revoke,
      }),
    }
  );
  const data = (await res.json()) as { clientUser?: ClientUserRecord; error?: string };
  if (!res.ok || !data.clientUser) {
    throw new Error(data.error || 'Unable to update Client Portal access.');
  }
  return data.clientUser;
}

export async function fetchAdminTenantForms(): Promise<TenantFormRequest[]> {
  const res = await adminFetch('/api/admin/tenant-forms');
  const data = (await res.json()) as { requests?: TenantFormRequest[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Unable to load tenant form requests.');
  return data.requests || [];
}

export async function updateAdminTenantForm(
  id: string,
  changes: {
    status?: TenantFormStatus;
    adminNotes?: string;
    serviceMethod?: TenantFormRequest['serviceMethod'];
    generatedDocumentId?: string;
    finalDocumentId?: string;
  }
): Promise<TenantFormRequest> {
  const res = await adminFetch(`/api/admin/tenant-forms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  const data = (await res.json()) as { request?: TenantFormRequest; error?: string };
  if (!res.ok || !data.request) throw new Error(data.error || 'Unable to update tenant form request.');
  return data.request;
}

export async function fetchAdminSensitiveTenantForms(): Promise<Array<{
  id: string;
  reference: string;
  formName: string;
  formCode: string;
  tenantUserId: string;
  tenancyId: string;
  propertyId: string;
  status: SensitiveTenantFormStatus;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}>> {
  const res = await adminFetch('/api/admin/sensitive-tenant-forms');
  if (res.status === 403) return [];
  const data = (await res.json()) as { requests?: any[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Unable to load restricted tenancy workflows.');
  return data.requests || [];
}

export async function updateAdminSensitiveTenantForm(
  id: string,
  changes: { status?: SensitiveTenantFormStatus; restrictedNotes?: string }
): Promise<void> {
  const res = await adminFetch(`/api/admin/sensitive-tenant-forms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Unable to update restricted tenancy workflow.');
  }
}

export async function getAdminSensitiveEvidenceDownloadUrl(
  requestId: string,
  attachmentId: string
): Promise<string> {
  const res = await adminFetch(
    `/api/admin/sensitive-tenant-forms/${encodeURIComponent(requestId)}/evidence/${encodeURIComponent(attachmentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open restricted evidence.');
  return data.url;
}


export async function getAdminTenantFormAttachmentDownloadUrl(
  requestId: string,
  attachmentId: string
): Promise<string> {
  const res = await adminFetch(
    `/api/admin/tenant-forms/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}/download`
  );
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Unable to open tenant form attachment.');
  return data.url;
}


export async function markTenantNotificationRead(notificationId: string): Promise<void> {
  const res = await tenantFetch(`/api/tenant/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Unable to mark notification as read.');
  }
}


export async function fetchAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const res = await adminFetch('/api/admin/dashboard');
  const data = await res.json() as { summary?: AdminDashboardSummary; error?: string };
  if (!res.ok || !data.summary) throw new Error(data.error || 'Failed to load dashboard.');
  return data.summary;
}

export async function fetchAdminStaff(): Promise<AdminStaffUser[]> {
  const res = await adminFetch('/api/admin/staff');
  const data = await res.json() as { staff?: AdminStaffUser[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Failed to load staff.');
  return data.staff || [];
}

export async function createAdminStaff(input: {
  email: string;
  displayName: string;
  role: AdminRole;
  assignedServiceIds?: string[];
  assignedPropertyIds?: string[];
  assignedClientIds?: string[];
}): Promise<AdminStaffUser> {
  const res = await adminFetch('/api/admin/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json() as { staff?: AdminStaffUser; error?: string };
  if (!res.ok || !data.staff) throw new Error(data.error || 'Failed to create staff access.');
  return data.staff;
}

export async function updateAdminStaff(
  uid: string,
  updates: Partial<Pick<AdminStaffUser,
    'displayName' | 'role' | 'active' | 'assignedServiceIds' |
    'assignedPropertyIds' | 'assignedClientIds' | 'resourceScope' |
    'permissionGrants' | 'permissionRevokes'>>
): Promise<AdminStaffUser> {
  const res = await adminFetch(`/api/admin/staff/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json() as { staff?: AdminStaffUser; error?: string };
  if (!res.ok || !data.staff) throw new Error(data.error || 'Failed to update staff access.');
  return data.staff;
}

export async function fetchAdminResource(resource: AdminResourceName): Promise<AdminResourceRecord[]> {
  const res = await adminFetch(`/api/admin/resources/${encodeURIComponent(resource)}`);
  const data = await res.json() as { records?: AdminResourceRecord[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Failed to load records.');
  return data.records || [];
}

export async function createAdminResource(
  resource: AdminResourceName,
  record: Record<string, unknown>
): Promise<AdminResourceRecord> {
  const res = await adminFetch(`/api/admin/resources/${encodeURIComponent(resource)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  const data = await res.json() as { record?: AdminResourceRecord; error?: string };
  if (!res.ok || !data.record) throw new Error(data.error || 'Failed to create record.');
  return data.record;
}

export async function updateAdminResource(
  resource: AdminResourceName,
  id: string,
  updates: Record<string, unknown>
): Promise<AdminResourceRecord> {
  const res = await adminFetch(
    `/api/admin/resources/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );
  const data = await res.json() as { record?: AdminResourceRecord; error?: string };
  if (!res.ok || !data.record) throw new Error(data.error || 'Failed to update record.');
  return data.record;
}

export async function archiveAdminResource(
  resource: AdminResourceName,
  id: string
): Promise<AdminResourceRecord> {
  const res = await adminFetch(
    `/api/admin/resources/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  const data = await res.json() as { record?: AdminResourceRecord; error?: string };
  if (!res.ok || !data.record) throw new Error(data.error || 'Failed to archive record.');
  return data.record;
}

export async function fetchAdminReportSummary(): Promise<AdminReportSummary> {
  const res = await adminFetch('/api/admin/reports/summary');
  const data = await res.json() as { report?: AdminReportSummary; error?: string };
  if (!res.ok || !data.report) throw new Error(data.error || 'Failed to load report summary.');
  return data.report;
}

export async function fetchAdminIntegrations(): Promise<AdminIntegrationStatus[]> {
  const res = await adminFetch('/api/admin/integrations');
  const data = await res.json() as { integrations?: AdminIntegrationStatus[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Failed to load integrations.');
  return data.integrations || [];
}

export async function fetchAdminAudit(limit = 250): Promise<AdminAuditEvent[]> {
  const res = await adminFetch(`/api/admin/audit?limit=${limit}`);
  const data = await res.json() as { events?: AdminAuditEvent[]; error?: string };
  if (!res.ok) throw new Error(data.error || 'Failed to load audit trail.');
  return data.events || [];
}

export async function updateAdminSettings(
  updates: Partial<BusinessSettings>
): Promise<BusinessSettings> {
  const res = await adminFetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json() as { settings?: BusinessSettings; error?: string };
  if (!res.ok || !data.settings) throw new Error(data.error || 'Failed to update settings.');
  return data.settings;
}
