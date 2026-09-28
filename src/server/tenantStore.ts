import { randomBytes } from 'crypto';
import type {
  AdminTenantPortalSnapshot,
  ClientPortalDashboard,
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
  TenantPortalNotification,
  TenantProperty,
  TenantRequest,
  TenantRequestAttachment,
  TenantRequestCreateInput,
  TenantRequestStatus,
  TenantUserRecord,
} from '../types/tenant.js';
import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeTenantEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function tenantPropertyAddressKey(input: {
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
}): string {
  const normalise = (value?: string) =>
    (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    normalise(input.unit),
    normalise(input.streetAddress),
    normalise(input.suburb),
    normalise(input.state).toUpperCase(),
    normalise(input.postcode),
  ].join('|');
}

function docWithId<T>(doc: DocumentSnapshot): T {
  return { ...(doc.data() as object), id: doc.id } as T;
}

async function getDocumentsByIds<T>(
  collection: string,
  ids: string[]
): Promise<T[]> {
  if (ids.length === 0) return [];
  const refs = ids.map((id) => adminDb.collection(collection).doc(id));
  const snapshots = await adminDb.getAll(...refs);
  return snapshots.filter((doc) => doc.exists).map((doc) => docWithId<T>(doc));
}

async function getPropertyScopedCollection<T>(
  collection: string,
  propertyIds: string[]
): Promise<T[]> {
  if (propertyIds.length === 0) return [];
  const results = await Promise.all(
    propertyIds.map((propertyId) =>
      adminDb.collection(collection).where('propertyId', '==', propertyId).get()
    )
  );

  const byId = new Map<string, T>();
  results.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => byId.set(doc.id, docWithId<T>(doc)));
  });
  return Array.from(byId.values());
}

async function getTenantScopedCollection<T>(
  collection: string,
  tenancyIds: string[]
): Promise<T[]> {
  if (tenancyIds.length === 0) return [];
  const results = await Promise.all(
    tenancyIds.map((tenancyId) =>
      adminDb.collection(collection).where('tenancyId', '==', tenancyId).get()
    )
  );

  const byId = new Map<string, T>();
  results.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => byId.set(doc.id, docWithId<T>(doc)));
  });
  return Array.from(byId.values());
}

function publicTenantRequest(request: TenantRequest): TenantRequest {
  return {
    id: request.id,
    reference: request.reference,
    requestType: request.requestType,
    tenantUserId: request.tenantUserId,
    tenancyId: request.tenancyId,
    propertyId: request.propertyId,
    title: request.title,
    details: request.details,
    priority: request.priority,
    status: request.status,
    accessPermission: request.accessPermission,
    preferredAccessNotes: request.preferredAccessNotes,
    payload: request.payload || {},
    attachments: (request.attachments || []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
    })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export async function findAndLinkTenantUser(params: {
  uid: string;
  email: string;
}): Promise<TenantUserRecord | null> {
  const emailLower = normalizeTenantEmail(params.email);

  const uidMatch = await adminDb
    .collection('tenantUsers')
    .where('firebaseUid', '==', params.uid)
    .limit(1)
    .get();

  if (!uidMatch.empty) {
    const tenant = docWithId<TenantUserRecord>(uidMatch.docs[0]);
    if (!tenant.active || tenant.emailLower !== emailLower) return null;
    await uidMatch.docs[0].ref.set({ lastLoginAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    return { ...tenant, lastLoginAt: nowIso() };
  }

  const emailMatch = await adminDb
    .collection('tenantUsers')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();

  if (emailMatch.empty) return null;

  const tenantRef = emailMatch.docs[0].ref;
  let linked: TenantUserRecord | null = null;

  await adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(tenantRef);
    if (!current.exists) return;
    const data = current.data() as TenantUserRecord;

    if (!data.active) return;
    if (data.firebaseUid && data.firebaseUid !== params.uid) return;

    const updatedAt = nowIso();
    transaction.set(
      tenantRef,
      {
        firebaseUid: params.uid,
        lastLoginAt: updatedAt,
        updatedAt,
      },
      { merge: true }
    );

    linked = {
      ...data,
      id: current.id,
      firebaseUid: params.uid,
      lastLoginAt: updatedAt,
      updatedAt,
    };
  });

  return linked;
}

export async function getTenantPortalDashboard(
  tenant: TenantUserRecord
): Promise<TenantPortalDashboard> {
  const tenancies = await getDocumentsByIds<TenancyRecord>('tenancies', tenant.tenancyIds);
  const properties = await getDocumentsByIds<TenantProperty>(
    'properties',
    Array.from(new Set(tenancies.map((item) => item.propertyId)))
  );
  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  const validTenancies = tenancies.filter((tenancy) => propertyMap.has(tenancy.propertyId));
  const activeTenancies = validTenancies.filter((item) => item.status !== 'ended');
  const pastTenancies = validTenancies.filter((item) => item.status === 'ended');
  const validTenancyIds = validTenancies.map((tenancy) => tenancy.id);
  const activeTenancyIds = new Set(activeTenancies.map((tenancy) => tenancy.id));
  const activePropertyIds = new Set(activeTenancies.map((tenancy) => tenancy.propertyId));
  const validPropertyIds = Array.from(new Set(validTenancies.map((tenancy) => tenancy.propertyId)));

  const [requests, allDocuments, inspections, notificationSnapshot] = await Promise.all([
    getTenantScopedCollection<TenantRequest>('tenantRequests', validTenancyIds),
    getPropertyScopedCollection<TenantDocument>('propertyDocuments', validPropertyIds),
    getTenantScopedCollection<TenantInspection>('tenantInspections', validTenancyIds),
    adminDb
      .collection('portalNotifications')
      .where('tenantUserId', '==', tenant.id)
      .limit(100)
      .get(),
  ]);

  const documents = allDocuments.filter((document) => {
    if (!(document.audiences || []).includes('tenant')) return false;

    if (document.tenancyId) {
      return validTenancyIds.includes(document.tenancyId);
    }

    // Property-wide tenant documents remain visible only while the user has an
    // active tenancy at that property. This prevents former tenants from seeing
    // documents later published for a new tenancy.
    return activePropertyIds.has(document.propertyId);
  });

  const publicRequests = requests
    .map(publicTenantRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const publicDocuments = documents
    .map((document) => ({
      id: document.id,
      tenancyId: document.tenancyId,
      propertyId: document.propertyId,
      clientIds: [] as string[],
      audiences: ['tenant'] as PortalAudience[],
      title: document.title,
      category: document.category,
      fileName: document.fileName,
      contentType: document.contentType,
      size: document.size,
      uploadedAt: document.uploadedAt,
      uploadedBy: document.uploadedBy,
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const notifications = notificationSnapshot.docs
    .map((doc) => docWithId<TenantPortalNotification>(doc))
    .map((notification) => ({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const view = (items: TenancyRecord[]) =>
    items.map((tenancy) => ({
      tenancy,
      property: propertyMap.get(tenancy.propertyId)!,
    }));

  return {
    tenant: {
      id: tenant.id,
      email: tenant.email,
      displayName: tenant.displayName,
      phone: tenant.phone,
    },
    tenancies: view(activeTenancies),
    pastTenancies: view(pastTenancies),
    requests: publicRequests,
    documents: publicDocuments,
    inspections: inspections.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)),
    notifications,
  };
}

function makeRequestReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `TR-${datePart}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function createTenantRequest(
  tenant: TenantUserRecord,
  input: TenantRequestCreateInput
): Promise<TenantRequest> {
  if (!tenant.tenancyIds.includes(input.tenancyId)) {
    throw new Error('TENANCY_NOT_AUTHORISED');
  }

  const tenancyDoc = await adminDb.collection('tenancies').doc(input.tenancyId).get();
  if (!tenancyDoc.exists) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = docWithId<TenancyRecord>(tenancyDoc);
  if (tenancy.status === 'ended') throw new Error('TENANCY_ENDED');

  const now = nowIso();
  const ref = adminDb.collection('tenantRequests').doc();
  const request: TenantRequest = {
    id: ref.id,
    reference: makeRequestReference(),
    requestType: input.requestType,
    tenantUserId: tenant.id,
    tenancyId: tenancy.id,
    propertyId: tenancy.propertyId,
    title: input.title,
    details: input.details,
    priority: input.priority || 'normal',
    status: 'submitted',
    accessPermission: input.accessPermission,
    preferredAccessNotes: input.preferredAccessNotes,
    payload: input.payload || {},
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(request);
  return request;
}

async function tenantHasTenancyAccess(
  tenant: TenantUserRecord,
  tenancyId: string
): Promise<boolean> {
  if (!tenant.tenancyIds.includes(tenancyId)) return false;
  return Boolean(await getTenancyById(tenancyId));
}

export async function getTenantRequestForUser(
  tenant: TenantUserRecord,
  requestId: string
): Promise<TenantRequest | null> {
  const doc = await adminDb.collection('tenantRequests').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<TenantRequest>(doc);
  return (await tenantHasTenancyAccess(tenant, request.tenancyId)) ? request : null;
}

export async function addTenantRequestAttachment(
  requestId: string,
  attachment: TenantRequestAttachment & { storagePath: string }
): Promise<TenantRequest | null> {
  const ref = adminDb.collection('tenantRequests').doc(requestId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const data = docWithId<TenantRequest>(existing);
  const attachments = [
    ...(Array.isArray(data.attachments) ? data.attachments : []),
    attachment,
  ];

  await ref.set({ attachments, updatedAt: nowIso() }, { merge: true });
  const updated = await ref.get();
  return publicTenantRequest(docWithId<TenantRequest>(updated));
}

export async function getTenantRequestAttachmentForUser(
  tenant: TenantUserRecord,
  requestId: string,
  attachmentId: string
): Promise<(TenantRequestAttachment & { storagePath: string }) | null> {
  const request = await getTenantRequestForUser(tenant, requestId);
  if (!request) return null;
  const attachment = (request.attachments || []).find((item) => item.id === attachmentId) as
    | (TenantRequestAttachment & { storagePath?: string })
    | undefined;
  if (!attachment?.storagePath) return null;
  return { ...attachment, storagePath: attachment.storagePath };
}

export async function getTenantDocumentForUser(
  tenant: TenantUserRecord,
  documentId: string
): Promise<(TenantDocument & { storagePath?: string }) | null> {
  const doc = await adminDb.collection('propertyDocuments').doc(documentId).get();
  if (!doc.exists) return null;
  const document = docWithId<TenantDocument & { storagePath?: string }>(doc);

  if (!(document.audiences || []).includes('tenant')) return null;

  const tenancies = await getDocumentsByIds<TenancyRecord>('tenancies', tenant.tenancyIds);
  const propertyTenancies = tenancies.filter(
    (tenancy) => tenancy.propertyId === document.propertyId
  );

  if (document.tenancyId) {
    if (!propertyTenancies.some((tenancy) => tenancy.id === document.tenancyId)) {
      return null;
    }
    return document;
  }

  if (!propertyTenancies.some((tenancy) => tenancy.status !== 'ended')) {
    return null;
  }

  return document;
}

export async function listAdminTenantPortal(): Promise<AdminTenantPortalSnapshot> {
  const [
    clients,
    clientUsers,
    clientPropertyLinks,
    properties,
    tenancies,
    tenantUsers,
    requests,
    documents,
    inspections,
  ] = await Promise.all([
    adminDb.collection('clients').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('clientUsers').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('clientPropertyLinks').orderBy('updatedAt', 'desc').limit(1000).get(),
    adminDb.collection('properties').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('tenancies').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('tenantUsers').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('tenantRequests').orderBy('updatedAt', 'desc').limit(500).get(),
    adminDb.collection('propertyDocuments').orderBy('uploadedAt', 'desc').limit(1000).get(),
    adminDb.collection('tenantInspections').orderBy('scheduledStart', 'desc').limit(500).get(),
  ]);

  return {
    clients: clients.docs.map((doc) => docWithId<ClientRecord>(doc)),
    clientUsers: clientUsers.docs.map((doc) => docWithId<ClientUserRecord>(doc)),
    clientPropertyLinks: clientPropertyLinks.docs.map((doc) => docWithId<ClientPropertyLink>(doc)),
    properties: properties.docs.map((doc) => docWithId<TenantProperty>(doc)),
    tenancies: tenancies.docs.map((doc) => docWithId<TenancyRecord>(doc)),
    tenantUsers: tenantUsers.docs.map((doc) => docWithId<TenantUserRecord>(doc)),
    requests: requests.docs.map((doc) => docWithId<TenantRequest>(doc)),
    documents: documents.docs.map((doc) => docWithId<TenantDocument>(doc)),
    inspections: inspections.docs.map((doc) => docWithId<TenantInspection>(doc)),
  };
}

export async function createTenantProperty(input: {
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
  const addressKey = tenantPropertyAddressKey(input);
  const duplicate = await adminDb
    .collection('properties')
    .where('addressKey', '==', addressKey)
    .limit(1)
    .get();
  if (!duplicate.empty) throw new Error('PROPERTY_ADDRESS_EXISTS');

  let primaryClient: ClientRecord | null = null;
  if (input.primaryClientId) {
    const clientDoc = await adminDb.collection('clients').doc(input.primaryClientId).get();
    if (!clientDoc.exists) throw new Error('CLIENT_NOT_FOUND');
    primaryClient = docWithId<ClientRecord>(clientDoc);
  }

  const ref = adminDb.collection('properties').doc();
  const now = nowIso();
  const property: TenantProperty = {
    id: ref.id,
    addressKey,
    streetAddress: input.streetAddress,
    unit: input.unit,
    suburb: input.suburb,
    state: input.state,
    postcode: input.postcode,
    propertyType: input.propertyType,
    primaryClientId: primaryClient?.id,
    clientName: input.clientName || primaryClient?.name,
    clientReference: input.clientReference,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(property);

  if (primaryClient) {
    await createClientPropertyLink({
      clientId: primaryClient.id,
      propertyId: property.id,
      role: 'owner',
      primary: true,
    });
  }

  return property;
}

export async function createTenancy(input: {
  propertyId: string;
  startDate: string;
  endDate?: string;
  rentAmount?: number;
  rentFrequency?: TenancyRecord['rentFrequency'];
  bondReference?: string;
  notes?: string;
  status?: TenancyRecord['status'];
}): Promise<TenancyRecord> {
  const propertyDoc = await adminDb.collection('properties').doc(input.propertyId).get();
  if (!propertyDoc.exists) throw new Error('PROPERTY_NOT_FOUND');
  const property = docWithId<TenantProperty>(propertyDoc);

  const ref = adminDb.collection('tenancies').doc();
  const now = nowIso();
  const tenancy: TenancyRecord = {
    id: ref.id,
    propertyId: input.propertyId,
    clientId: property.primaryClientId,
    status: input.status || 'active',
    startDate: input.startDate,
    endDate: input.endDate,
    rentAmount: input.rentAmount,
    rentFrequency: input.rentFrequency,
    bondReference: input.bondReference,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(tenancy);
  return tenancy;
}

export async function createTenantUser(input: {
  email: string;
  displayName: string;
  phone?: string;
  tenancyIds: string[];
}): Promise<TenantUserRecord> {
  const emailLower = normalizeTenantEmail(input.email);
  const existing = await adminDb
    .collection('tenantUsers')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();
  if (!existing.empty) throw new Error('TENANT_EMAIL_EXISTS');

  const tenancyDocs = await getDocumentsByIds<TenancyRecord>('tenancies', input.tenancyIds);
  if (tenancyDocs.length !== input.tenancyIds.length) throw new Error('TENANCY_NOT_FOUND');

  const ref = adminDb.collection('tenantUsers').doc();
  const now = nowIso();
  const tenant: TenantUserRecord = {
    id: ref.id,
    email: input.email.trim(),
    emailLower,
    displayName: input.displayName.trim(),
    phone: input.phone?.trim(),
    tenancyIds: Array.from(new Set(input.tenancyIds)),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(tenant);
  return tenant;
}

export async function updateTenantRequestAdmin(
  requestId: string,
  changes: { status?: TenantRequestStatus; adminNotes?: string }
): Promise<TenantRequest | null> {
  const ref = adminDb.collection('tenantRequests').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  await ref.set({ ...changes, updatedAt: nowIso() }, { merge: true });
  return docWithId<TenantRequest>(await ref.get());
}

export async function createTenantDocumentRecord(input: {
  tenancyId?: string;
  propertyId: string;
  clientIds?: string[];
  audiences?: PortalAudience[];
  title: string;
  category: TenantDocumentCategory;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  uploadedBy: string;
}): Promise<TenantDocument> {
  const propertyDoc = await adminDb.collection('properties').doc(input.propertyId).get();
  if (!propertyDoc.exists) throw new Error('PROPERTY_NOT_FOUND');

  if (input.tenancyId) {
    const tenancy = await getTenancyById(input.tenancyId);
    if (!tenancy || tenancy.propertyId !== input.propertyId) {
      throw new Error('TENANCY_PROPERTY_MISMATCH');
    }
  }

  const links = await adminDb
    .collection('clientPropertyLinks')
    .where('propertyId', '==', input.propertyId)
    .get();
  const linkedClientIds = links.docs
    .map((doc) => docWithId<ClientPropertyLink>(doc))
    .filter((link) => link.active)
    .map((link) => link.clientId);

  const requestedClientIds = input.clientIds?.length
    ? Array.from(new Set(input.clientIds))
    : (input.audiences || []).includes('client')
      ? linkedClientIds
      : [];

  if (requestedClientIds.some((clientId) => !linkedClientIds.includes(clientId))) {
    throw new Error('CLIENT_PROPERTY_MISMATCH');
  }

  const audiences: PortalAudience[] = Array.from(
    new Set<PortalAudience>(input.audiences?.length ? input.audiences : ['tenant'])
  );
  const ref = adminDb.collection('propertyDocuments').doc();
  const document: TenantDocument & { storagePath: string } = {
    id: ref.id,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    clientIds: requestedClientIds,
    audiences,
    title: input.title,
    category: input.category,
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.size,
    storagePath: input.storagePath,
    uploadedAt: nowIso(),
    uploadedBy: input.uploadedBy,
  };
  await ref.set(document);
  const { storagePath: _storagePath, ...publicDocument } = document;
  return publicDocument;
}


export async function getTenancyById(tenancyId: string): Promise<TenancyRecord | null> {
  const doc = await adminDb.collection('tenancies').doc(tenancyId).get();
  return doc.exists ? docWithId<TenancyRecord>(doc) : null;
}

export async function createTenantInspection(input: {
  tenancyId: string;
  propertyId: string;
  type: TenantInspection['type'];
  status?: TenantInspection['status'];
  scheduledStart: string;
  scheduledEnd?: string;
  noticeDocumentId?: string;
  notes?: string;
}): Promise<TenantInspection> {
  const tenancy = await getTenancyById(input.tenancyId);
  if (!tenancy || tenancy.propertyId !== input.propertyId) {
    throw new Error('TENANCY_PROPERTY_MISMATCH');
  }

  const ref = adminDb.collection('tenantInspections').doc();
  const now = nowIso();
  const inspection: TenantInspection = {
    id: ref.id,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    type: input.type,
    status: input.status || 'scheduled',
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    noticeDocumentId: input.noticeDocumentId,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(inspection);
  return inspection;
}


export async function getTenantUserById(tenantUserId: string): Promise<TenantUserRecord | null> {
  const doc = await adminDb.collection('tenantUsers').doc(tenantUserId).get();
  return doc.exists ? docWithId<TenantUserRecord>(doc) : null;
}


export async function updateTenantUserAdmin(
  tenantUserId: string,
  changes: {
    active?: boolean;
    displayName?: string;
    phone?: string;
    tenancyIds?: string[];
  }
): Promise<TenantUserRecord | null> {
  const ref = adminDb.collection('tenantUsers').doc(tenantUserId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  if (changes.tenancyIds) {
    const uniqueIds = Array.from(new Set(changes.tenancyIds));
    const tenancies = await getDocumentsByIds<TenancyRecord>('tenancies', uniqueIds);
    if (tenancies.length !== uniqueIds.length) throw new Error('TENANCY_NOT_FOUND');
    changes.tenancyIds = uniqueIds;
  }

  await ref.set(
    {
      ...changes,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  return docWithId<TenantUserRecord>(await ref.get());
}

export async function updateTenancyAdmin(
  tenancyId: string,
  changes: {
    status?: TenancyRecord['status'];
    endDate?: string;
    notes?: string;
  }
): Promise<TenancyRecord | null> {
  const ref = adminDb.collection('tenancies').doc(tenancyId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const patch: Record<string, unknown> = {
    ...changes,
    updatedAt: nowIso(),
  };

  if (changes.status === 'active' && changes.endDate === undefined) {
    patch.endDate = FieldValue.delete();
  }

  await ref.set(patch, { merge: true });

  return docWithId<TenancyRecord>(await ref.get());
}


export async function createClient(input: {
  name: string;
  clientType: ClientType;
  email?: string;
  phone?: string;
  externalReference?: string;
}): Promise<ClientRecord> {
  const ref = adminDb.collection('clients').doc();
  const now = nowIso();
  const client: ClientRecord = {
    id: ref.id,
    name: input.name.trim(),
    clientType: input.clientType,
    email: input.email?.trim(),
    phone: input.phone?.trim(),
    externalReference: input.externalReference?.trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(client);
  return client;
}

export async function createClientPropertyLink(input: {
  clientId: string;
  propertyId: string;
  role: ClientPropertyRole;
  primary?: boolean;
}): Promise<ClientPropertyLink> {
  const [clientDoc, propertyDoc] = await Promise.all([
    adminDb.collection('clients').doc(input.clientId).get(),
    adminDb.collection('properties').doc(input.propertyId).get(),
  ]);
  if (!clientDoc.exists) throw new Error('CLIENT_NOT_FOUND');
  if (!propertyDoc.exists) throw new Error('PROPERTY_NOT_FOUND');

  const existing = await adminDb
    .collection('clientPropertyLinks')
    .where('clientId', '==', input.clientId)
    .where('propertyId', '==', input.propertyId)
    .limit(1)
    .get();

  if (input.primary) {
    const propertyLinks = await adminDb
      .collection('clientPropertyLinks')
      .where('propertyId', '==', input.propertyId)
      .get();
    const batch = adminDb.batch();
    propertyLinks.docs.forEach((linkDoc) => {
      if (linkDoc.id !== existing.docs[0]?.id) {
        batch.set(linkDoc.ref, { primary: false, updatedAt: nowIso() }, { merge: true });
      }
    });
    await batch.commit();
  }

  if (!existing.empty) {
    const current = docWithId<ClientPropertyLink>(existing.docs[0]);
    const updatedAt = nowIso();
    await existing.docs[0].ref.set(
      {
        role: input.role,
        primary: Boolean(input.primary),
        active: true,
        updatedAt,
      },
      { merge: true }
    );
    return {
      ...current,
      role: input.role,
      primary: Boolean(input.primary),
      active: true,
      updatedAt,
    };
  }

  const ref = adminDb.collection('clientPropertyLinks').doc();
  const now = nowIso();
  const link: ClientPropertyLink = {
    id: ref.id,
    clientId: input.clientId,
    propertyId: input.propertyId,
    role: input.role,
    primary: Boolean(input.primary),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(link);

  if (link.primary) {
    const client = docWithId<ClientRecord>(clientDoc);
    await propertyDoc.ref.set(
      {
        primaryClientId: client.id,
        clientName: client.name,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  return link;
}

export async function createClientUser(input: {
  email: string;
  displayName: string;
  phone?: string;
  clientIds: string[];
  clientRoles?: Record<string, 'owner' | 'admin' | 'member' | 'viewer'>;
}): Promise<ClientUserRecord> {
  const emailLower = normalizeTenantEmail(input.email);
  const clientIds = Array.from(new Set(input.clientIds));
  const clients = await getDocumentsByIds<ClientRecord>('clients', clientIds);
  if (clients.length !== clientIds.length) throw new Error('CLIENT_NOT_FOUND');

  const existing = await adminDb
    .collection('clientUsers')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();

  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    let updated: ClientUserRecord | null = null;

    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const current = docWithId<ClientUserRecord>(snapshot);
      const currentClientIds = Array.isArray(current.clientIds) ? current.clientIds : [];
      const nextClientIds = Array.from(new Set([...currentClientIds, ...clientIds]));
      const currentRoles = current.clientRoles || {};
      const nextRoles: NonNullable<ClientUserRecord['clientRoles']> = { ...currentRoles };

      clientIds.forEach((clientId) => {
        if (!currentClientIds.includes(clientId)) {
          nextRoles[clientId] = input.clientRoles?.[clientId] || 'owner';
        }
      });

      const hasNewMembership = nextClientIds.length !== currentClientIds.length;
      if (!hasNewMembership) {
        throw new Error('CLIENT_USER_ALREADY_LINKED');
      }

      const updatedAt = nowIso();
      transaction.set(
        ref,
        {
          clientIds: nextClientIds,
          clientRoles: nextRoles,
          active: true,
          updatedAt,
          ...(!current.displayName && input.displayName.trim()
            ? { displayName: input.displayName.trim() }
            : {}),
          ...(!current.phone && input.phone?.trim()
            ? { phone: input.phone.trim() }
            : {}),
        },
        { merge: true }
      );

      updated = {
        ...current,
        clientIds: nextClientIds,
        clientRoles: nextRoles,
        active: true,
        updatedAt,
      };
    });

    if (!updated) throw new Error('CLIENT_USER_UPDATE_FAILED');
    return updated;
  }

  const ref = adminDb.collection('clientUsers').doc();
  const now = nowIso();
  const user: ClientUserRecord = {
    id: ref.id,
    email: input.email.trim(),
    emailLower,
    displayName: input.displayName.trim(),
    phone: input.phone?.trim(),
    clientIds,
    clientRoles: Object.fromEntries(
      clientIds.map((clientId) => [
        clientId,
        input.clientRoles?.[clientId] || 'owner',
      ])
    ),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(user);
  return user;
}

export async function findAndLinkClientUser(params: {
  uid: string;
  email: string;
}): Promise<ClientUserRecord | null> {
  const emailLower = normalizeTenantEmail(params.email);
  const uidMatch = await adminDb
    .collection('clientUsers')
    .where('firebaseUid', '==', params.uid)
    .limit(1)
    .get();

  if (!uidMatch.empty) {
    const user = docWithId<ClientUserRecord>(uidMatch.docs[0]);
    if (!user.active || user.emailLower !== emailLower) return null;
    const updatedAt = nowIso();
    await uidMatch.docs[0].ref.set({ lastLoginAt: updatedAt, updatedAt }, { merge: true });
    return { ...user, lastLoginAt: updatedAt, updatedAt };
  }

  const emailMatch = await adminDb
    .collection('clientUsers')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();
  if (emailMatch.empty) return null;

  const userRef = emailMatch.docs[0].ref;
  let linked: ClientUserRecord | null = null;
  await adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(userRef);
    if (!current.exists) return;
    const data = current.data() as ClientUserRecord;
    if (!data.active) return;
    if (data.firebaseUid && data.firebaseUid !== params.uid) return;

    const updatedAt = nowIso();
    transaction.set(
      userRef,
      { firebaseUid: params.uid, lastLoginAt: updatedAt, updatedAt },
      { merge: true }
    );
    linked = {
      ...data,
      id: current.id,
      firebaseUid: params.uid,
      lastLoginAt: updatedAt,
      updatedAt,
    };
  });
  return linked;
}

export async function getClientPortalDashboard(
  clientUser: ClientUserRecord
): Promise<ClientPortalDashboard> {
  const clients = (await getDocumentsByIds<ClientRecord>('clients', clientUser.clientIds))
    .filter((client) => client.status === 'active');

  const linkSnapshots = await Promise.all(
    clients.map((client) =>
      adminDb.collection('clientPropertyLinks').where('clientId', '==', client.id).get()
    )
  );
  const propertyLinks = linkSnapshots
    .flatMap((snapshot) => snapshot.docs.map((doc) => docWithId<ClientPropertyLink>(doc)))
    .filter((link) => link.active);

  const properties = await getDocumentsByIds<TenantProperty>(
    'properties',
    Array.from(new Set(propertyLinks.map((link) => link.propertyId)))
  );
  const propertyIds = properties.map((property) => property.id);
  const allDocuments = await getPropertyScopedCollection<TenantDocument>(
    'propertyDocuments',
    propertyIds
  );
  const allowedClientIds = clients.map((client) => client.id);
  const documents = allDocuments
    .filter(
      (document) =>
        (document.audiences || []).includes('client') &&
        (document.clientIds || []).some((clientId) => allowedClientIds.includes(clientId))
    )
    .map((document) => {
      const { storagePath: _storagePath, ...publicDocument } =
        document as TenantDocument & { storagePath?: string };
      return {
        ...publicDocument,
        clientIds: publicDocument.clientIds.filter((clientId) =>
          allowedClientIds.includes(clientId)
        ),
      };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return {
    clientUser: {
      id: clientUser.id,
      email: clientUser.email,
      displayName: clientUser.displayName,
      phone: clientUser.phone,
    },
    clients,
    properties,
    propertyLinks,
    documents,
  };
}

export async function getClientDocumentForUser(
  clientUser: ClientUserRecord,
  documentId: string
): Promise<(TenantDocument & { storagePath?: string }) | null> {
  const doc = await adminDb.collection('propertyDocuments').doc(documentId).get();
  if (!doc.exists) return null;
  const document = docWithId<TenantDocument & { storagePath?: string }>(doc);

  if (!(document.audiences || []).includes('client')) return null;
  if (!(document.clientIds || []).some((clientId) => clientUser.clientIds.includes(clientId))) {
    return null;
  }

  const links = await adminDb
    .collection('clientPropertyLinks')
    .where('propertyId', '==', document.propertyId)
    .get();
  const authorised = links.docs
    .map((linkDoc) => docWithId<ClientPropertyLink>(linkDoc))
    .some(
      (link) =>
        link.active &&
        clientUser.clientIds.includes(link.clientId) &&
        (document.clientIds || []).includes(link.clientId)
    );

  return authorised ? document : null;
}
