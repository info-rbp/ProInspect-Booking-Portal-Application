import type {
  AdminDashboardSummary,
  AdminIntegrationStatus,
  AdminPermission,
  AdminReportSummary,
  AdminResourceName,
  AdminResourceRecord,
  AdminRole,
  AdminSession,
  AdminStaffUser,
} from '../types/admin.js';
import type { BookingRecord } from '../types/booking.js';
import type {
  AuditEntityType,
  PlatformResourceName,
  TenantUserRecord,
} from '../types/platform.js';
import { adminDb } from './firebaseAdmin.js';
import { listBookings } from './store.js';
import {
  archivePlatformResource,
  createPlatformResource,
  getPlatformResource,
  listAuditEvents as listCanonicalAuditEvents,
  listPlatformResources,
  updatePlatformResource,
  writeAuditEvent,
} from './platformStore.js';

const ALL_PERMISSIONS: AdminPermission[] = [
  'dashboard.read',
  'bookings.read',
  'bookings.update',
  'bookings.cancel',
  'bookings.sensitive_access',
  'services.read',
  'services.manage',
  'settings.read',
  'settings.update',
  'clients.read',
  'clients.manage',
  'properties.read',
  'properties.manage',
  'tenants.read',
  'tenants.manage',
  'documents.read',
  'documents.manage',
  'document_requests.read',
  'document_requests.manage',
  'maintenance.read',
  'maintenance.manage',
  'communications.read',
  'communications.manage',
  'billing.read',
  'billing.manage',
  'reports.read',
  'integrations.read',
  'integrations.manage',
  'users.read',
  'users.manage',
  'audit.read',
  'security.manage',
];

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  administrator: ALL_PERMISSIONS,
  operations_manager: ALL_PERMISSIONS.filter(
    (permission) => !['users.manage', 'security.manage'].includes(permission)
  ),
  inspector: [
    'dashboard.read',
    'bookings.read',
    'bookings.update',
    'bookings.sensitive_access',
    'services.read',
    'settings.read',
    'clients.read',
    'properties.read',
    'tenants.read',
    'documents.read',
    'document_requests.read',
    'maintenance.read',
    'maintenance.manage',
    'communications.read',
    'communications.manage',
  ],
  read_only: [
    'dashboard.read',
    'bookings.read',
    'services.read',
    'settings.read',
    'clients.read',
    'properties.read',
    'tenants.read',
    'documents.read',
    'document_requests.read',
    'maintenance.read',
    'communications.read',
    'billing.read',
    'reports.read',
    'integrations.read',
    'users.read',
    'audit.read',
  ],
};

export const ADMIN_RESOURCE_CONFIG: Record<
  AdminResourceName,
  {
    collection: PlatformResourceName;
    read: AdminPermission;
    manage: AdminPermission;
    label: string;
    entityType: AuditEntityType;
  }
> = {
  clients: {
    collection: 'clients',
    read: 'clients.read',
    manage: 'clients.manage',
    label: 'Client',
    entityType: 'client',
  },
  clientUsers: {
    collection: 'clientUsers',
    read: 'clients.read',
    manage: 'clients.manage',
    label: 'Client user',
    entityType: 'client_user',
  },
  clientMemberships: {
    collection: 'clientMemberships',
    read: 'clients.read',
    manage: 'clients.manage',
    label: 'Client membership',
    entityType: 'client_membership',
  },
  properties: {
    collection: 'properties',
    read: 'properties.read',
    manage: 'properties.manage',
    label: 'Property',
    entityType: 'property',
  },
  clientPropertyLinks: {
    collection: 'clientPropertyLinks',
    read: 'properties.read',
    manage: 'properties.manage',
    label: 'Client-property relationship',
    entityType: 'client_property_link',
  },
  tenancies: {
    collection: 'tenancies',
    read: 'tenants.read',
    manage: 'tenants.manage',
    label: 'Tenancy',
    entityType: 'tenancy',
  },
  tenantUsers: {
    collection: 'tenantUsers',
    read: 'tenants.read',
    manage: 'tenants.manage',
    label: 'Tenant user',
    entityType: 'tenant_user',
  },
  propertyDocuments: {
    collection: 'propertyDocuments',
    read: 'documents.read',
    manage: 'documents.manage',
    label: 'Document',
    entityType: 'document',
  },
  documentRequests: {
    collection: 'documentRequests',
    read: 'document_requests.read',
    manage: 'document_requests.manage',
    label: 'Document request',
    entityType: 'document_request',
  },
  workOrders: {
    collection: 'workOrders',
    read: 'maintenance.read',
    manage: 'maintenance.manage',
    label: 'Work order',
    entityType: 'work_order',
  },
  subscriptions: {
    collection: 'subscriptions',
    read: 'billing.read',
    manage: 'billing.manage',
    label: 'Subscription',
    entityType: 'subscription',
  },
  payments: {
    collection: 'payments',
    read: 'billing.read',
    manage: 'billing.manage',
    label: 'Payment',
    entityType: 'payment',
  },
  communications: {
    collection: 'communications',
    read: 'communications.read',
    manage: 'communications.manage',
    label: 'Communication',
    entityType: 'communication',
  },
};

function uniquePermissions(values: AdminPermission[]): AdminPermission[] {
  return [...new Set(values)];
}

export function permissionsForRole(
  role: AdminRole,
  grants: AdminPermission[] = [],
  revokes: AdminPermission[] = []
): AdminPermission[] {
  const revoked = new Set(revokes);
  return uniquePermissions([...ROLE_PERMISSIONS[role], ...grants]).filter(
    (permission) => !revoked.has(permission)
  );
}

function normaliseRole(value: unknown): AdminRole {
  return value === 'operations_manager' ||
    value === 'inspector' ||
    value === 'read_only' ||
    value === 'administrator'
    ? value
    : 'read_only';
}

function normaliseScope(value: unknown, role: AdminRole): 'global' | 'assigned' {
  if (role === 'administrator' || role === 'operations_manager' || role === 'read_only') {
    return 'global';
  }
  return value === 'global' ? 'global' : 'assigned';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean)))
    : [];
}

export async function resolveAdminSession(input: {
  uid: string;
  email: string;
  implicitAdministrator?: boolean;
}): Promise<AdminSession | null> {
  let snapshot = await adminDb.collection('adminUsers').doc(input.uid).get();
  let data = snapshot.exists ? snapshot.data() || {} : {};

  if (!snapshot.exists && !input.implicitAdministrator) {
    const emailMatch = await adminDb
      .collection('adminUsers')
      .where('email', '==', input.email.trim().toLowerCase())
      .limit(1)
      .get();

    if (!emailMatch.empty) {
      const invited = emailMatch.docs[0];
      data = invited.data() || {};
      if (data.active !== false) {
        const now = new Date().toISOString();
        await adminDb.collection('adminUsers').doc(input.uid).set(
          {
            ...data,
            email: input.email.trim().toLowerCase(),
            boundAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
        if (invited.id !== input.uid) {
          const [bookingAssignments, workOrderAssignments] = await Promise.all([
            adminDb.collection('bookings').where('assignedStaffId', '==', invited.id).get(),
            adminDb.collection('workOrders').where('assignedStaffId', '==', invited.id).get(),
          ]);
          const batch = adminDb.batch();
          bookingAssignments.docs.forEach((doc) =>
            batch.set(doc.ref, { assignedStaffId: input.uid, updatedAt: now }, { merge: true })
          );
          workOrderAssignments.docs.forEach((doc) =>
            batch.set(doc.ref, { assignedStaffId: input.uid, updatedAt: now }, { merge: true })
          );
          batch.delete(invited.ref);
          await batch.commit();
        }
        snapshot = await adminDb.collection('adminUsers').doc(input.uid).get();
        data = snapshot.data() || data;
      }
    }
  }

  if (!input.implicitAdministrator) {
    if (!snapshot.exists || data.active === false) return null;
    if (
      data.email &&
      String(data.email).trim().toLowerCase() !== input.email.trim().toLowerCase()
    ) {
      return null;
    }
  }

  const role: AdminRole = input.implicitAdministrator
    ? 'administrator'
    : normaliseRole(data.role || 'read_only');
  const permissionGrants = strings(data.permissionGrants).filter((value) =>
    ALL_PERMISSIONS.includes(value as AdminPermission)
  ) as AdminPermission[];
  const permissionRevokes = strings(data.permissionRevokes).filter((value) =>
    ALL_PERMISSIONS.includes(value as AdminPermission)
  ) as AdminPermission[];

  const now = new Date().toISOString();
  if (snapshot.exists) {
    await snapshot.ref.set({ lastLoginAt: now, updatedAt: now }, { merge: true });
  }

  return {
    uid: input.uid,
    email: input.email,
    displayName: data.displayName ? String(data.displayName) : undefined,
    role,
    permissions: permissionsForRole(role, permissionGrants, permissionRevokes),
    resourceScope: input.implicitAdministrator ? 'global' : normaliseScope(data.resourceScope, role),
    assignedServiceIds: strings(data.assignedServiceIds),
    assignedPropertyIds: strings(data.assignedPropertyIds),
    assignedClientIds: strings(data.assignedClientIds),
  };
}

export function hasAdminPermission(
  session: AdminSession | undefined,
  permission: AdminPermission
): boolean {
  return Boolean(session?.permissions.includes(permission));
}

function intersects(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

async function tenantUserMatchesScope(
  user: TenantUserRecord,
  session: AdminSession
): Promise<boolean> {
  if (!user.tenancyIds.length) return false;
  const refs = user.tenancyIds.map((id) => adminDb.collection('tenancies').doc(id));
  const snapshots = await adminDb.getAll(...refs);
  return snapshots.some((doc) => {
    if (!doc.exists) return false;
    const data = doc.data() || {};
    return session.assignedPropertyIds.includes(String(data.propertyId || '')) ||
      session.assignedClientIds.includes(String(data.clientId || ''));
  });
}

async function recordMatchesScope(
  resource: AdminResourceName,
  record: AdminResourceRecord,
  session: AdminSession
): Promise<boolean> {
  if (session.resourceScope === 'global') return true;

  if (resource === 'clients') return session.assignedClientIds.includes(record.id);
  if (resource === 'properties') return session.assignedPropertyIds.includes(record.id);

  const clientId = typeof record.clientId === 'string' ? record.clientId : undefined;
  const propertyId = typeof record.propertyId === 'string' ? record.propertyId : undefined;
  const assignedStaffId =
    typeof record.assignedStaffId === 'string' ? record.assignedStaffId : undefined;

  if (assignedStaffId === session.uid) return true;
  if (clientId && session.assignedClientIds.includes(clientId)) return true;
  if (propertyId && session.assignedPropertyIds.includes(propertyId)) return true;

  if (resource === 'clientUsers') {
    const clientIds = Array.isArray(record.clientIds) ? record.clientIds.map(String) : [];
    return intersects(clientIds, session.assignedClientIds);
  }

  if (resource === 'clientMemberships') {
    return session.assignedClientIds.includes(String(record.clientId || ''));
  }

  if (resource === 'clientPropertyLinks') {
    return session.assignedClientIds.includes(String(record.clientId || '')) ||
      session.assignedPropertyIds.includes(String(record.propertyId || ''));
  }

  if (resource === 'tenantUsers') {
    return tenantUserMatchesScope(record as unknown as TenantUserRecord, session);
  }

  if (resource === 'propertyDocuments') {
    const clientIds = Array.isArray(record.clientIds) ? record.clientIds.map(String) : [];
    return intersects(clientIds, session.assignedClientIds);
  }

  return false;
}

export function bookingMatchesScope(
  booking: BookingRecord,
  session: AdminSession
): boolean {
  if (session.resourceScope === 'global') return true;
  if (booking.assignedStaffId === session.uid) return true;
  if (booking.propertyId && session.assignedPropertyIds.includes(booking.propertyId)) return true;
  if (booking.clientId && session.assignedClientIds.includes(booking.clientId)) return true;
  return false;
}

export function canUpdateBookingForSession(
  booking: BookingRecord,
  session: AdminSession
): boolean {
  if (session.resourceScope === 'global') return true;
  return booking.assignedStaffId === session.uid;
}

export function filterBookingsForSession(
  bookings: BookingRecord[],
  session: AdminSession
): BookingRecord[] {
  return bookings.filter((booking) => bookingMatchesScope(booking, session));
}

function auditMetadata(
  metadata?: Record<string, unknown>
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

function auditEntityType(resourceType: string): AuditEntityType {
  const mapping: Record<string, AuditEntityType> = {
    booking: 'booking',
    service: 'service',
    settings: 'settings',
    staff: 'staff',
    clients: 'client',
    clientUsers: 'client_user',
    clientMemberships: 'client_membership',
    clientPropertyLinks: 'client_property_link',
    properties: 'property',
    tenancies: 'tenancy',
    tenantUsers: 'tenant_user',
    propertyDocuments: 'document',
    documentRequests: 'document_request',
    workOrders: 'work_order',
    subscriptions: 'subscription',
    payments: 'payment',
    communications: 'communication',
  };
  return mapping[resourceType] || 'staff';
}

export async function recordAuditEvent(input: {
  session: Pick<AdminSession, 'uid' | 'email' | 'displayName'>;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  propertyId?: string;
  clientId?: string;
  tenancyId?: string;
}): Promise<void> {
  await writeAuditEvent({
    entityType: auditEntityType(input.resourceType),
    entityId: input.resourceId || input.resourceType,
    action: input.action,
    summary: input.summary || input.action,
    actor: {
      type: 'staff',
      id: input.session.uid,
      email: input.session.email,
      displayName: input.session.displayName,
    },
    propertyId: input.propertyId,
    clientId: input.clientId,
    tenancyId: input.tenancyId,
    metadata: auditMetadata(input.metadata),
  });
}

export async function listAuditEvents(limit = 250) {
  return listCanonicalAuditEvents(limit);
}

export async function listAdminResource(
  resource: AdminResourceName,
  session: AdminSession,
  limit = 500
): Promise<AdminResourceRecord[]> {
  const records = await listPlatformResources(resource, limit);
  const scoped = await Promise.all(
    records.map(async (record) => ({
      record: record as unknown as AdminResourceRecord,
      allowed: await recordMatchesScope(
        resource,
        record as unknown as AdminResourceRecord,
        session
      ),
    }))
  );
  return scoped.filter((item) => item.allowed).map((item) => item.record);
}

export async function createAdminResource(
  resource: AdminResourceName,
  payload: Record<string, unknown>,
  session: AdminSession
): Promise<AdminResourceRecord> {
  if (session.resourceScope !== 'global') {
    const candidate = { id: 'new', ...payload } as AdminResourceRecord;
    if (!(await recordMatchesScope(resource, candidate, session))) {
      throw new Error('RESOURCE_SCOPE_FORBIDDEN');
    }
  }
  return createPlatformResource(resource, payload, session.email) as Promise<AdminResourceRecord>;
}

export async function updateAdminResource(
  resource: AdminResourceName,
  id: string,
  payload: Record<string, unknown>,
  session: AdminSession
): Promise<AdminResourceRecord | null> {
  const existing = await getPlatformResource(resource, id);
  if (!existing) return null;
  if (
    !(await recordMatchesScope(
      resource,
      existing as unknown as AdminResourceRecord,
      session
    ))
  ) {
    throw new Error('RESOURCE_SCOPE_FORBIDDEN');
  }
  return updatePlatformResource(resource, id, payload, session.email) as Promise<AdminResourceRecord | null>;
}

export async function archiveAdminResource(
  resource: AdminResourceName,
  id: string,
  session: AdminSession
): Promise<AdminResourceRecord | null> {
  const existing = await getPlatformResource(resource, id);
  if (!existing) return null;
  if (
    !(await recordMatchesScope(
      resource,
      existing as unknown as AdminResourceRecord,
      session
    ))
  ) {
    throw new Error('RESOURCE_SCOPE_FORBIDDEN');
  }
  return archivePlatformResource(resource, id, session.email) as Promise<AdminResourceRecord | null>;
}

export async function listAdminStaff(): Promise<AdminStaffUser[]> {
  const snapshot = await adminDb.collection('adminUsers').limit(250).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const role = normaliseRole(data.role || 'read_only');
    return {
      id: doc.id,
      email: String(data.email || ''),
      displayName: String(data.displayName || data.email || 'Staff member'),
      role,
      active: data.active !== false,
      assignedServiceIds: strings(data.assignedServiceIds),
      assignedPropertyIds: strings(data.assignedPropertyIds),
      assignedClientIds: strings(data.assignedClientIds),
      resourceScope: normaliseScope(data.resourceScope, role),
      permissionGrants: strings(data.permissionGrants) as AdminPermission[],
      permissionRevokes: strings(data.permissionRevokes) as AdminPermission[],
      lastLoginAt: data.lastLoginAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as AdminStaffUser;
  });
}

export async function createAdminStaff(input: {
  email: string;
  displayName: string;
  role: AdminRole;
  assignedServiceIds?: string[];
  assignedPropertyIds?: string[];
  assignedClientIds?: string[];
}): Promise<AdminStaffUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await adminDb
    .collection('adminUsers')
    .where('email', '==', email)
    .limit(1)
    .get();

  const ref = existing.empty
    ? adminDb.collection('adminUsers').doc()
    : existing.docs[0].ref;
  const now = new Date().toISOString();
  const existingData = existing.empty ? {} : existing.docs[0].data();
  const resourceScope = normaliseScope(existingData.resourceScope, input.role);

  const record: Omit<AdminStaffUser, 'id'> = {
    email,
    displayName: input.displayName.trim() || email,
    role: input.role,
    active: true,
    assignedServiceIds: input.assignedServiceIds || [],
    assignedPropertyIds: input.assignedPropertyIds || [],
    assignedClientIds: input.assignedClientIds || [],
    resourceScope,
    permissionGrants: Array.isArray(existingData.permissionGrants)
      ? existingData.permissionGrants
      : [],
    permissionRevokes: Array.isArray(existingData.permissionRevokes)
      ? existingData.permissionRevokes
      : [],
    createdAt: existingData.createdAt || now,
    updatedAt: now,
  };
  await ref.set(record, { merge: true });
  return { id: ref.id, ...record };
}

export async function updateAdminStaff(
  uid: string,
  input: Partial<Pick<
    AdminStaffUser,
    | 'displayName'
    | 'role'
    | 'active'
    | 'assignedServiceIds'
    | 'assignedPropertyIds'
    | 'assignedClientIds'
    | 'resourceScope'
    | 'permissionGrants'
    | 'permissionRevokes'
  >>
): Promise<AdminStaffUser | null> {
  const ref = adminDb.collection('adminUsers').doc(uid);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const current = existing.data() || {};
  const nextRole = input.role ? normaliseRole(input.role) : normaliseRole(current.role);
  const safe: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.displayName !== undefined) safe.displayName = input.displayName;
  if (input.role !== undefined) safe.role = nextRole;
  if (input.active !== undefined) safe.active = Boolean(input.active);
  if (input.assignedServiceIds !== undefined) safe.assignedServiceIds = input.assignedServiceIds;
  if (input.assignedPropertyIds !== undefined) safe.assignedPropertyIds = input.assignedPropertyIds;
  if (input.assignedClientIds !== undefined) safe.assignedClientIds = input.assignedClientIds;
  if (input.resourceScope !== undefined || input.role !== undefined) {
    safe.resourceScope = normaliseScope(input.resourceScope ?? current.resourceScope, nextRole);
  }
  if (input.permissionGrants !== undefined) safe.permissionGrants = input.permissionGrants;
  if (input.permissionRevokes !== undefined) safe.permissionRevokes = input.permissionRevokes;

  await ref.set(safe, { merge: true });
  const updated = await ref.get();
  const data = updated.data() || {};
  const role = normaliseRole(data.role);
  return {
    id: uid,
    email: String(data.email || ''),
    displayName: String(data.displayName || data.email || 'Staff member'),
    role,
    active: data.active !== false,
    assignedServiceIds: strings(data.assignedServiceIds),
    assignedPropertyIds: strings(data.assignedPropertyIds),
    assignedClientIds: strings(data.assignedClientIds),
    resourceScope: normaliseScope(data.resourceScope, role),
    permissionGrants: strings(data.permissionGrants) as AdminPermission[],
    permissionRevokes: strings(data.permissionRevokes) as AdminPermission[],
    lastLoginAt: data.lastLoginAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function isOutstandingStatus(status: unknown): boolean {
  return !['completed', 'cancelled', 'closed', 'delivered', 'issued', 'archived', 'ended'].includes(
    String(status || '').toLowerCase()
  );
}

export async function getAdminDashboard(
  session: AdminSession
): Promise<AdminDashboardSummary> {
  const allBookings = await listBookings();
  const bookings = filterBookingsForSession(allBookings, session);
  const [requests, workOrders, documents, clients, properties, tenancies, staff] =
    await Promise.all([
      listAdminResource('documentRequests', session),
      listAdminResource('workOrders', session),
      listAdminResource('propertyDocuments', session),
      listAdminResource('clients', session),
      listAdminResource('properties', session),
      listAdminResource('tenancies', session),
      listAdminStaff(),
    ]);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const upcoming = bookings.filter(
    (booking) => booking.appointment.dateKey >= today && booking.status === 'confirmed'
  );
  const outstandingRequests = requests.filter((item) => isOutstandingStatus(item.status));
  const outstandingWorkOrders = workOrders.filter((item) => isOutstandingStatus(item.status));
  const urgentWorkOrders = outstandingWorkOrders.filter((item) =>
    ['urgent', 'emergency'].includes(String(item.priority || '').toLowerCase())
  );
  const awaitingReview = documents.filter((item) =>
    ['draft', 'generated', 'review'].includes(String(item.status || '').toLowerCase())
  );

  const alerts = [
    {
      type: 'unassigned',
      label: 'Unassigned upcoming bookings',
      count: upcoming.filter((booking) => !booking.assignedStaffId).length,
      resource: 'bookings',
    },
    {
      type: 'access',
      label: 'Bookings requiring access action',
      count: bookings.filter((booking) => booking.readinessStatus !== 'ready').length,
      resource: 'bookings',
    },
    {
      type: 'documents',
      label: 'Documents awaiting review',
      count: awaitingReview.length,
      resource: 'propertyDocuments',
    },
    {
      type: 'maintenance',
      label: 'Urgent work orders',
      count: urgentWorkOrders.length,
      resource: 'workOrders',
    },
  ].filter((alert) => alert.count > 0);

  return {
    bookings: {
      total: bookings.length,
      today: bookings.filter(
        (booking) => booking.appointment.dateKey === today && booking.status !== 'cancelled'
      ).length,
      upcoming: upcoming.length,
      completed: bookings.filter((booking) => booking.status === 'completed').length,
      cancelled: bookings.filter((booking) => booking.status === 'cancelled').length,
      unassigned: upcoming.filter((booking) => !booking.assignedStaffId).length,
      accessAttention: bookings.filter((booking) => booking.readinessStatus !== 'ready').length,
    },
    documentRequests: {
      total: requests.length,
      outstanding: outstandingRequests.length,
    },
    maintenance: {
      total: workOrders.length,
      outstanding: outstandingWorkOrders.length,
      urgent: urgentWorkOrders.length,
      workOrders: workOrders.length,
    },
    documents: {
      total: documents.length,
      awaitingReview: awaitingReview.length,
    },
    clients: clients.length,
    properties: properties.length,
    tenants: tenancies.length,
    activeStaff: staff.filter((member) => member.active).length,
    alerts,
  };
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    const name = key(value) || 'Unspecified';
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
}

export async function getAdminReportSummary(
  session: AdminSession
): Promise<AdminReportSummary> {
  const bookings = filterBookingsForSession(await listBookings(), session);
  const [requests, workOrders, clients, properties, subscriptions, staff] =
    await Promise.all([
      listAdminResource('documentRequests', session),
      listAdminResource('workOrders', session),
      listAdminResource('clients', session),
      listAdminResource('properties', session),
      listAdminResource('subscriptions', session),
      listAdminStaff(),
    ]);

  const staffName = new Map(staff.map((member) => [member.id, member.displayName]));
  const byStaff = new Map<string, { name: string; count: number; completed: number }>();
  for (const booking of bookings) {
    const id = booking.assignedStaffId || 'unassigned';
    const current = byStaff.get(id) || {
      name: id === 'unassigned' ? 'Unassigned' : staffName.get(id) || id,
      count: 0,
      completed: 0,
    };
    current.count += 1;
    if (booking.status === 'completed') current.completed += 1;
    byStaff.set(id, current);
  }

  return {
    generatedAt: new Date().toISOString(),
    bookingsByStatus: countBy(bookings, (booking) => booking.status),
    bookingsByService: Object.entries(countBy(bookings, (booking) => booking.serviceName))
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    bookingsByStaff: [...byStaff.values()].sort((a, b) => b.count - a.count),
    documentRequestsByStatus: countBy(
      requests,
      (request) => String(request.status || 'submitted')
    ),
    maintenanceByStatus: countBy(
      workOrders,
      (request) => String(request.status || 'triage')
    ),
    clientCount: clients.length,
    propertyCount: properties.length,
    activeSubscriptionCount: subscriptions.filter(
      (subscription) => !['cancelled', 'ended'].includes(String(subscription.status || '').toLowerCase())
    ).length,
  };
}

export function getAdminIntegrationStatuses(): AdminIntegrationStatus[] {
  const calendarConfigured = Boolean(
    process.env.GOOGLE_CALENDAR_ID &&
      (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
  const emailConfigured = Boolean(
    process.env.BREVO_API_KEY ||
      (process.env.SMTP_HOST && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD)
  );
  const firebaseConfigured = Boolean(
    process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID
  );

  return [
    {
      id: 'firebase',
      name: 'Firebase / Firestore',
      configured: firebaseConfigured,
      status: firebaseConfigured ? 'connected' : 'configuration_required',
      detail: 'Authentication and canonical operational data store.',
    },
    {
      id: 'google-calendar',
      name: 'Google Calendar',
      configured: calendarConfigured,
      status: calendarConfigured ? 'connected' : 'configuration_required',
      detail: 'Availability, appointments and calendar event synchronisation.',
    },
    {
      id: 'email',
      name: 'Email delivery',
      configured: emailConfigured,
      status: emailConfigured ? 'connected' : 'configuration_required',
      detail: 'Booking, document and operational notifications.',
    },
    {
      id: 'google-sheets',
      name: 'Google Sheets export',
      configured: Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
      status: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? 'connected' : 'optional',
      detail: 'Optional operational spreadsheet synchronisation.',
    },
    {
      id: 'xero',
      name: 'Xero',
      configured: Boolean(process.env.XERO_CLIENT_ID),
      status: process.env.XERO_CLIENT_ID ? 'connected' : 'optional',
      detail: 'Optional accounting integration for invoices and payments.',
    },
  ];
}
