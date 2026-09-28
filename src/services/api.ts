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

export async function verifyAdminSession(): Promise<void> {
  const res = await adminFetch('/api/admin/session');
  if (!res.ok) {
    throw new Error('This Google account is not authorised for ProInspect administration.');
  }
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
  updates: { status?: string; adminNotes?: string }
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
