import type {
  AdminAuditEvent,
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
import type { DocumentRequestRecord } from '../types/documentRequest.js';
import { adminDb } from './firebaseAdmin.js';
import { listBookings } from './store.js';

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
    collection: string;
    read: AdminPermission;
    manage: AdminPermission;
    label: string;
  }
> = {
  clients: {
    collection: 'clients',
    read: 'clients.read',
    manage: 'clients.manage',
    label: 'Client',
  },
  properties: {
    collection: 'properties',
    read: 'properties.read',
    manage: 'properties.manage',
    label: 'Property',
  },
  tenants: {
    collection: 'tenants',
    read: 'tenants.read',
    manage: 'tenants.manage',
    label: 'Tenant',
  },
  propertyDocuments: {
    collection: 'propertyDocuments',
    read: 'documents.read',
    manage: 'documents.manage',
    label: 'Document',
  },
  documentRequests: {
    collection: 'documentRequests',
    read: 'document_requests.read',
    manage: 'document_requests.manage',
    label: 'Document request',
  },
  maintenanceRequests: {
    collection: 'maintenanceRequests',
    read: 'maintenance.read',
    manage: 'maintenance.manage',
    label: 'Maintenance request',
  },
  communications: {
    collection: 'communications',
    read: 'communications.read',
    manage: 'communications.manage',
    label: 'Communication',
  },
  subscriptions: {
    collection: 'subscriptions',
    read: 'billing.read',
    manage: 'billing.manage',
    label: 'Subscription',
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
          await invited.ref.delete();
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
  const permissionGrants = Array.isArray(data.permissionGrants)
    ? (data.permissionGrants.filter((value: unknown) =>
        ALL_PERMISSIONS.includes(value as AdminPermission)
      ) as AdminPermission[])
    : [];
  const permissionRevokes = Array.isArray(data.permissionRevokes)
    ? (data.permissionRevokes.filter((value: unknown) =>
        ALL_PERMISSIONS.includes(value as AdminPermission)
      ) as AdminPermission[])
    : [];

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
  };
}

export function hasAdminPermission(
  session: AdminSession | undefined,
  permission: AdminPermission
): boolean {
  return Boolean(session?.permissions.includes(permission));
}

export async function recordAuditEvent(input: {
  session: Pick<AdminSession, 'uid' | 'email'>;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const ref = adminDb.collection('auditEvents').doc();
  const event: Omit<AdminAuditEvent, 'id'> = {
    actorUid: input.session.uid,
    actorEmail: input.session.email,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: new Date().toISOString(),
  };
  await ref.set(event);
}

export async function listAuditEvents(limit = 250): Promise<AdminAuditEvent[]> {
  const snapshot = await adminDb
    .collection('auditEvents')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 500))
    .get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<AdminAuditEvent, 'id'>),
  }));
}

export async function listAdminResource(
  resource: AdminResourceName,
  limit = 500
): Promise<AdminResourceRecord[]> {
  const config = ADMIN_RESOURCE_CONFIG[resource];
  const snapshot = await adminDb
    .collection(config.collection)
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 500))
    .get()
    .catch(async () =>
      adminDb.collection(config.collection).limit(Math.min(Math.max(limit, 1), 500)).get()
    );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<AdminResourceRecord, 'id'>),
  }));
}

export async function createAdminResource(
  resource: AdminResourceName,
  payload: Record<string, unknown>
): Promise<AdminResourceRecord> {
  const config = ADMIN_RESOURCE_CONFIG[resource];
  const ref = adminDb.collection(config.collection).doc();
  const now = new Date().toISOString();
  const record = {
    ...payload,
    createdAt: now,
    updatedAt: now,
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
  await ref.set(record);
  return { id: ref.id, ...record };
}

export async function updateAdminResource(
  resource: AdminResourceName,
  id: string,
  payload: Record<string, unknown>
): Promise<AdminResourceRecord | null> {
  const config = ADMIN_RESOURCE_CONFIG[resource];
  const ref = adminDb.collection(config.collection).doc(id);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const changes = {
    ...payload,
    id: undefined,
    createdAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  await ref.set(changes, { merge: true });
  const updated = await ref.get();
  return { id: updated.id, ...(updated.data() as Omit<AdminResourceRecord, 'id'>) };
}

export async function archiveAdminResource(
  resource: AdminResourceName,
  id: string
): Promise<AdminResourceRecord | null> {
  return updateAdminResource(resource, id, {
    active: false,
    archivedAt: new Date().toISOString(),
  });
}

export async function listAdminStaff(): Promise<AdminStaffUser[]> {
  const snapshot = await adminDb.collection('adminUsers').limit(250).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      email: String(data.email || ''),
      displayName: String(data.displayName || data.email || 'Staff member'),
      role: normaliseRole(data.role || 'read_only'),
      active: data.active !== false,
      assignedServiceIds: Array.isArray(data.assignedServiceIds)
        ? data.assignedServiceIds.map(String)
        : [],
      permissionGrants: Array.isArray(data.permissionGrants)
        ? data.permissionGrants
        : [],
      permissionRevokes: Array.isArray(data.permissionRevokes)
        ? data.permissionRevokes
        : [],
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

  const record: Omit<AdminStaffUser, 'id'> = {
    email,
    displayName: input.displayName.trim() || email,
    role: input.role,
    active: true,
    assignedServiceIds: input.assignedServiceIds || [],
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
    | 'permissionGrants'
    | 'permissionRevokes'
  >>
): Promise<AdminStaffUser | null> {
  const ref = adminDb.collection('adminUsers').doc(uid);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const safe: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.displayName !== undefined) safe.displayName = input.displayName;
  if (input.role !== undefined) safe.role = normaliseRole(input.role);
  if (input.active !== undefined) safe.active = Boolean(input.active);
  if (input.assignedServiceIds !== undefined) safe.assignedServiceIds = input.assignedServiceIds;
  if (input.permissionGrants !== undefined) safe.permissionGrants = input.permissionGrants;
  if (input.permissionRevokes !== undefined) safe.permissionRevokes = input.permissionRevokes;

  await ref.set(safe, { merge: true });

  const updated = await ref.get();
  const data = updated.data() || {};
  return {
    id: uid,
    email: String(data.email || ''),
    displayName: String(data.displayName || data.email || 'Staff member'),
    role: normaliseRole(data.role),
    active: data.active !== false,
    assignedServiceIds: Array.isArray(data.assignedServiceIds) ? data.assignedServiceIds : [],
    permissionGrants: Array.isArray(data.permissionGrants) ? data.permissionGrants : [],
    permissionRevokes: Array.isArray(data.permissionRevokes) ? data.permissionRevokes : [],
    lastLoginAt: data.lastLoginAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

async function countCollection(collection: string): Promise<number> {
  const snapshot = await adminDb.collection(collection).count().get();
  return snapshot.data().count;
}

function isOutstandingStatus(status: unknown): boolean {
  return !['completed', 'cancelled', 'closed', 'delivered', 'issued'].includes(
    String(status || '').toLowerCase()
  );
}

export async function getAdminDashboard(): Promise<AdminDashboardSummary> {
  const [bookings, requests, maintenance, documents, staff, clients, properties, tenants] =
    await Promise.all([
      listBookings(),
      listAdminResource('documentRequests'),
      listAdminResource('maintenanceRequests'),
      listAdminResource('propertyDocuments'),
      listAdminStaff(),
      countCollection('clients'),
      countCollection('properties'),
      countCollection('tenants'),
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
  const outstandingMaintenance = maintenance.filter((item) => isOutstandingStatus(item.status));
  const urgentMaintenance = outstandingMaintenance.filter(
    (item) => String(item.priority || '').toLowerCase() === 'urgent'
  );
  const awaitingReview = documents.filter((item) =>
    ['draft', 'generated', 'review', 'awaiting_review'].includes(
      String(item.status || '').toLowerCase()
    )
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
      label: 'Urgent maintenance',
      count: urgentMaintenance.length,
      resource: 'maintenanceRequests',
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
      total: maintenance.length,
      outstanding: outstandingMaintenance.length,
      urgent: urgentMaintenance.length,
    },
    documents: {
      total: documents.length,
      awaitingReview: awaitingReview.length,
    },
    clients,
    properties,
    tenants,
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

export async function getAdminReportSummary(): Promise<AdminReportSummary> {
  const [bookings, requests, maintenance, clients, properties, subscriptions, staff] =
    await Promise.all([
      listBookings(),
      listAdminResource('documentRequests'),
      listAdminResource('maintenanceRequests'),
      countCollection('clients'),
      countCollection('properties'),
      listAdminResource('subscriptions'),
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
    bookingsByService: Object.entries(
      countBy(bookings, (booking) => booking.serviceName)
    )
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    bookingsByStaff: [...byStaff.values()].sort((a, b) => b.count - a.count),
    documentRequestsByStatus: countBy(
      requests,
      (request) => String(request.status || 'submitted')
    ),
    maintenanceByStatus: countBy(
      maintenance,
      (request) => String(request.status || 'open')
    ),
    clientCount: clients,
    propertyCount: properties,
    activeSubscriptionCount: subscriptions.filter(
      (subscription) => subscription.active !== false &&
        !['cancelled', 'ended'].includes(String(subscription.status || '').toLowerCase())
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
      detail: 'Authentication and operational data store.',
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
      status: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
        ? 'connected'
        : 'optional',
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
