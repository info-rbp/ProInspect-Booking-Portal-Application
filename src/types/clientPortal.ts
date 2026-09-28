import type {
  BookingStatus,
  PropertyType,
  ServiceCategory,
} from './booking';

export type ClientOnboardingStatus = 'not_started' | 'in_progress' | 'complete';
export type ClientOrganisationRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ClientMembershipStatus = 'active' | 'invited' | 'revoked';
export type ClientRequestType = 'document' | 'maintenance' | 'general';
export type ClientRequestStatus =
  | 'submitted'
  | 'in_progress'
  | 'waiting_client'
  | 'completed'
  | 'cancelled';
export type ClientApprovalStatus =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'declined';

export interface ClientProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  active: boolean;
  onboardingStatus: ClientOnboardingStatus;
  activeOrganisationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientOrganisation {
  id: string;
  name: string;
  entityType:
    | 'individual'
    | 'company'
    | 'trust'
    | 'partnership'
    | 'strata'
    | 'agency'
    | 'other';
  abn?: string;
  acn?: string;
  billingEmail?: string;
  phone?: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientMembership {
  id: string;
  organisationId: string;
  email: string;
  uid?: string;
  displayName?: string;
  role: ClientOrganisationRole;
  status: ClientMembershipStatus;
  invitedByUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientProperty {
  id: string;
  organisationId: string;
  createdByUid: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType: PropertyType;
  nickname?: string;
  clientName?: string;
  clientReference?: string;
  categories: ServiceCategory[];
  notes?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  lastBookingAt?: string;
}

export interface ClientBookingSummary {
  id: string;
  bookingReference: string;
  propertyId?: string;
  serviceName: string;
  serviceCategory?: ServiceCategory;
  status: BookingStatus;
  property: {
    streetAddress: string;
    unit?: string;
    suburb: string;
    state: string;
    postcode: string;
    propertyType: PropertyType;
  };
  appointment: {
    start: string;
    end: string;
    dateString: string;
    timeString: string;
    durationMinutes: number;
    timezone: string;
  };
  createdAt: string;
}

export interface ClientRequestSummary {
  id: string;
  organisationId: string;
  clientUid: string;
  propertyId?: string;
  type: ClientRequestType;
  title: string;
  status: ClientRequestStatus;
  priority?: 'routine' | 'priority' | 'urgent';
  details?: Record<string, string | number | boolean | string[]>;
  attachmentDocumentIds?: string[];
  generatedDocumentId?: string;
  draftGenerationStatus?: 'generating' | 'generated' | 'failed';
  organisationName?: string;
  propertyAddress?: string;
  submittedByName?: string;
  submittedByEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDocumentSummary {
  id: string;
  organisationId: string;
  clientUid: string;
  propertyId?: string;
  requestId?: string;
  name: string;
  documentType: string;
  status: 'available' | 'draft' | 'archived';
  storagePath?: string;
  contentType?: string;
  sizeBytes?: number;
  generated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientApproval {
  id: string;
  organisationId: string;
  propertyId?: string;
  requestId?: string;
  documentId?: string;
  type: 'document' | 'quote' | 'instruction' | 'other';
  title: string;
  summary?: string;
  status: ClientApprovalStatus;
  responseComment?: string;
  requestedByUid?: string;
  requestedAt: string;
  respondedByUid?: string;
  respondedAt?: string;
  updatedAt: string;
}

export interface ClientPortalDashboard {
  profile: ClientProfile;
  organisation: ClientOrganisation;
  organisations: Array<{
    organisation: ClientOrganisation;
    role: ClientOrganisationRole;
  }>;
  membership: ClientMembership;
  members: ClientMembership[];
  properties: ClientProperty[];
  bookings: ClientBookingSummary[];
  requests: ClientRequestSummary[];
  documents: ClientDocumentSummary[];
  approvals: ClientApproval[];
}

export interface ClientPropertyInput {
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType: PropertyType;
  nickname?: string;
  clientReference?: string;
  categories: ServiceCategory[];
  notes?: string;
}

export interface ClientOnboardingInput {
  displayName: string;
  phone?: string;
  organisationName: string;
  entityType: ClientOrganisation['entityType'];
  abn?: string;
  acn?: string;
  billingEmail?: string;
  firstProperty?: ClientPropertyInput;
}

export interface ClientDocumentRequestInput {
  propertyId?: string;
  documentType:
    | 'Commercial Lease'
    | 'Lease Variation'
    | 'Lease Renewal / Extension'
    | 'Notice / Letter'
    | 'Authority / Agreement'
    | 'Other';
  title?: string;
  counterpartyName?: string;
  commencementDate?: string;
  term?: string;
  rent?: string;
  permittedUse?: string;
  specialConditions?: string;
  instructions: string;
  dueDate?: string;
}

export interface ClientMaintenanceRequestInput {
  propertyId: string;
  issueType:
    | 'Plumbing'
    | 'Electrical'
    | 'Air Conditioning'
    | 'Appliance'
    | 'Door / Window'
    | 'Security'
    | 'Water Ingress'
    | 'General Repair'
    | 'Other';
  title: string;
  description: string;
  location?: string;
  priority: 'routine' | 'priority' | 'urgent';
  activeWater?: boolean;
  powerAffected?: boolean;
  propertySecure?: boolean;
  accessNotes?: string;
}
