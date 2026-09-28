import { randomBytes } from 'crypto';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type {
  AuditActor,
  AuditEntityType,
  AuditEvent,
  ClientMembership,
  ClientPropertyLink,
  ClientRecord,
  ClientUserRecord,
  CommunicationRecord,
  DocumentRequest,
  PaymentRecord,
  PlatformCollectionMap,
  PlatformResourceName,
  PropertyDocument,
  PropertyRecord,
  Subscription,
  TenantUserRecord,
  TenancyRecord,
  WorkOrder,
} from '../types/platform.js';

export class PlatformValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'VALIDATION_ERROR', status = 400) {
    super(message);
    this.name = 'PlatformValidationError';
    this.code = code;
    this.status = status;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function docWithId<T>(doc: DocumentSnapshot): T {
  return { ...(doc.data() as object), id: doc.id } as T;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max = 500): string | undefined {
  const result = text(value, max);
  return result || undefined;
}

function requiredText(value: unknown, label: string, max = 500): string {
  const result = text(value, max);
  if (!result) throw new PlatformValidationError(`${label} is required.`);
  return result;
}

function email(value: unknown, required = false): string | undefined {
  const result = text(value, 254).toLowerCase();
  if (!result) {
    if (required) throw new PlatformValidationError('A valid email address is required.');
    return undefined;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new PlatformValidationError('A valid email address is required.');
  }
  return result;
}

function numberValue(value: unknown, label: string, min = 0): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < min) {
    throw new PlatformValidationError(`${label} must be a valid number.`);
  }
  return result;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, 160)).filter(Boolean)));
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Boolean(value);
}

function reference(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function requireDocument(collection: string, id: string, label: string) {
  const doc = await adminDb.collection(collection).doc(id).get();
  if (!doc.exists) {
    throw new PlatformValidationError(`${label} does not exist.`, 'REFERENCE_NOT_FOUND', 409);
  }
  return doc;
}

async function optionalDocument(collection: string, id: string | undefined, label: string) {
  if (!id) return null;
  return requireDocument(collection, id, label);
}

async function validatePropertyClientLink(propertyId: string, clientId: string) {
  const snapshot = await adminDb
    .collection('clientPropertyLinks')
    .where('propertyId', '==', propertyId)
    .where('clientId', '==', clientId)
    .limit(1)
    .get();
  if (snapshot.empty || snapshot.docs[0].data().active === false) {
    throw new PlatformValidationError(
      'The selected client is not linked to the selected property.',
      'CLIENT_PROPERTY_LINK_REQUIRED',
      409
    );
  }
}

function baseTimes(existing?: Record<string, unknown>) {
  const now = nowIso();
  return {
    createdAt: text(existing?.createdAt, 50) || now,
    updatedAt: now,
  };
}

async function validateClient(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<ClientRecord, 'id'>> {
  const allowedTypes = new Set([
    'landlord','agency','commercial_landlord','strata_company','asset_manager','other',
  ]);
  const clientType = text(payload.clientType ?? existing?.clientType, 40) || 'landlord';
  if (!allowedTypes.has(clientType)) throw new PlatformValidationError('Invalid client type.');
  const status = text(payload.status ?? existing?.status, 20) || 'active';
  if (!['active', 'inactive'].includes(status)) throw new PlatformValidationError('Invalid client status.');
  return {
    name: requiredText(payload.name ?? existing?.name, 'Client name', 160),
    clientType: clientType as ClientRecord['clientType'],
    email: email(payload.email ?? existing?.email),
    phone: optionalText(payload.phone ?? existing?.phone, 40),
    externalReference: optionalText(payload.externalReference ?? existing?.externalReference, 120),
    status: status as ClientRecord['status'],
    ...baseTimes(existing),
    archivedAt: optionalText(payload.archivedAt ?? existing?.archivedAt, 50),
  };
}

async function validateClientUser(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<ClientUserRecord, 'id'>> {
  const userEmail = email(payload.email ?? existing?.email, true)!;
  const clientIds = payload.clientIds === undefined
    ? stringArray(existing?.clientIds)
    : stringArray(payload.clientIds);
  await Promise.all(clientIds.map((id) => requireDocument('clients', id, 'Client')));

  const roleInput =
    payload.clientRoles && typeof payload.clientRoles === 'object' && !Array.isArray(payload.clientRoles)
      ? payload.clientRoles as Record<string, unknown>
      : (existing?.clientRoles as Record<string, unknown> | undefined) || {};
  const clientRoles: ClientUserRecord['clientRoles'] = {};
  for (const clientId of clientIds) {
    const role = text(roleInput[clientId], 20) || 'member';
    if (!['owner','admin','member','viewer'].includes(role)) {
      throw new PlatformValidationError('Invalid client membership role.');
    }
    clientRoles[clientId] = role as ClientUserRecord['clientRoles'][string];
  }

  return {
    email: userEmail,
    emailLower: userEmail,
    displayName: requiredText(payload.displayName ?? existing?.displayName, 'Display name', 160),
    phone: optionalText(payload.phone ?? existing?.phone, 40),
    firebaseUid: optionalText(payload.firebaseUid ?? existing?.firebaseUid, 160),
    active: booleanValue(payload.active ?? existing?.active, true),
    clientIds,
    clientRoles,
    ...baseTimes(existing),
    lastLoginAt: optionalText(payload.lastLoginAt ?? existing?.lastLoginAt, 50),
  };
}

async function validateClientMembership(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<ClientMembership, 'id'>> {
  const clientId = requiredText(payload.clientId ?? existing?.clientId, 'Client', 160);
  const clientUserId = requiredText(payload.clientUserId ?? existing?.clientUserId, 'Client user', 160);
  await Promise.all([
    requireDocument('clients', clientId, 'Client'),
    requireDocument('clientUsers', clientUserId, 'Client user'),
  ]);
  const role = text(payload.role ?? existing?.role, 20) || 'member';
  const status = text(payload.status ?? existing?.status, 20) || 'active';
  if (!['owner','admin','member','viewer'].includes(role)) throw new PlatformValidationError('Invalid membership role.');
  if (!['active','invited','revoked'].includes(status)) throw new PlatformValidationError('Invalid membership status.');
  const user = await adminDb.collection('clientUsers').doc(clientUserId).get();
  const userEmail = email(payload.email ?? existing?.email ?? user.data()?.email, true)!;
  return {
    clientId,
    clientUserId,
    email: userEmail,
    role: role as ClientMembership['role'],
    status: status as ClientMembership['status'],
    invitedBy: optionalText(payload.invitedBy ?? existing?.invitedBy, 160),
    ...baseTimes(existing),
  };
}

async function validateProperty(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<PropertyRecord, 'id'>> {
  const primaryClientId = optionalText(payload.primaryClientId ?? existing?.primaryClientId, 160);
  await optionalDocument('clients', primaryClientId, 'Primary client');
  const status = text(payload.status ?? existing?.status, 20) || 'active';
  if (!['active','inactive'].includes(status)) throw new PlatformValidationError('Invalid property status.');
  return {
    streetAddress: requiredText(payload.streetAddress ?? existing?.streetAddress, 'Street address', 240),
    unit: optionalText(payload.unit ?? existing?.unit, 80),
    suburb: requiredText(payload.suburb ?? existing?.suburb, 'Suburb', 120),
    state: (text(payload.state ?? existing?.state, 10) || 'WA').toUpperCase(),
    postcode: requiredText(payload.postcode ?? existing?.postcode, 'Postcode', 10),
    propertyType: optionalText(payload.propertyType ?? existing?.propertyType, 80),
    primaryClientId,
    clientName: optionalText(payload.clientName ?? existing?.clientName, 160),
    clientReference: optionalText(payload.clientReference ?? existing?.clientReference, 120),
    status: status as PropertyRecord['status'],
    ...baseTimes(existing),
    archivedAt: optionalText(payload.archivedAt ?? existing?.archivedAt, 50),
  };
}

async function validateClientPropertyLink(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<ClientPropertyLink, 'id'>> {
  const clientId = requiredText(payload.clientId ?? existing?.clientId, 'Client', 160);
  const propertyId = requiredText(payload.propertyId ?? existing?.propertyId, 'Property', 160);
  await Promise.all([
    requireDocument('clients', clientId, 'Client'),
    requireDocument('properties', propertyId, 'Property'),
  ]);
  const role = text(payload.role ?? existing?.role, 30) || 'owner';
  if (!['owner','landlord','managing_agent','asset_manager','strata_manager','other'].includes(role)) {
    throw new PlatformValidationError('Invalid client-property role.');
  }
  return {
    clientId,
    propertyId,
    role: role as ClientPropertyLink['role'],
    primary: booleanValue(payload.primary ?? existing?.primary, false),
    active: booleanValue(payload.active ?? existing?.active, true),
    ...baseTimes(existing),
  };
}

async function validateTenancy(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<TenancyRecord, 'id'>> {
  const propertyId = requiredText(payload.propertyId ?? existing?.propertyId, 'Property', 160);
  const clientId = optionalText(payload.clientId ?? existing?.clientId, 160);
  await requireDocument('properties', propertyId, 'Property');
  await optionalDocument('clients', clientId, 'Client');
  if (clientId) await validatePropertyClientLink(propertyId, clientId);
  const status = text(payload.status ?? existing?.status, 20) || 'active';
  if (!['pending','active','ended'].includes(status)) throw new PlatformValidationError('Invalid tenancy status.');
  const frequency = optionalText(payload.rentFrequency ?? existing?.rentFrequency, 20);
  if (frequency && !['weekly','fortnightly','monthly'].includes(frequency)) {
    throw new PlatformValidationError('Invalid rent frequency.');
  }
  return {
    propertyId,
    clientId,
    status: status as TenancyRecord['status'],
    startDate: requiredText(payload.startDate ?? existing?.startDate, 'Tenancy start date', 30),
    endDate: optionalText(payload.endDate ?? existing?.endDate, 30),
    rentAmount: payload.rentAmount === undefined && existing?.rentAmount === undefined
      ? undefined
      : numberValue(payload.rentAmount ?? existing?.rentAmount, 'Rent amount'),
    rentFrequency: frequency as TenancyRecord['rentFrequency'],
    bondReference: optionalText(payload.bondReference ?? existing?.bondReference, 120),
    notes: optionalText(payload.notes ?? existing?.notes, 3000),
    ...baseTimes(existing),
  };
}

async function validateTenantUser(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<TenantUserRecord, 'id'>> {
  const userEmail = email(payload.email ?? existing?.email, true)!;
  const tenancyIds = payload.tenancyIds === undefined
    ? stringArray(existing?.tenancyIds)
    : stringArray(payload.tenancyIds);
  await Promise.all(tenancyIds.map((id) => requireDocument('tenancies', id, 'Tenancy')));
  return {
    email: userEmail,
    emailLower: userEmail,
    displayName: requiredText(payload.displayName ?? existing?.displayName, 'Display name', 160),
    phone: optionalText(payload.phone ?? existing?.phone, 40),
    firebaseUid: optionalText(payload.firebaseUid ?? existing?.firebaseUid, 160),
    tenancyIds,
    active: booleanValue(payload.active ?? existing?.active, true),
    ...baseTimes(existing),
    lastLoginAt: optionalText(payload.lastLoginAt ?? existing?.lastLoginAt, 50),
  };
}

async function validateDocument(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<PropertyDocument, 'id'>> {
  const propertyId = requiredText(payload.propertyId ?? existing?.propertyId, 'Property', 160);
  const clientIds = payload.clientIds === undefined
    ? stringArray(existing?.clientIds)
    : stringArray(payload.clientIds);
  const tenancyId = optionalText(payload.tenancyId ?? existing?.tenancyId, 160);
  const bookingId = optionalText(payload.bookingId ?? existing?.bookingId, 160);
  const workOrderId = optionalText(payload.workOrderId ?? existing?.workOrderId, 160);
  const requestId = optionalText(payload.requestId ?? existing?.requestId, 160);
  await requireDocument('properties', propertyId, 'Property');
  await Promise.all(clientIds.map((id) => requireDocument('clients', id, 'Client')));
  const tenancy = await optionalDocument('tenancies', tenancyId, 'Tenancy');
  if (tenancy && tenancy.data()?.propertyId !== propertyId) {
    throw new PlatformValidationError('The selected tenancy does not belong to the selected property.', 'RELATIONSHIP_MISMATCH', 409);
  }
  const booking = await optionalDocument('bookings', bookingId, 'Booking');
  if (booking && booking.data()?.propertyId && booking.data()?.propertyId !== propertyId) {
    throw new PlatformValidationError('The selected booking does not belong to the selected property.', 'RELATIONSHIP_MISMATCH', 409);
  }
  const workOrder = await optionalDocument('workOrders', workOrderId, 'Work order');
  if (workOrder && workOrder.data()?.propertyId !== propertyId) {
    throw new PlatformValidationError('The selected work order does not belong to the selected property.', 'RELATIONSHIP_MISMATCH', 409);
  }
  await optionalDocument('documentRequests', requestId, 'Document request');

  const status = text(payload.status ?? existing?.status, 30) || 'draft';
  if (!['draft','generated','review','approved','issued','archived'].includes(status)) {
    throw new PlatformValidationError('Invalid document status.');
  }
  const audiences = (payload.audiences === undefined ? stringArray(existing?.audiences) : stringArray(payload.audiences))
    .filter((value) => ['tenant','client','staff'].includes(value)) as PropertyDocument['audiences'];

  return {
    propertyId,
    clientIds,
    tenancyId,
    bookingId,
    workOrderId,
    requestId,
    audiences,
    title: requiredText(payload.title ?? existing?.title, 'Document title', 240),
    category: requiredText(payload.category ?? payload.documentType ?? existing?.category, 'Document category', 100),
    fileName: requiredText(payload.fileName ?? existing?.fileName ?? payload.title ?? existing?.title, 'File name', 240),
    storagePath: optionalText(payload.storagePath ?? payload.storageUrl ?? existing?.storagePath, 1000),
    contentType: text(payload.contentType ?? existing?.contentType, 120) || 'application/pdf',
    size: payload.size === undefined && existing?.size === undefined ? 0 : numberValue(payload.size ?? existing?.size, 'File size'),
    version: payload.version === undefined && existing?.version === undefined ? 1 : numberValue(payload.version ?? existing?.version, 'Document version', 1),
    status: status as PropertyDocument['status'],
    uploadedAt: text(existing?.uploadedAt, 50) || nowIso(),
    uploadedBy: requiredText(payload.uploadedBy ?? existing?.uploadedBy ?? 'staff', 'Uploaded by', 160),
    generatedAt: optionalText(payload.generatedAt ?? existing?.generatedAt, 50),
    approvedAt: optionalText(payload.approvedAt ?? existing?.approvedAt, 50),
    approvedBy: optionalText(payload.approvedBy ?? existing?.approvedBy, 160),
    issuedAt: optionalText(payload.issuedAt ?? existing?.issuedAt, 50),
    issuedBy: optionalText(payload.issuedBy ?? existing?.issuedBy, 160),
    updatedAt: nowIso(),
  };
}

async function validateDocumentRequest(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<DocumentRequest, 'id'>> {
  const propertyId = optionalText(payload.propertyId ?? existing?.propertyId, 160);
  const clientId = optionalText(payload.clientId ?? existing?.clientId, 160);
  const clientUserId = optionalText(payload.clientUserId ?? existing?.clientUserId, 160);
  const assignedStaffId = optionalText(payload.assignedStaffId ?? existing?.assignedStaffId, 160);
  await optionalDocument('properties', propertyId, 'Property');
  await optionalDocument('clients', clientId, 'Client');
  await optionalDocument('clientUsers', clientUserId, 'Client user');
  await optionalDocument('adminUsers', assignedStaffId, 'Assigned staff member');
  if (propertyId && clientId) await validatePropertyClientLink(propertyId, clientId);

  const addressInput =
    payload.address && typeof payload.address === 'object' && !Array.isArray(payload.address)
      ? payload.address as Record<string, unknown>
      : (existing?.address as Record<string, unknown> | undefined) || {};
  const status = text(payload.status ?? existing?.status, 40) || 'submitted';
  if (!['submitted','under_review','awaiting_information','in_preparation','review','ready','completed','cancelled'].includes(status)) {
    throw new PlatformValidationError('Invalid document request status.');
  }
  const category = text(payload.documentCategory ?? existing?.documentCategory, 40);
  if (!['residential','commercial','strata-building'].includes(category)) {
    throw new PlatformValidationError('Invalid document category.');
  }
  const pricingMode = text(payload.pricingMode ?? existing?.pricingMode, 20) || 'fixed';
  if (!['fixed','quote'].includes(pricingMode)) throw new PlatformValidationError('Invalid pricing mode.');

  const generatedDocumentId = optionalText(payload.generatedDocumentId ?? existing?.generatedDocumentId, 160);
  const paymentId = optionalText(payload.paymentId ?? existing?.paymentId, 160);
  await optionalDocument('propertyDocuments', generatedDocumentId, 'Generated document');
  await optionalDocument('payments', paymentId, 'Payment');

  return {
    reference: text(payload.reference ?? payload.requestReference ?? existing?.reference, 80) || reference('DR'),
    documentProductId: requiredText(payload.documentProductId ?? payload.documentId ?? existing?.documentProductId, 'Document product', 160),
    documentName: requiredText(payload.documentName ?? payload.title ?? existing?.documentName, 'Document name', 240),
    documentCategory: category as DocumentRequest['documentCategory'],
    pricingMode: pricingMode as DocumentRequest['pricingMode'],
    priceExGst: payload.priceExGst === undefined && existing?.priceExGst === undefined
      ? undefined
      : numberValue(payload.priceExGst ?? existing?.priceExGst, 'Price ex GST'),
    propertyId,
    clientId,
    clientUserId,
    assignedStaffId,
    requesterName: requiredText(payload.requesterName ?? existing?.requesterName, 'Requester name', 160),
    requesterEmail: email(payload.requesterEmail ?? existing?.requesterEmail, true)!,
    requesterPhone: requiredText(payload.requesterPhone ?? existing?.requesterPhone, 'Requester phone', 40),
    address: {
      streetAddress: requiredText(addressInput.streetAddress, 'Street address', 240),
      unit: optionalText(addressInput.unit, 80),
      suburb: requiredText(addressInput.suburb, 'Suburb', 120),
      state: (text(addressInput.state, 10) || 'WA').toUpperCase(),
      postcode: requiredText(addressInput.postcode, 'Postcode', 10),
    },
    notes: optionalText(payload.notes ?? existing?.notes, 3000),
    status: status as DocumentRequest['status'],
    generatedDocumentId,
    paymentId,
    ...baseTimes(existing),
  };
}

async function validateWorkOrder(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>,
  actorId = 'system'
): Promise<Omit<WorkOrder, 'id'>> {
  const propertyId = requiredText(payload.propertyId ?? existing?.propertyId, 'Property', 160);
  const clientId = optionalText(payload.clientId ?? existing?.clientId, 160);
  const tenancyId = optionalText(payload.tenancyId ?? existing?.tenancyId, 160);
  const assignedStaffId = optionalText(payload.assignedStaffId ?? existing?.assignedStaffId, 160);
  await requireDocument('properties', propertyId, 'Property');
  await optionalDocument('clients', clientId, 'Client');
  const tenancy = await optionalDocument('tenancies', tenancyId, 'Tenancy');
  await optionalDocument('adminUsers', assignedStaffId, 'Assigned staff member');
  if (clientId) await validatePropertyClientLink(propertyId, clientId);
  if (tenancy && tenancy.data()?.propertyId !== propertyId) {
    throw new PlatformValidationError('The selected tenancy does not belong to the selected property.', 'RELATIONSHIP_MISMATCH', 409);
  }

  const sourceType = text(payload.sourceType ?? existing?.sourceType, 30) || 'manual';
  if (!['tenant_request','client_request','booking','document_request','manual'].includes(sourceType)) {
    throw new PlatformValidationError('Invalid work order source type.');
  }
  const sourceId = optionalText(payload.sourceId ?? existing?.sourceId, 160);
  if (sourceId && sourceType !== 'manual') {
    const sourceCollection = {
      tenant_request: 'tenantRequests',
      client_request: 'clientRequests',
      booking: 'bookings',
      document_request: 'documentRequests',
    }[sourceType];
    if (sourceCollection) await requireDocument(sourceCollection, sourceId, 'Source record');
  }

  const priority = text(payload.priority ?? existing?.priority, 20) || 'routine';
  if (!['routine','priority','urgent','emergency'].includes(priority)) throw new PlatformValidationError('Invalid work order priority.');
  const status = text(payload.status ?? existing?.status, 30) || 'triage';
  if (!['triage','quote_required','awaiting_approval','approved','assigned','scheduled','in_progress','report_pending','completed','cancelled'].includes(status)) {
    throw new PlatformValidationError('Invalid work order status.');
  }
  const now = nowIso();
  const previousAssigned = optionalText(existing?.assignedStaffId, 160);
  return {
    reference: text(payload.reference ?? existing?.reference, 80) || reference('WO'),
    sourceType: sourceType as WorkOrder['sourceType'],
    sourceId,
    propertyId,
    clientId,
    tenancyId,
    assignedStaffId,
    title: requiredText(payload.title ?? existing?.title, 'Work order title', 240),
    description: requiredText(payload.description ?? existing?.description ?? payload.notes, 'Work order description', 5000),
    priority: priority as WorkOrder['priority'],
    status: status as WorkOrder['status'],
    contractorId: optionalText(payload.contractorId ?? existing?.contractorId, 160),
    quoteAmountExGst: payload.quoteAmountExGst === undefined && existing?.quoteAmountExGst === undefined
      ? undefined
      : numberValue(payload.quoteAmountExGst ?? existing?.quoteAmountExGst, 'Quote amount'),
    quoteDocumentId: optionalText(payload.quoteDocumentId ?? existing?.quoteDocumentId, 160),
    invoiceDocumentId: optionalText(payload.invoiceDocumentId ?? existing?.invoiceDocumentId, 160),
    approvalId: optionalText(payload.approvalId ?? existing?.approvalId, 160),
    scheduledStart: optionalText(payload.scheduledStart ?? existing?.scheduledStart, 50),
    scheduledEnd: optionalText(payload.scheduledEnd ?? existing?.scheduledEnd, 50),
    accessNotes: optionalText(payload.accessNotes ?? existing?.accessNotes, 3000),
    completionNotes: optionalText(payload.completionNotes ?? existing?.completionNotes, 5000),
    completionDocumentIds: payload.completionDocumentIds === undefined
      ? stringArray(existing?.completionDocumentIds)
      : stringArray(payload.completionDocumentIds),
    createdBy: text(existing?.createdBy, 160) || actorId,
    assignedAt: assignedStaffId && assignedStaffId !== previousAssigned ? now : optionalText(existing?.assignedAt, 50),
    completedAt: status === 'completed' ? optionalText(existing?.completedAt, 50) || now : optionalText(existing?.completedAt, 50),
    ...baseTimes(existing),
  };
}

async function validateSubscription(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<Subscription, 'id'>> {
  const clientId = requiredText(payload.clientId ?? existing?.clientId, 'Client', 160);
  const propertyId = optionalText(payload.propertyId ?? existing?.propertyId, 160);
  await requireDocument('clients', clientId, 'Client');
  await optionalDocument('properties', propertyId, 'Property');
  if (propertyId) await validatePropertyClientLink(propertyId, clientId);
  const status = text(payload.status ?? existing?.status, 20) || 'active';
  if (!['active','paused','ended','cancelled'].includes(status)) throw new PlatformValidationError('Invalid subscription status.');
  const allowanceInput = Array.isArray(payload.allowances)
    ? payload.allowances
    : Array.isArray(existing?.allowances) ? existing?.allowances : [];
  const allowances = (allowanceInput as unknown[]).map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const unit = text(row.unit, 20) || 'other';
    if (!['hours','jobs','reports','requests','other'].includes(unit)) {
      throw new PlatformValidationError('Invalid subscription allowance unit.');
    }
    return {
      code: requiredText(row.code, 'Allowance code', 80),
      name: requiredText(row.name, 'Allowance name', 160),
      includedUnits: numberValue(row.includedUnits, 'Included units'),
      unit: unit as Subscription['allowances'][number]['unit'],
      usedUnits: row.usedUnits === undefined ? 0 : numberValue(row.usedUnits, 'Used units'),
    };
  });
  return {
    clientId,
    propertyId,
    planCode: requiredText(payload.planCode ?? existing?.planCode, 'Plan code', 80),
    name: requiredText(payload.name ?? existing?.name, 'Subscription name', 160),
    monthlyFeeExGst: numberValue(payload.monthlyFeeExGst ?? existing?.monthlyFeeExGst, 'Monthly fee'),
    status: status as Subscription['status'],
    startDate: requiredText(payload.startDate ?? existing?.startDate, 'Start date', 30),
    endDate: optionalText(payload.endDate ?? existing?.endDate, 30),
    allowances,
    xeroContactId: optionalText(payload.xeroContactId ?? existing?.xeroContactId, 160),
    invoiceReference: optionalText(payload.invoiceReference ?? existing?.invoiceReference, 160),
    notes: optionalText(payload.notes ?? existing?.notes, 3000),
    ...baseTimes(existing),
  };
}

async function validatePayment(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>
): Promise<Omit<PaymentRecord, 'id'>> {
  const clientId = optionalText(payload.clientId ?? existing?.clientId, 160);
  const propertyId = optionalText(payload.propertyId ?? existing?.propertyId, 160);
  await optionalDocument('clients', clientId, 'Client');
  await optionalDocument('properties', propertyId, 'Property');
  if (clientId && propertyId) await validatePropertyClientLink(propertyId, clientId);

  const sourceType = text(payload.sourceType ?? existing?.sourceType, 30) || 'other';
  if (!['booking','document_request','work_order','subscription','other'].includes(sourceType)) {
    throw new PlatformValidationError('Invalid payment source type.');
  }
  const sourceId = requiredText(payload.sourceId ?? existing?.sourceId, 'Payment source', 160);
  const sourceCollection = {
    booking: 'bookings',
    document_request: 'documentRequests',
    work_order: 'workOrders',
    subscription: 'subscriptions',
  }[sourceType];
  if (sourceCollection) await requireDocument(sourceCollection, sourceId, 'Payment source');

  const status = text(payload.status ?? existing?.status, 30) || 'pending';
  if (!['pending','payment_required','paid','failed','refunded','waived'].includes(status)) throw new PlatformValidationError('Invalid payment status.');
  const provider = text(payload.provider ?? existing?.provider, 20) || 'manual';
  if (!['manual','external','xero'].includes(provider)) throw new PlatformValidationError('Invalid payment provider.');
  const amountExGst = numberValue(payload.amountExGst ?? existing?.amountExGst, 'Amount ex GST');
  const gstAmount = payload.gstAmount === undefined && existing?.gstAmount === undefined
    ? Math.round(amountExGst * 0.1 * 100) / 100
    : numberValue(payload.gstAmount ?? existing?.gstAmount, 'GST amount');
  const totalAmount = payload.totalAmount === undefined && existing?.totalAmount === undefined
    ? Math.round((amountExGst + gstAmount) * 100) / 100
    : numberValue(payload.totalAmount ?? existing?.totalAmount, 'Total amount');
  return {
    reference: text(payload.reference ?? existing?.reference, 80) || reference('PAY'),
    clientId,
    propertyId,
    sourceType: sourceType as PaymentRecord['sourceType'],
    sourceId,
    description: requiredText(payload.description ?? existing?.description, 'Payment description', 500),
    amountExGst,
    gstAmount,
    totalAmount,
    currency: 'AUD',
    status: status as PaymentRecord['status'],
    provider: provider as PaymentRecord['provider'],
    checkoutUrl: optionalText(payload.checkoutUrl ?? existing?.checkoutUrl, 1000),
    providerOrderId: optionalText(payload.providerOrderId ?? existing?.providerOrderId, 200),
    invoiceReference: optionalText(payload.invoiceReference ?? existing?.invoiceReference, 200),
    paidAt: optionalText(payload.paidAt ?? existing?.paidAt, 50),
    ...baseTimes(existing),
  };
}

async function validateCommunication(
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>,
  actorId = 'system'
): Promise<Omit<CommunicationRecord, 'id'>> {
  const clientId = optionalText(payload.clientId ?? existing?.clientId, 160);
  const propertyId = optionalText(payload.propertyId ?? existing?.propertyId, 160);
  const tenancyId = optionalText(payload.tenancyId ?? existing?.tenancyId, 160);
  const bookingId = optionalText(payload.bookingId ?? existing?.bookingId, 160);
  const workOrderId = optionalText(payload.workOrderId ?? existing?.workOrderId, 160);
  await optionalDocument('clients', clientId, 'Client');
  await optionalDocument('properties', propertyId, 'Property');
  await optionalDocument('tenancies', tenancyId, 'Tenancy');
  await optionalDocument('bookings', bookingId, 'Booking');
  await optionalDocument('workOrders', workOrderId, 'Work order');

  const channel = text(payload.channel ?? existing?.channel, 20) || 'internal';
  const direction = text(payload.direction ?? existing?.direction, 20) || 'internal';
  const status = text(payload.status ?? existing?.status, 20) || 'logged';
  if (!['email','phone','sms','portal','internal'].includes(channel)) throw new PlatformValidationError('Invalid communication channel.');
  if (!['outbound','inbound','internal'].includes(direction)) throw new PlatformValidationError('Invalid communication direction.');
  if (!['draft','queued','sent','failed','received','logged'].includes(status)) throw new PlatformValidationError('Invalid communication status.');
  return {
    title: requiredText(payload.title ?? existing?.title, 'Communication title', 240),
    clientId,
    propertyId,
    tenancyId,
    bookingId,
    workOrderId,
    recipient: requiredText(payload.recipient ?? existing?.recipient, 'Recipient', 254),
    channel: channel as CommunicationRecord['channel'],
    direction: direction as CommunicationRecord['direction'],
    status: status as CommunicationRecord['status'],
    body: requiredText(payload.body ?? existing?.body, 'Communication body', 10000),
    providerMessageId: optionalText(payload.providerMessageId ?? existing?.providerMessageId, 240),
    error: optionalText(payload.error ?? existing?.error, 2000),
    createdBy: text(existing?.createdBy, 160) || actorId,
    ...baseTimes(existing),
  };
}

export async function validatePlatformResource<R extends PlatformResourceName>(
  resource: R,
  payload: Record<string, unknown>,
  existing?: Record<string, unknown>,
  actorId?: string
): Promise<Omit<PlatformCollectionMap[R], 'id'>> {
  switch (resource) {
    case 'clients': return validateClient(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'clientUsers': return validateClientUser(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'clientMemberships': return validateClientMembership(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'properties': return validateProperty(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'clientPropertyLinks': return validateClientPropertyLink(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'tenancies': return validateTenancy(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'tenantUsers': return validateTenantUser(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'propertyDocuments': return validateDocument(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'documentRequests': return validateDocumentRequest(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'workOrders': return validateWorkOrder(payload, existing, actorId) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'subscriptions': return validateSubscription(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'payments': return validatePayment(payload, existing) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
    case 'communications': return validateCommunication(payload, existing, actorId) as Promise<Omit<PlatformCollectionMap[R], 'id'>>;
  }
}

export async function listPlatformResources<R extends PlatformResourceName>(
  resource: R,
  limit = 500
): Promise<PlatformCollectionMap[R][]> {
  const collection = adminDb.collection(resource);
  const snapshot = await collection
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 500))
    .get()
    .catch(async () => collection.limit(Math.min(Math.max(limit, 1), 500)).get());
  return snapshot.docs.map((doc) => docWithId<PlatformCollectionMap[R]>(doc));
}

export async function getPlatformResource<R extends PlatformResourceName>(
  resource: R,
  id: string
): Promise<PlatformCollectionMap[R] | null> {
  const doc = await adminDb.collection(resource).doc(id).get();
  return doc.exists ? docWithId<PlatformCollectionMap[R]>(doc) : null;
}

async function syncClientUserMembershipCache(userId: string) {
  const [userDoc, membershipSnap] = await Promise.all([
    adminDb.collection('clientUsers').doc(userId).get(),
    adminDb.collection('clientMemberships').where('clientUserId', '==', userId).get(),
  ]);
  if (!userDoc.exists) return;
  const active = membershipSnap.docs
    .map((doc) => docWithId<ClientMembership>(doc))
    .filter((membership) => membership.status === 'active');
  const clientIds = active.map((membership) => membership.clientId);
  const clientRoles = Object.fromEntries(active.map((membership) => [membership.clientId, membership.role]));
  await userDoc.ref.set({ clientIds, clientRoles, updatedAt: nowIso() }, { merge: true });
}

export async function createPlatformResource<R extends PlatformResourceName>(
  resource: R,
  payload: Record<string, unknown>,
  actorId = 'system'
): Promise<PlatformCollectionMap[R]> {
  const ref = adminDb.collection(resource).doc();
  const validated = await validatePlatformResource(resource, payload, undefined, actorId);
  const record = { id: ref.id, ...validated } as PlatformCollectionMap[R];
  await ref.set(record);

  if (resource === 'clientMemberships') {
    await syncClientUserMembershipCache((record as ClientMembership).clientUserId);
  }
  if (resource === 'clientPropertyLinks' && (record as ClientPropertyLink).primary) {
    const link = record as ClientPropertyLink;
    await adminDb.collection('properties').doc(link.propertyId).set(
      { primaryClientId: link.clientId, updatedAt: nowIso() },
      { merge: true }
    );
  }
  return record;
}

export async function updatePlatformResource<R extends PlatformResourceName>(
  resource: R,
  id: string,
  payload: Record<string, unknown>,
  actorId = 'system'
): Promise<PlatformCollectionMap[R] | null> {
  const ref = adminDb.collection(resource).doc(id);
  const current = await ref.get();
  if (!current.exists) return null;
  const existing = { ...(current.data() || {}), id } as Record<string, unknown>;
  const validated = await validatePlatformResource(resource, payload, existing, actorId);
  await ref.set(validated, { merge: true });
  const updated = await ref.get();
  const record = docWithId<PlatformCollectionMap[R]>(updated);

  if (resource === 'clientMemberships') {
    await syncClientUserMembershipCache((record as ClientMembership).clientUserId);
  }
  if (resource === 'clientPropertyLinks' && (record as ClientPropertyLink).primary) {
    const link = record as ClientPropertyLink;
    await adminDb.collection('properties').doc(link.propertyId).set(
      { primaryClientId: link.clientId, updatedAt: nowIso() },
      { merge: true }
    );
  }
  return record;
}

export async function archivePlatformResource<R extends PlatformResourceName>(
  resource: R,
  id: string,
  actorId = 'system'
): Promise<PlatformCollectionMap[R] | null> {
  const current = await getPlatformResource(resource, id);
  if (!current) return null;

  const patch: Record<string, unknown> = {};
  switch (resource) {
    case 'clients':
    case 'properties':
      patch.status = 'inactive';
      patch.archivedAt = nowIso();
      break;
    case 'clientUsers':
    case 'clientPropertyLinks':
    case 'tenantUsers':
      patch.active = false;
      break;
    case 'clientMemberships':
      patch.status = 'revoked';
      break;
    case 'tenancies':
      patch.status = 'ended';
      patch.endDate = (current as TenancyRecord).endDate || nowIso().slice(0, 10);
      break;
    case 'propertyDocuments':
      patch.status = 'archived';
      break;
    case 'documentRequests':
    case 'workOrders':
      patch.status = 'cancelled';
      break;
    case 'subscriptions':
      patch.status = 'ended';
      break;
    case 'payments':
      patch.status = 'waived';
      break;
    case 'communications':
      patch.status = 'logged';
      break;
  }
  return updatePlatformResource(resource, id, patch, actorId);
}

export async function writeAuditEvent(input: {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  summary: string;
  actor: AuditActor;
  propertyId?: string;
  clientId?: string;
  tenancyId?: string;
  metadata?: AuditEvent['metadata'];
}): Promise<AuditEvent> {
  const ref = adminDb.collection('auditEvents').doc();
  const event: AuditEvent = {
    id: ref.id,
    ...input,
    createdAt: nowIso(),
  };
  await ref.set(event);
  return event;
}

export async function listAuditEvents(limit = 250): Promise<AuditEvent[]> {
  const snapshot = await adminDb
    .collection('auditEvents')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 500))
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Partial<AuditEvent> & Record<string, unknown>;
    if (data.actor && data.entityType && data.entityId) return docWithId<AuditEvent>(doc);

    // Compatibility with audit events created by the first Admin Portal iteration.
    return {
      id: doc.id,
      entityType: (text(data.resourceType, 50) || 'staff') as AuditEntityType,
      entityId: text(data.resourceId, 160) || doc.id,
      action: text(data.action, 120) || 'updated',
      summary: text(data.summary, 500) || 'Administrative change',
      actor: {
        type: 'staff',
        id: text(data.actorUid, 160) || undefined,
        email: text(data.actorEmail, 254) || undefined,
      },
      metadata: data.metadata && typeof data.metadata === 'object'
        ? data.metadata as AuditEvent['metadata']
        : undefined,
      createdAt: text(data.createdAt, 50) || nowIso(),
    };
  });
}
