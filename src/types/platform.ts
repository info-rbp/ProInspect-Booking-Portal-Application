import type { ServiceCategory } from './booking';
import type { DocumentWorkflowData } from './documentRequest';
import type {
  ClientPropertyRole,
  ClientRecord,
  ClientUserRecord,
  PortalAudience,
  TenantDocumentCategory,
  TenantInspection,
  TenantProperty,
} from './tenant';

export type ClientMembershipRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface ClientMembership {
  clientId: string;
  role: ClientMembershipRole;
  status: 'active' | 'invited' | 'revoked';
}

export type ClientRequestType = 'maintenance' | 'document' | 'general';
export type ClientRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'awaiting_client'
  | 'approved'
  | 'in_progress'
  | 'report_pending'
  | 'completed'
  | 'cancelled';

export interface ClientRequest {
  id: string;
  reference: string;
  clientUserId: string;
  clientId: string;
  propertyId?: string;
  type: ClientRequestType;
  title: string;
  details: string;
  priority: 'routine' | 'priority' | 'urgent';
  status: ClientRequestStatus;
  payload: Record<string, string | number | boolean | null>;
  attachmentDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentProduct {
  id: string;
  name: string;
  publicDescription: string;
  categories: ServiceCategory[];
  pricingMode: 'fixed' | 'quote';
  priceExGst?: number;
  active: boolean;
  publiclyRequestable: boolean;
  order: number;
  formCode?: string;
  badge?: string;
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
  | 'completed'
  | 'cancelled';

export interface Contractor {
  id: string;
  name: string;
  trade?: string;
  email?: string;
  phone?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

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

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'approved_with_conditions'
  | 'changes_requested'
  | 'declined';

export interface ClientApproval {
  id: string;
  reference: string;
  clientId: string;
  propertyId?: string;
  clientUserId?: string;
  workOrderId?: string;
  documentId?: string;
  requestId?: string;
  type: 'quote' | 'document' | 'instruction' | 'other';
  title: string;
  summary?: string;
  amountExGst?: number;
  status: ApprovalStatus;
  responseComment?: string;
  requestedBy: string;
  requestedAt: string;
  respondedBy?: string;
  respondedAt?: string;
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
  invoiceReference?: string;
  checkoutUrl?: string;
  providerOrderId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditActor {
  type: 'staff' | 'client' | 'tenant' | 'system' | 'integration';
  id?: string;
  email?: string;
  displayName?: string;
}

export interface AuditEvent {
  id: string;
  entityType:
    | 'booking'
    | 'tenant_request'
    | 'client_request'
    | 'document_request'
    | 'work_order'
    | 'approval'
    | 'document'
    | 'property'
    | 'tenancy'
    | 'payment'
    | 'client';
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

export interface PortalNotification {
  id: string;
  audience: 'client' | 'tenant' | 'staff';
  clientUserId?: string;
  tenantUserId?: string;
  clientId?: string;
  propertyId?: string;
  tenancyId?: string;
  title: string;
  message: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface OperationsQueueItem {
  id: string;
  source:
    | 'booking'
    | 'tenant_request'
    | 'client_request'
    | 'document_request'
    | 'work_order'
    | 'approval';
  reference: string;
  title: string;
  propertyId?: string;
  propertyLabel?: string;
  clientId?: string;
  clientName?: string;
  priority: 'normal' | 'priority' | 'urgent' | 'emergency';
  status: string;
  assignedTo?: string;
  dueAt?: string;
  updatedAt: string;
}

export interface UnifiedClientDashboard {
  clientUser: Pick<ClientUserRecord, 'id' | 'email' | 'displayName' | 'phone'> & {
    memberships: ClientMembership[];
  };
  clients: ClientRecord[];
  properties: TenantProperty[];
  propertyLinks: Array<{
    id: string;
    clientId: string;
    propertyId: string;
    role: ClientPropertyRole;
    primary: boolean;
    active: boolean;
  }>;
  bookings: Array<{
    id: string;
    bookingReference: string;
    propertyId?: string;
    serviceName: string;
    status: string;
    appointment: {
      start: string;
      end: string;
      dateString: string;
      timeString: string;
    };
    property: {
      streetAddress: string;
      unit?: string;
      suburb: string;
      state: string;
      postcode: string;
    };
  }>;
  requests: ClientRequest[];
  workOrders: Array<Pick<WorkOrder,
    'id' | 'reference' | 'propertyId' | 'clientId' | 'tenancyId' | 'title' | 'description' |
    'priority' | 'status' | 'quoteAmountExGst' | 'approvalId' | 'scheduledStart' |
    'scheduledEnd' | 'completionNotes' | 'completedAt' | 'createdAt' | 'updatedAt'
  >>;
  inspections: Array<Pick<TenantInspection,
    'id' | 'tenancyId' | 'propertyId' | 'type' | 'status' | 'scheduledStart' |
    'scheduledEnd' | 'noticeDocumentId' | 'createdAt' | 'updatedAt'
  >>;
  documentRequests: DocumentRequest[];
  documents: Array<{
    id: string;
    propertyId: string;
    clientIds: string[];
    audiences: PortalAudience[];
    title: string;
    category: TenantDocumentCategory;
    fileName: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    uploadedBy: string;
  }>;
  approvals: ClientApproval[];
  payments: PaymentRecord[];
  notifications: PortalNotification[];
  teamUsers: Array<Pick<ClientUserRecord, 'id' | 'email' | 'displayName' | 'phone' | 'active'> & {
    clientRoles: Record<string, 'owner' | 'admin' | 'member' | 'viewer'>;
  }>;
}

export interface ReportIngestMetadata {
  propertyId: string;
  title: string;
  category: 'property_condition_report' | 'inspection_report' | 'property_report';
  fileName: string;
  contentType: string;
  clientIds?: string[];
  tenancyId?: string;
  bookingId?: string;
  audiences?: PortalAudience[];
}
