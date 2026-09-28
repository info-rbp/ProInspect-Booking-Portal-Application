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
  ClientApproval,
  ClientDocumentRequestInput,
  ClientDocumentSummary,
  ClientMaintenanceRequestInput,
  ClientMembership,
  ClientOnboardingInput,
  ClientPortalDashboard,
  ClientProperty,
  ClientPropertyInput,
  ClientRequestSummary,
} from '../types/clientPortal';
import type {
  DocumentProduct,
  DocumentRequestDetails,
  DocumentRequestRecord,
  DocumentWorkflowData,
  PublicDocumentRequestSummary,
} from '../types/documentRequest';
import { getAdminIdToken, getAuthIdToken } from './firebase';

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
type AdminDocumentRequestsResponse = { requests: DocumentRequestRecord[] };
type AdminClientRequestsResponse = { requests: ClientRequestSummary[] };
type AdminClientApprovalsResponse = { approvals: ClientApproval[] };
type AdminClientDocumentsResponse = { documents: ClientDocumentSummary[] };
type AdminServicesResponse = { services: InspectionService[] };
type AdminSettingsResponse = { settings: BusinessSettings };
type AdminBookingUpdateResponse = { booking: BookingRecord } & ApiErrorResponse;
type AdminServiceMutationResponse = { service: InspectionService } & ApiErrorResponse;
type AdminServiceReorderResponse = { services: InspectionService[] } & ApiErrorResponse;
type PublicBookingResponse = { booking: PublicBookingSummary } & ApiErrorResponse;
type AddressAutocompleteResponse = { suggestions: AddressSuggestion[] } & ApiErrorResponse;
type AddressValidationResponse = { result: AddressValidationResult } & ApiErrorResponse;
type ClientSessionResponse = { authorised: boolean };
type ClientDashboardResponse = { dashboard: ClientPortalDashboard } & ApiErrorResponse;
type DocumentProductsResponse = { documents: DocumentProduct[] } & ApiErrorResponse;
type DocumentRequestCreateResponse = {
  success: boolean;
  request: PublicDocumentRequestSummary;
  message?: string;
} & ApiErrorResponse;

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
  const idToken = await getAuthIdToken();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);

  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers,
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

export async function fetchDocumentProducts(): Promise<DocumentProduct[]> {
  const res = await fetch('/api/document-products');
  const data = (await res.json()) as DocumentProductsResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to load document products.');
  }

  return data.documents || [];
}

export async function submitDocumentRequest(payload: {
  documentId: string;
  documentCategory: ServiceCategory;
  details: DocumentRequestDetails;
  workflow: DocumentWorkflowData;
}): Promise<{
  success: boolean;
  request: PublicDocumentRequestSummary;
  message?: string;
}> {
  const idToken = await getAuthIdToken();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);

  const res = await fetch('/api/document-requests', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as DocumentRequestCreateResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to submit document request.');
  }

  return data;
}

async function clientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getAuthIdToken();

  if (!idToken) {
    throw new Error('Client authentication is required.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function verifyClientSession(): Promise<void> {
  const res = await clientFetch('/api/client/session');
  const data = (await res.json().catch(() => ({}))) as Partial<ClientSessionResponse> & ApiErrorResponse;

  if (!res.ok || data.authorised !== true) {
    throw new Error(data.error || 'This account could not be verified for the ProInspect Client Portal.');
  }
}

export async function fetchClientDashboard(): Promise<ClientPortalDashboard> {
  const res = await clientFetch('/api/client/dashboard');
  const data = (await res.json()) as ClientDashboardResponse;

  if (!res.ok) {
    throw new Error(data.error || 'Failed to load the client portal.');
  }

  return data.dashboard;
}

async function clientJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await clientFetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorResponse;
  if (!res.ok) {
    throw new Error(data.error || 'The client portal request failed.');
  }
  return data;
}

export async function completeClientOnboarding(
  input: ClientOnboardingInput
): Promise<void> {
  await clientJson('/api/client/onboarding', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createClientProperty(
  input: ClientPropertyInput
): Promise<ClientProperty> {
  const data = await clientJson<{ property: ClientProperty }>(
    '/api/client/properties',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.property;
}

export async function updateClientProperty(
  propertyId: string,
  changes: Partial<Pick<ClientProperty, 'nickname' | 'clientReference' | 'categories' | 'notes' | 'status'>>
): Promise<ClientProperty> {
  const data = await clientJson<{ property: ClientProperty }>(
    `/api/client/properties/${encodeURIComponent(propertyId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }
  );
  return data.property;
}

export async function activateClientOrganisation(
  organisationId: string
): Promise<void> {
  await clientJson(
    `/api/client/organisations/${encodeURIComponent(organisationId)}/activate`,
    { method: 'POST' }
  );
}

export async function inviteClientMember(input: {
  email: string;
  role: 'admin' | 'member' | 'viewer';
}): Promise<ClientMembership> {
  const data = await clientJson<{ membership: ClientMembership }>(
    '/api/client/organisation/members',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.membership;
}

export async function updateClientMember(
  membershipId: string,
  changes: {
    role?: 'admin' | 'member' | 'viewer';
    status?: 'active' | 'revoked';
  }
): Promise<ClientMembership> {
  const data = await clientJson<{ membership: ClientMembership }>(
    `/api/client/organisation/members/${encodeURIComponent(membershipId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }
  );
  return data.membership;
}

export async function createClientDocumentRequest(
  input: ClientDocumentRequestInput
): Promise<ClientRequestSummary> {
  const data = await clientJson<{ request: ClientRequestSummary }>(
    '/api/client/requests/document',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.request;
}

export async function createClientMaintenanceRequest(
  input: ClientMaintenanceRequestInput
): Promise<ClientRequestSummary> {
  const data = await clientJson<{ request: ClientRequestSummary }>(
    '/api/client/requests/maintenance',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.request;
}

export async function uploadClientFile(params: {
  file: File;
  propertyId?: string;
  requestId?: string;
  documentType?: string;
}): Promise<ClientDocumentSummary> {
  const headers = new Headers({
    'Content-Type': params.file.type || 'application/octet-stream',
    'x-file-name': encodeURIComponent(params.file.name),
  });
  if (params.propertyId) headers.set('x-property-id', params.propertyId);
  if (params.requestId) headers.set('x-request-id', params.requestId);
  if (params.documentType) headers.set('x-document-type', params.documentType);

  const res = await clientFetch('/api/client/files/upload', {
    method: 'POST',
    headers,
    body: params.file,
  });
  const data = (await res.json().catch(() => ({}))) as {
    document?: ClientDocumentSummary;
    error?: string;
  };
  if (!res.ok || !data.document) {
    throw new Error(data.error || 'File upload failed.');
  }
  return data.document;
}

export async function generateClientDocumentDraft(
  requestId: string
): Promise<{ document: ClientDocumentSummary; approval: ClientApproval }> {
  return clientJson(
    `/api/client/requests/${encodeURIComponent(requestId)}/generate-draft`,
    { method: 'POST' }
  );
}

export async function downloadClientDocument(
  documentId: string
): Promise<{ blob: Blob; fileName: string }> {
  const res = await clientFetch(
    `/api/client/documents/${encodeURIComponent(documentId)}/download`
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(data.error || 'Document download failed.');
  }

  const disposition = res.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fileName = encodedName ? decodeURIComponent(encodedName) : 'document';
  return { blob: await res.blob(), fileName };
}

export async function respondClientApproval(
  approvalId: string,
  input: {
    status: 'approved' | 'changes_requested' | 'declined';
    comment?: string;
  }
): Promise<ClientApproval> {
  const data = await clientJson<{ approval: ClientApproval }>(
    `/api/client/approvals/${encodeURIComponent(approvalId)}/respond`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.approval;
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

export async function fetchAdminDocumentRequests(): Promise<DocumentRequestRecord[]> {
  const res = await adminFetch('/api/admin/document-requests');
  if (!res.ok) throw new Error('Failed to load document requests.');
  const data = (await res.json()) as AdminDocumentRequestsResponse;
  return data.requests;
}

export async function updateAdminDocumentRequest(
  requestId: string,
  status: DocumentRequestRecord['status']
): Promise<DocumentRequestRecord> {
  const res = await adminFetch(
    `/api/admin/document-requests/${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
  const data = (await res.json()) as {
    request?: DocumentRequestRecord;
    error?: string;
  };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Failed to update document request.');
  }
  return data.request;
}

export async function fetchAdminClientRequests(): Promise<ClientRequestSummary[]> {
  const res = await adminFetch('/api/admin/client-requests');
  if (!res.ok) throw new Error('Failed to load client requests.');
  const data = (await res.json()) as AdminClientRequestsResponse;
  return data.requests;
}

export async function updateAdminClientRequest(
  requestId: string,
  status: ClientRequestSummary['status']
): Promise<ClientRequestSummary> {
  const res = await adminFetch(
    `/api/admin/client-requests/${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
  const data = (await res.json()) as { request?: ClientRequestSummary; error?: string };
  if (!res.ok || !data.request) {
    throw new Error(data.error || 'Failed to update client request.');
  }
  return data.request;
}

export async function fetchAdminClientApprovals(): Promise<ClientApproval[]> {
  const res = await adminFetch('/api/admin/client-approvals');
  if (!res.ok) throw new Error('Failed to load client approvals.');
  const data = (await res.json()) as AdminClientApprovalsResponse;
  return data.approvals;
}

export async function fetchAdminClientDocuments(): Promise<ClientDocumentSummary[]> {
  const res = await adminFetch('/api/admin/client-documents');
  if (!res.ok) throw new Error('Failed to load client documents.');
  const data = (await res.json()) as AdminClientDocumentsResponse;
  return data.documents;
}

export async function downloadAdminClientDocument(
  documentId: string
): Promise<{ blob: Blob; fileName: string }> {
  const res = await adminFetch(
    `/api/admin/client-documents/${encodeURIComponent(documentId)}/download`
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(data.error || 'Client document download failed.');
  }

  const disposition = res.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fileName = encodedName ? decodeURIComponent(encodedName) : 'document';
  return { blob: await res.blob(), fileName };
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
