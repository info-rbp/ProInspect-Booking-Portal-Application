import type { ServiceCategory } from './booking.js';
import type { DocumentWorkflowData } from './documentRequest.js';

export type ClientType =
  | 'landlord'
  | 'agency'
  | 'commercial_landlord'
  | 'strata_company'
  | 'asset_manager'
  | 'other';

export type ClientUserRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ClientMembershipStatus = 'active' | 'invited' | 'revoked';
export type ClientPropertyRole =
  | 'owner'
  | 'landlord'
  | 'managing_agent'
  | 'asset_manager'
  | 'strata_manager'
  | 'other';
export type PortalAudience = 'tenant' | 'client' | 'staff';

export interface ClientRecord {
  id: string;
  name: string;
  clientType: ClientType;
  email?: string;
  phone?: string;
  externalReference?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ClientUserRecord {
  id: string;
  email: string;
  emailLower: string;
  displayName: string;
  phone?: string;
  firebaseUid?: string;
  active: boolean;
  clientIds: string[];
  clientRoles: Record<string, ClientUserRole>;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface ClientMembership {
  id: string;
  clientId: string;
  clientUserId: string;
  email: string;
  role: ClientUserRole;
  status: ClientMembershipStatus;
  invitedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyRecord {
  id: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType?: string;
  addressKey?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  primaryClientId?: string;
  clientName?: string;
  clientReference?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ClientPropertyLink {
  id: string;
  clientId: string;
  propertyId: string;
  role: ClientPropertyRole;
  primary: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenancyRecord {
  id: string;
  propertyId: string;
  clientId?: string;
  status: 'pending' | 'active' | 'ended';
  startDate: string;
  endDate?: string;
  rentAmount?: number;
  rentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  bondReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserRecord {
  id: string;
  email: string;
  emailLower: string;
  displayName: string;
  phone?: string;
  firebaseUid?: string;
  tenancyIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export type DocumentStatus =
  | 'draft'
  | 'generated'
  | 'review'
  | 'approved'
  | 'issued'
  | 'archived';

export interface PropertyDocument {
  id: string;
  propertyId: string;
  clientIds: string[];
  tenancyId?: string;
  bookingId?: string;
  workOrderId?: string;
  requestId?: string;
  audiences: PortalAudience[];
  title: string;
  category: string;
  fileName: string;
  storagePath?: string;
  contentType: string;
  size: number;
  version: number;
  status: DocumentStatus;
  uploadedAt: string;
  uploadedBy: string;
  generatedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  issuedAt?: string;
  issuedBy?: string;
  updatedAt: string;
}

export type DocumentRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'awaiting_information'
  | 'in_preparation'
  | 'review'
  | 'ready'
  | 'completed'
  | 'cancelled';

export interface DocumentRequest {
  id: string;
  reference: string;
  documentProductId: string;
  documentName: string;
  documentCategory: ServiceCategory;
  pricingMode: 'fixed' | 'quote';
  priceExGst?: number;
  propertyId?: string;
  clientId?: string;
  clientUserId?: string;
  assignedStaffId?: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  address: {
    streetAddress: string;
    unit?: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  notes?: string;
  workflow?: DocumentWorkflowData;
  status: DocumentRequestStatus;
  generatedDocumentId?: string;
  paymentId?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkOrderStatus =
  | 'triage'
  | 'quote_required'
  | 'awaiting_approval'
  | 'approved'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'report_pending'
  | 'completed'
  | 'cancelled';

export interface WorkOrder {
  id: string;
  reference: string;
  sourceType: 'tenant_request' | 'client_request' | 'booking' | 'document_request' | 'manual';
  sourceId?: string;
  propertyId: string;
  clientId?: string;
  tenancyId?: string;
  assignedStaffId?: string;
  title: string;
  description: string;
  priority: 'routine' | 'priority' | 'urgent' | 'emergency';
  status: WorkOrderStatus;
  contractorId?: string;
  quoteAmountExGst?: number;
  quoteDocumentId?: string;
  invoiceDocumentId?: string;
  approvalId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  accessNotes?: string;
  completionNotes?: string;
  completionDocumentIds: string[];
  createdBy: string;
  assignedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionAllowance {
  code: string;
  name: string;
  includedUnits: number;
  unit: 'hours' | 'jobs' | 'reports' | 'requests' | 'other';
  usedUnits?: number;
}

export interface Subscription {
  id: string;
  clientId: string;
  propertyId?: string;
  planCode: string;
  name: string;
  monthlyFeeExGst: number;
  status: 'active' | 'paused' | 'ended' | 'cancelled';
  startDate: string;
  endDate?: string;
  allowances: SubscriptionAllowance[];
  xeroContactId?: string;
  invoiceReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus =
  | 'pending'
  | 'payment_required'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'waived';

export interface PaymentRecord {
  id: string;
  reference: string;
  clientId?: string;
  propertyId?: string;
  sourceType: 'booking' | 'document_request' | 'work_order' | 'subscription' | 'other';
  sourceId: string;
  description: string;
  amountExGst: number;
  gstAmount: number;
  totalAmount: number;
  currency: 'AUD';
  status: PaymentStatus;
  provider: 'manual' | 'external' | 'xero';
  checkoutUrl?: string;
  providerOrderId?: string;
  invoiceReference?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationRecord {
  id: string;
  title: string;
  clientId?: string;
  propertyId?: string;
  tenancyId?: string;
  bookingId?: string;
  workOrderId?: string;
  recipient: string;
  channel: 'email' | 'phone' | 'sms' | 'portal' | 'internal';
  direction: 'outbound' | 'inbound' | 'internal';
  status: 'draft' | 'queued' | 'sent' | 'failed' | 'received' | 'logged';
  body: string;
  providerMessageId?: string;
  error?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditActor {
  type: 'staff' | 'client' | 'tenant' | 'system' | 'integration';
  id?: string;
  email?: string;
  displayName?: string;
}

export type AuditEntityType =
  | 'booking'
  | 'client'
  | 'client_request'
  | 'tenant_request'
  | 'approval'
  | 'client_user'
  | 'client_membership'
  | 'client_property_link'
  | 'property'
  | 'tenancy'
  | 'tenant_user'
  | 'document_request'
  | 'document'
  | 'work_order'
  | 'subscription'
  | 'payment'
  | 'communication'
  | 'service'
  | 'settings'
  | 'staff';

export interface AuditEvent {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  summary: string;
  actor: AuditActor;
  propertyId?: string;
  clientId?: string;
  tenancyId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface PlatformCollectionMap {
  clients: ClientRecord;
  clientUsers: ClientUserRecord;
  clientMemberships: ClientMembership;
  properties: PropertyRecord;
  clientPropertyLinks: ClientPropertyLink;
  tenancies: TenancyRecord;
  tenantUsers: TenantUserRecord;
  propertyDocuments: PropertyDocument;
  documentRequests: DocumentRequest;
  workOrders: WorkOrder;
  subscriptions: Subscription;
  payments: PaymentRecord;
  communications: CommunicationRecord;
}

export type PlatformResourceName = keyof PlatformCollectionMap;
