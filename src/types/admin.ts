export type AdminRole =
  | 'administrator'
  | 'operations_manager'
  | 'inspector'
  | 'read_only';

export type AdminPermission =
  | 'dashboard.read'
  | 'bookings.read'
  | 'bookings.update'
  | 'bookings.cancel'
  | 'bookings.sensitive_access'
  | 'services.read'
  | 'services.manage'
  | 'settings.read'
  | 'settings.update'
  | 'clients.read'
  | 'clients.manage'
  | 'properties.read'
  | 'properties.manage'
  | 'tenants.read'
  | 'tenants.manage'
  | 'documents.read'
  | 'documents.manage'
  | 'document_requests.read'
  | 'document_requests.manage'
  | 'maintenance.read'
  | 'maintenance.manage'
  | 'communications.read'
  | 'communications.manage'
  | 'billing.read'
  | 'billing.manage'
  | 'reports.read'
  | 'integrations.read'
  | 'integrations.manage'
  | 'users.read'
  | 'users.manage'
  | 'audit.read'
  | 'security.manage';

export interface AdminSession {
  uid: string;
  email: string;
  displayName?: string;
  role: AdminRole;
  permissions: AdminPermission[];
}

export interface AdminStaffUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  assignedServiceIds?: string[];
  permissionGrants?: AdminPermission[];
  permissionRevokes?: AdminPermission[];
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AdminResourceName =
  | 'clients'
  | 'properties'
  | 'tenants'
  | 'propertyDocuments'
  | 'documentRequests'
  | 'maintenanceRequests'
  | 'communications'
  | 'subscriptions';

export interface AdminResourceRecord {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  active?: boolean;
  clientId?: string;
  propertyId?: string;
  tenantId?: string;
  assignedStaffId?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  [key: string]: unknown;
}

export interface AdminAuditEvent {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AdminDashboardSummary {
  bookings: {
    total: number;
    today: number;
    upcoming: number;
    completed: number;
    cancelled: number;
    unassigned: number;
    accessAttention: number;
  };
  documentRequests: {
    total: number;
    outstanding: number;
  };
  maintenance: {
    total: number;
    outstanding: number;
    urgent: number;
  };
  documents: {
    total: number;
    awaitingReview: number;
  };
  clients: number;
  properties: number;
  tenants: number;
  activeStaff: number;
  alerts: Array<{
    type: string;
    label: string;
    count: number;
    resource?: string;
  }>;
}

export interface AdminReportSummary {
  generatedAt: string;
  bookingsByStatus: Record<string, number>;
  bookingsByService: Array<{ name: string; count: number }>;
  bookingsByStaff: Array<{ name: string; count: number; completed: number }>;
  documentRequestsByStatus: Record<string, number>;
  maintenanceByStatus: Record<string, number>;
  clientCount: number;
  propertyCount: number;
  activeSubscriptionCount: number;
}

export interface AdminIntegrationStatus {
  id: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'configuration_required' | 'optional';
  detail: string;
}
