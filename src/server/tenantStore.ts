import { randomBytes } from 'crypto';
import type {
  AdminTenantPortalSnapshot,
  TenancyRecord,
  TenantDocument,
  TenantDocumentCategory,
  TenantInspection,
  TenantPortalDashboard,
  TenantProperty,
  TenantRequest,
  TenantRequestAttachment,
  TenantRequestCreateInput,
  TenantRequestStatus,
  TenantUserRecord,
} from '../types/tenant.js';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeTenantEmail(value: string): string {
  return value.trim().toLowerCase();
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
  const activeTenancies = tenancies.filter((item) => item.status !== 'ended');
  const properties = await getDocumentsByIds<TenantProperty>(
    'properties',
    Array.from(new Set(activeTenancies.map((item) => item.propertyId)))
  );
  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  const validTenancyIds = activeTenancies
    .filter((tenancy) => propertyMap.has(tenancy.propertyId))
    .map((tenancy) => tenancy.id);

  const [requests, documents, inspections] = await Promise.all([
    getTenantScopedCollection<TenantRequest>('tenantRequests', validTenancyIds),
    getTenantScopedCollection<TenantDocument>('tenantDocuments', validTenancyIds),
    getTenantScopedCollection<TenantInspection>('tenantInspections', validTenancyIds),
  ]);

  const publicRequests = requests
    .map(publicTenantRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const publicDocuments = documents
    .map((document) => ({
      id: document.id,
      tenancyId: document.tenancyId,
      propertyId: document.propertyId,
      title: document.title,
      category: document.category,
      fileName: document.fileName,
      contentType: document.contentType,
      size: document.size,
      uploadedAt: document.uploadedAt,
      uploadedBy: document.uploadedBy,
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return {
    tenant: {
      id: tenant.id,
      email: tenant.email,
      displayName: tenant.displayName,
      phone: tenant.phone,
    },
    tenancies: activeTenancies
      .filter((tenancy) => propertyMap.has(tenancy.propertyId))
      .map((tenancy) => ({
        tenancy,
        property: propertyMap.get(tenancy.propertyId)!,
      })),
    requests: publicRequests,
    documents: publicDocuments,
    inspections: inspections.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)),
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

export async function getTenantRequestForUser(
  tenant: TenantUserRecord,
  requestId: string
): Promise<TenantRequest | null> {
  const doc = await adminDb.collection('tenantRequests').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<TenantRequest>(doc);
  return tenant.tenancyIds.includes(request.tenancyId) ? request : null;
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
  const doc = await adminDb.collection('tenantDocuments').doc(documentId).get();
  if (!doc.exists) return null;
  const document = docWithId<TenantDocument & { storagePath?: string }>(doc);
  return tenant.tenancyIds.includes(document.tenancyId) ? document : null;
}

export async function listAdminTenantPortal(): Promise<AdminTenantPortalSnapshot> {
  const [properties, tenancies, tenantUsers, requests, documents, inspections] =
    await Promise.all([
      adminDb.collection('properties').orderBy('updatedAt', 'desc').limit(500).get(),
      adminDb.collection('tenancies').orderBy('updatedAt', 'desc').limit(500).get(),
      adminDb.collection('tenantUsers').orderBy('updatedAt', 'desc').limit(500).get(),
      adminDb.collection('tenantRequests').orderBy('updatedAt', 'desc').limit(500).get(),
      adminDb.collection('tenantDocuments').orderBy('uploadedAt', 'desc').limit(500).get(),
      adminDb.collection('tenantInspections').orderBy('scheduledStart', 'desc').limit(500).get(),
    ]);

  return {
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
  clientName?: string;
  clientReference?: string;
}): Promise<TenantProperty> {
  const ref = adminDb.collection('properties').doc();
  const now = nowIso();
  const property: TenantProperty = {
    id: ref.id,
    streetAddress: input.streetAddress,
    unit: input.unit,
    suburb: input.suburb,
    state: input.state,
    postcode: input.postcode,
    propertyType: input.propertyType,
    clientName: input.clientName,
    clientReference: input.clientReference,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(property);
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
  const property = await adminDb.collection('properties').doc(input.propertyId).get();
  if (!property.exists) throw new Error('PROPERTY_NOT_FOUND');

  const ref = adminDb.collection('tenancies').doc();
  const now = nowIso();
  const tenancy: TenancyRecord = {
    id: ref.id,
    propertyId: input.propertyId,
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
  tenancyId: string;
  propertyId: string;
  title: string;
  category: TenantDocumentCategory;
  fileName: string;
  contentType: string;
  size: number;
  storagePath: string;
  uploadedBy: string;
}): Promise<TenantDocument> {
  const ref = adminDb.collection('tenantDocuments').doc();
  const document: TenantDocument & { storagePath: string } = {
    id: ref.id,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
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

  await ref.set(
    {
      ...changes,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  return docWithId<TenancyRecord>(await ref.get());
}
