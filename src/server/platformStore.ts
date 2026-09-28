import { randomBytes } from 'crypto';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type {
  AuditActor,
  AuditEvent,
  ClientApproval,
  ClientMembership,
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
  Contractor,
  DocumentProduct,
  DocumentRequest,
  DocumentRequestStatus,
  OperationsQueueItem,
  PaymentRecord,
  PaymentStatus,
  PortalNotification,
  UnifiedClientDashboard,
  WorkOrder,
  WorkOrderStatus,
} from '../types/platform.js';
import type {
  ClientPropertyLink,
  ClientRecord,
  ClientUserRecord,
  PortalAudience,
  TenantDocument,
  TenantProperty,
} from '../types/tenant.js';
import type { BookingRecord } from '../types/booking.js';

function nowIso() {
  return new Date().toISOString();
}

function docWithId<T>(doc: DocumentSnapshot): T {
  return { ...(doc.data() as object), id: doc.id } as T;
}

function reference(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function writeAuditEvent(input: {
  entityType: AuditEvent['entityType'];
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

export async function listAuditEvents(params: {
  entityType?: AuditEvent['entityType'];
  entityId?: string;
  propertyId?: string;
  limit?: number;
}): Promise<AuditEvent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection('auditEvents');
  if (params.entityType) query = query.where('entityType', '==', params.entityType);
  if (params.entityId) query = query.where('entityId', '==', params.entityId);
  if (params.propertyId) query = query.where('propertyId', '==', params.propertyId);
  const snapshot = await query.orderBy('createdAt', 'desc').limit(params.limit || 100).get();
  return snapshot.docs.map((doc) => docWithId<AuditEvent>(doc));
}

export async function createNotification(input: Omit<PortalNotification, 'id' | 'createdAt'>) {
  const ref = adminDb.collection('portalNotifications').doc();
  const notification: PortalNotification = {
    id: ref.id,
    ...input,
    createdAt: nowIso(),
  };
  await ref.set(notification);
  return notification;
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const ref = adminDb.collection('portalNotifications').doc(notificationId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = docWithId<PortalNotification>(doc);
  const owns =
    data.clientUserId === userId ||
    data.tenantUserId === userId;
  if (!owns) return null;
  const readAt = nowIso();
  await ref.set({ readAt }, { merge: true });
  return { ...data, readAt };
}

export async function listClientNotifications(user: ClientUserRecord): Promise<PortalNotification[]> {
  const snapshot = await adminDb
    .collection('portalNotifications')
    .where('clientUserId', '==', user.id)
    .limit(100)
    .get();
  return snapshot.docs
    .map((doc) => docWithId<PortalNotification>(doc))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createClientRequestRecord(input: {
  clientUser: ClientUserRecord;
  clientId: string;
  propertyId?: string;
  type: ClientRequestType;
  title: string;
  details: string;
  priority?: ClientRequest['priority'];
  payload?: ClientRequest['payload'];
}): Promise<ClientRequest> {
  if (!input.clientUser.clientIds.includes(input.clientId)) {
    throw new Error('CLIENT_NOT_AUTHORISED');
  }
  const requestRole = input.clientUser.clientRoles?.[input.clientId] || 'member';
  if (requestRole === 'viewer') {
    throw new Error('CLIENT_ROLE_FORBIDDEN');
  }

  if (input.propertyId) {
    const links = await adminDb
      .collection('clientPropertyLinks')
      .where('clientId', '==', input.clientId)
      .where('propertyId', '==', input.propertyId)
      .limit(1)
      .get();
    if (links.empty || (links.docs[0].data() as ClientPropertyLink).active === false) {
      throw new Error('PROPERTY_NOT_AUTHORISED');
    }
  }

  const ref = adminDb.collection('clientRequests').doc();
  const now = nowIso();
  const request: ClientRequest = {
    id: ref.id,
    reference: reference('CR'),
    clientUserId: input.clientUser.id,
    clientId: input.clientId,
    propertyId: input.propertyId,
    type: input.type,
    title: input.title,
    details: input.details,
    priority: input.priority || 'routine',
    status: 'submitted',
    payload: input.payload || {},
    attachmentDocumentIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(request);

  await writeAuditEvent({
    entityType: 'client_request',
    entityId: request.id,
    action: 'submitted',
    summary: `Client request ${request.reference} submitted.`,
    actor: { type: 'client', id: input.clientUser.id, email: input.clientUser.email },
    clientId: request.clientId,
    propertyId: request.propertyId,
  });

  await createNotification({
    audience: 'client',
    clientUserId: input.clientUser.id,
    clientId: request.clientId,
    propertyId: request.propertyId,
    title: 'Request received',
    message: `${request.reference} has been received by ProInspect.`,
    link: '/client/requests',
  });

  return request;
}

export async function updateClientRequestRecord(
  requestId: string,
  changes: { status?: ClientRequestStatus; adminNotes?: string },
  actor: AuditActor
): Promise<ClientRequest | null> {
  const ref = adminDb.collection('clientRequests').doc(requestId);
  const current = await ref.get();
  if (!current.exists) return null;
  const existing = docWithId<ClientRequest>(current);
  const updatedAt = nowIso();
  await ref.set({ ...changes, updatedAt }, { merge: true });
  const updated = { ...existing, ...changes, updatedAt };

  if (changes.status && changes.status !== existing.status) {
    await writeAuditEvent({
      entityType: 'client_request',
      entityId: requestId,
      action: 'status_changed',
      summary: `Status changed from ${existing.status} to ${changes.status}.`,
      actor,
      clientId: existing.clientId,
      propertyId: existing.propertyId,
    });
    await createNotification({
      audience: 'client',
      clientUserId: existing.clientUserId,
      clientId: existing.clientId,
      propertyId: existing.propertyId,
      title: 'Request updated',
      message: `${existing.reference} is now ${changes.status.replaceAll('_', ' ')}.`,
      link: '/client/requests',
    });
  }

  return updated;
}

export async function listClientRequestsForUser(user: ClientUserRecord): Promise<ClientRequest[]> {
  if (!user.clientIds.length) return [];
  const results = await Promise.all(
    user.clientIds.map((clientId) =>
      adminDb.collection('clientRequests').where('clientId', '==', clientId).get()
    )
  );
  const map = new Map<string, ClientRequest>();
  results.forEach((snap) =>
    snap.docs.forEach((doc) => map.set(doc.id, docWithId<ClientRequest>(doc)))
  );
  return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listClientApprovals(user: ClientUserRecord): Promise<ClientApproval[]> {
  if (!user.clientIds.length) return [];
  const results = await Promise.all(
    user.clientIds.map((clientId) =>
      adminDb.collection('clientApprovals').where('clientId', '==', clientId).get()
    )
  );
  const map = new Map<string, ClientApproval>();
  results.forEach((snap) =>
    snap.docs.forEach((doc) => map.set(doc.id, docWithId<ClientApproval>(doc)))
  );
  return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createApproval(input: Omit<ClientApproval, 'id' | 'reference' | 'status' | 'requestedAt' | 'updatedAt'>) {
  const ref = adminDb.collection('clientApprovals').doc();
  const now = nowIso();
  const approval: ClientApproval = {
    id: ref.id,
    reference: reference('AP'),
    ...input,
    status: 'pending',
    requestedAt: now,
    updatedAt: now,
  };
  await ref.set(approval);
  await writeAuditEvent({
    entityType: 'approval',
    entityId: approval.id,
    action: 'requested',
    summary: `${approval.reference} requested: ${approval.title}`,
    actor: { type: 'staff', email: input.requestedBy },
    clientId: approval.clientId,
    propertyId: approval.propertyId,
  });
  return approval;
}

export async function respondApproval(params: {
  approvalId: string;
  user: ClientUserRecord;
  status: 'approved' | 'approved_with_conditions' | 'changes_requested' | 'declined';
  comment?: string;
}): Promise<ClientApproval | null> {
  const ref = adminDb.collection('clientApprovals').doc(params.approvalId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const approval = docWithId<ClientApproval>(doc);
  if (!params.user.clientIds.includes(approval.clientId)) throw new Error('CLIENT_NOT_AUTHORISED');
  const approvalRole = params.user.clientRoles?.[approval.clientId] || 'member';
  if (!['owner', 'admin'].includes(approvalRole)) {
    throw new Error('CLIENT_APPROVAL_FORBIDDEN');
  }
  if (params.status === 'approved_with_conditions' && !params.comment?.trim()) {
    throw new Error('APPROVAL_CONDITIONS_REQUIRED');
  }

  const respondedAt = nowIso();
  const patch = {
    status: params.status,
    responseComment: params.comment,
    respondedBy: params.user.id,
    respondedAt,
    updatedAt: respondedAt,
  };
  await ref.set(patch, { merge: true });
  const updated = { ...approval, ...patch };

  await writeAuditEvent({
    entityType: 'approval',
    entityId: approval.id,
    action: params.status,
    summary: `${approval.reference} was ${params.status.replaceAll('_', ' ')}.`,
    actor: { type: 'client', id: params.user.id, email: params.user.email },
    clientId: approval.clientId,
    propertyId: approval.propertyId,
  });

  if (approval.workOrderId && params.status === 'approved') {
    await adminDb.collection('workOrders').doc(approval.workOrderId).set(
      { status: 'approved', updatedAt: respondedAt },
      { merge: true }
    );
  }

  if (approval.requestId) {
    const tenantFormRef = adminDb.collection('tenantFormRequests').doc(approval.requestId);
    const tenantFormDoc = await tenantFormRef.get();
    if (tenantFormDoc.exists) {
      const mappedStatus =
        params.status === 'approved'
          ? 'approved'
          : params.status === 'changes_requested'
            ? 'action_required'
            : 'under_review';
      await tenantFormRef.set(
        {
          status: mappedStatus,
          respondedAt,
          responseOutcome: params.status,
          ...(params.comment ? { clientResponseComment: params.comment.trim() } : {}),
          updatedAt: respondedAt,
        },
        { merge: true }
      );

      const tenantForm = tenantFormDoc.data() as {
        tenantUserId?: string;
        clientId?: string;
        propertyId?: string;
        reference?: string;
        formName?: string;
      };
      if (tenantForm.tenantUserId) {
        await createNotification({
          audience: 'tenant',
          tenantUserId: tenantForm.tenantUserId,
          clientId: tenantForm.clientId,
          propertyId: tenantForm.propertyId,
          title: 'Tenancy form updated',
          message: `${tenantForm.reference || 'Your tenancy form'} is now ${mappedStatus.replaceAll('_', ' ')}.`,
          link: '/tenant',
        });
      }
    }
  }

  return updated;
}

export async function createContractor(input: {
  name: string;
  trade?: string;
  email?: string;
  phone?: string;
  notes?: string;
}): Promise<Contractor> {
  const ref = adminDb.collection('contractors').doc();
  const now = nowIso();
  const contractor: Contractor = {
    id: ref.id,
    ...input,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(contractor);
  return contractor;
}

export async function listContractors(): Promise<Contractor[]> {
  const snapshot = await adminDb.collection('contractors').orderBy('name').get();
  return snapshot.docs.map((doc) => docWithId<Contractor>(doc));
}

export async function createWorkOrder(input: {
  sourceType: WorkOrder['sourceType'];
  sourceId?: string;
  propertyId: string;
  clientId?: string;
  tenancyId?: string;
  title: string;
  description: string;
  priority?: WorkOrder['priority'];
  accessNotes?: string;
  createdBy: string;
}): Promise<WorkOrder> {
  const property = await adminDb.collection('properties').doc(input.propertyId).get();
  if (!property.exists) throw new Error('PROPERTY_NOT_FOUND');

  const ref = adminDb.collection('workOrders').doc();
  const now = nowIso();
  const workOrder: WorkOrder = {
    id: ref.id,
    reference: reference('WO'),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    propertyId: input.propertyId,
    clientId: input.clientId,
    tenancyId: input.tenancyId,
    title: input.title,
    description: input.description,
    priority: input.priority || 'routine',
    status: 'triage',
    accessNotes: input.accessNotes,
    completionDocumentIds: [],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(workOrder);

  await writeAuditEvent({
    entityType: 'work_order',
    entityId: workOrder.id,
    action: 'created',
    summary: `${workOrder.reference} created.`,
    actor: { type: 'staff', email: input.createdBy },
    propertyId: input.propertyId,
    clientId: input.clientId,
    tenancyId: input.tenancyId,
  });

  return workOrder;
}

export async function updateWorkOrder(
  workOrderId: string,
  changes: {
    status?: WorkOrderStatus;
    contractorId?: string;
    quoteAmountExGst?: number;
    quoteDocumentId?: string;
    invoiceDocumentId?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    accessNotes?: string;
    completionNotes?: string;
    completionDocumentIds?: string[];
  },
  actor: AuditActor
): Promise<WorkOrder | null> {
  const ref = adminDb.collection('workOrders').doc(workOrderId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const current = docWithId<WorkOrder>(doc);
  const updatedAt = nowIso();
  const patch: Record<string, unknown> = { ...changes, updatedAt };

  if (changes.contractorId && changes.contractorId !== current.contractorId) {
    patch.assignedAt = updatedAt;
    if (!changes.status) patch.status = 'assigned';
  }
  if (changes.status === 'completed') patch.completedAt = updatedAt;

  await ref.set(patch, { merge: true });
  const updated = { ...current, ...patch } as WorkOrder;

  await writeAuditEvent({
    entityType: 'work_order',
    entityId: workOrderId,
    action: 'updated',
    summary: `${current.reference} updated${changes.status ? ` to ${changes.status}` : ''}.`,
    actor,
    propertyId: current.propertyId,
    clientId: current.clientId,
    tenancyId: current.tenancyId,
  });

  return updated;
}

export async function listWorkOrders(): Promise<WorkOrder[]> {
  const snapshot = await adminDb.collection('workOrders').orderBy('updatedAt', 'desc').limit(500).get();
  return snapshot.docs.map((doc) => docWithId<WorkOrder>(doc));
}

export async function createPaymentRecord(input: {
  clientId?: string;
  propertyId?: string;
  sourceType: PaymentRecord['sourceType'];
  sourceId: string;
  description: string;
  amountExGst: number;
  provider?: PaymentRecord['provider'];
  checkoutUrl?: string;
  providerOrderId?: string;
}): Promise<PaymentRecord> {
  const ref = adminDb.collection('payments').doc();
  const now = nowIso();
  const paymentReference = reference('PAY');
  const gstAmount = Math.round(input.amountExGst * 0.1 * 100) / 100;
  const totalAmount = Math.round((input.amountExGst + gstAmount) * 100) / 100;
  const template = process.env.PAYMENT_CHECKOUT_URL_TEMPLATE?.trim();
  const generatedCheckoutUrl = input.checkoutUrl || (template
    ? template
        .replaceAll('{paymentId}', encodeURIComponent(ref.id))
        .replaceAll('{reference}', encodeURIComponent(paymentReference))
        .replaceAll('{totalAmount}', encodeURIComponent(totalAmount.toFixed(2)))
    : undefined);

  const payment: PaymentRecord = {
    id: ref.id,
    reference: paymentReference,
    clientId: input.clientId,
    propertyId: input.propertyId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    amountExGst: input.amountExGst,
    gstAmount,
    totalAmount,
    currency: 'AUD',
    status: generatedCheckoutUrl ? 'payment_required' : 'pending',
    provider: generatedCheckoutUrl ? (input.provider || 'external') : (input.provider || 'manual'),
    checkoutUrl: generatedCheckoutUrl,
    providerOrderId: input.providerOrderId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(payment);
  return payment;
}

export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  actor: AuditActor
): Promise<PaymentRecord | null> {
  const ref = adminDb.collection('payments').doc(paymentId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const current = docWithId<PaymentRecord>(doc);
  const updatedAt = nowIso();
  const patch = {
    status,
    updatedAt,
    ...(status === 'paid' ? { paidAt: updatedAt } : {}),
  };
  await ref.set(patch, { merge: true });
  const updated = { ...current, ...patch };

  await writeAuditEvent({
    entityType: 'payment',
    entityId: paymentId,
    action: 'status_changed',
    summary: `${current.reference} changed to ${status}.`,
    actor,
    clientId: current.clientId,
    propertyId: current.propertyId,
  });
  return updated;
}

export async function listClientPayments(user: ClientUserRecord): Promise<PaymentRecord[]> {
  if (!user.clientIds.length) return [];
  const results = await Promise.all(
    user.clientIds.map((clientId) =>
      adminDb.collection('payments').where('clientId', '==', clientId).get()
    )
  );
  const map = new Map<string, PaymentRecord>();
  results.forEach((snap) =>
    snap.docs.forEach((doc) => map.set(doc.id, docWithId<PaymentRecord>(doc)))
  );
  return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listAdminOperations(): Promise<{
  queue: OperationsQueueItem[];
  workOrders: WorkOrder[];
  contractors: Contractor[];
  approvals: ClientApproval[];
  clientRequests: ClientRequest[];
  documentRequests: DocumentRequest[];
  payments: PaymentRecord[];
  auditEvents: AuditEvent[];
}> {
  const [bookingSnap, tenantSnap, clientSnap, documentSnap, workOrders, contractors, approvalSnap, propertiesSnap, clientsSnap, paymentSnap, auditSnap] =
    await Promise.all([
      adminDb.collection('bookings').orderBy('updatedAt', 'desc').limit(200).get(),
      adminDb.collection('tenantRequests').orderBy('updatedAt', 'desc').limit(200).get(),
      adminDb.collection('clientRequests').orderBy('updatedAt', 'desc').limit(200).get(),
      adminDb.collection('documentRequests').orderBy('updatedAt', 'desc').limit(200).get(),
      listWorkOrders(),
      listContractors(),
      adminDb.collection('clientApprovals').orderBy('updatedAt', 'desc').limit(200).get(),
      adminDb.collection('properties').limit(500).get(),
      adminDb.collection('clients').limit(500).get(),
      adminDb.collection('payments').orderBy('updatedAt', 'desc').limit(200).get(),
      adminDb.collection('auditEvents').orderBy('createdAt', 'desc').limit(100).get(),
    ]);

  const properties = new Map(
    propertiesSnap.docs.map((doc) => {
      const p = docWithId<TenantProperty>(doc);
      return [p.id, p];
    })
  );
  const clients = new Map(
    clientsSnap.docs.map((doc) => {
      const client = docWithId<ClientRecord>(doc);
      return [client.id, client];
    })
  );

  const clientRequests = clientSnap.docs.map((doc) => docWithId<ClientRequest>(doc));
  const documentRequests = documentSnap.docs.map((doc) => docWithId<DocumentRequest>(doc));
  const approvals = approvalSnap.docs.map((doc) => docWithId<ClientApproval>(doc));
  const payments = paymentSnap.docs.map((doc) => docWithId<PaymentRecord>(doc));
  const auditEvents = auditSnap.docs.map((doc) => docWithId<AuditEvent>(doc));

  const labelProperty = (id?: string) => {
    if (!id) return undefined;
    const p = properties.get(id);
    return p ? `${p.unit ? `${p.unit}, ` : ''}${p.streetAddress}, ${p.suburb}` : id;
  };

  const queue: OperationsQueueItem[] = [];

  bookingSnap.docs.forEach((doc) => {
    const b = docWithId<BookingRecord>(doc);
    if (b.status === 'cancelled') return;
    queue.push({
      id: b.id,
      source: 'booking',
      reference: b.bookingReference,
      title: b.serviceName,
      propertyId: (b as BookingRecord & { propertyId?: string }).propertyId,
      propertyLabel: `${b.property.unit ? `${b.property.unit}, ` : ''}${b.property.streetAddress}, ${b.property.suburb}`,
      priority: 'normal',
      status: b.status,
      dueAt: b.appointment.start,
      updatedAt: b.updatedAt,
    });
  });

  tenantSnap.docs.forEach((doc) => {
    const r = doc.data() as any;
    if (['completed', 'closed', 'declined'].includes(r.status)) return;
    queue.push({
      id: doc.id,
      source: 'tenant_request',
      reference: r.reference || doc.id,
      title: r.title || 'Tenant request',
      propertyId: r.propertyId,
      propertyLabel: labelProperty(r.propertyId),
      clientId: r.clientId,
      clientName: r.clientId ? clients.get(r.clientId)?.name : undefined,
      priority: r.priority === 'emergency' ? 'emergency' : r.priority === 'urgent' ? 'urgent' : 'normal',
      status: r.status,
      updatedAt: r.updatedAt || r.createdAt,
    });
  });

  clientRequests.forEach((r) => {
    if (['completed', 'cancelled'].includes(r.status)) return;
    queue.push({
      id: r.id,
      source: 'client_request',
      reference: r.reference,
      title: r.title,
      propertyId: r.propertyId,
      propertyLabel: labelProperty(r.propertyId),
      clientId: r.clientId,
      clientName: clients.get(r.clientId)?.name,
      priority: r.priority === 'urgent' ? 'urgent' : r.priority === 'priority' ? 'priority' : 'normal',
      status: r.status,
      updatedAt: r.updatedAt,
    });
  });

  documentRequests.forEach((r) => {
    if (['completed', 'cancelled'].includes(r.status)) return;
    queue.push({
      id: r.id,
      source: 'document_request',
      reference: r.reference,
      title: r.documentName,
      propertyId: r.propertyId,
      propertyLabel: r.propertyId ? labelProperty(r.propertyId) : `${r.address.streetAddress}, ${r.address.suburb}`,
      clientId: r.clientId,
      clientName: r.clientId ? clients.get(r.clientId)?.name : undefined,
      priority: 'normal',
      status: r.status,
      updatedAt: r.updatedAt,
    });
  });

  workOrders.forEach((w) => {
    if (['completed', 'cancelled'].includes(w.status)) return;
    queue.push({
      id: w.id,
      source: 'work_order',
      reference: w.reference,
      title: w.title,
      propertyId: w.propertyId,
      propertyLabel: labelProperty(w.propertyId),
      clientId: w.clientId,
      clientName: w.clientId ? clients.get(w.clientId)?.name : undefined,
      priority: w.priority === 'emergency' ? 'emergency' : w.priority === 'urgent' ? 'urgent' : w.priority === 'priority' ? 'priority' : 'normal',
      status: w.status,
      assignedTo: w.contractorId,
      dueAt: w.scheduledStart,
      updatedAt: w.updatedAt,
    });
  });

  approvals.forEach((a) => {
    if (a.status !== 'pending') return;
    queue.push({
      id: a.id,
      source: 'approval',
      reference: a.reference,
      title: a.title,
      propertyId: a.propertyId,
      propertyLabel: labelProperty(a.propertyId),
      clientId: a.clientId,
      clientName: clients.get(a.clientId)?.name,
      priority: 'normal',
      status: a.status,
      updatedAt: a.updatedAt,
    });
  });

  queue.sort((a, b) => {
    const rank = (p: OperationsQueueItem['priority']) =>
      p === 'emergency' ? 4 : p === 'urgent' ? 3 : p === 'priority' ? 2 : 1;
    return rank(b.priority) - rank(a.priority) || b.updatedAt.localeCompare(a.updatedAt);
  });

  return { queue, workOrders, contractors, approvals, clientRequests, documentRequests, payments, auditEvents };
}

export async function buildUnifiedClientDashboard(params: {
  user: ClientUserRecord;
  clients: ClientRecord[];
  properties: TenantProperty[];
  propertyLinks: ClientPropertyLink[];
  documents: TenantDocument[];
}): Promise<UnifiedClientDashboard> {
  const [requests, approvals, payments, notifications, teamSnapshots] = await Promise.all([
    listClientRequestsForUser(params.user),
    listClientApprovals(params.user),
    listClientPayments(params.user),
    listClientNotifications(params.user),
    Promise.all(
      params.user.clientIds.map((clientId) =>
        adminDb.collection('clientUsers').where('clientIds', 'array-contains', clientId).get()
      )
    ),
  ]);

  const teamMap = new Map<string, ClientUserRecord>();
  teamSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((doc) => teamMap.set(doc.id, docWithId<ClientUserRecord>(doc)))
  );
  const teamUsers = Array.from(teamMap.values()).map((member) => ({
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    phone: member.phone,
    active: member.active,
    clientRoles: Object.fromEntries(
      params.user.clientIds
        .filter((clientId) => member.clientIds.includes(clientId))
        .map((clientId) => [clientId, member.clientRoles?.[clientId] || 'member'])
    ),
  }));

  const propertyIds = new Set(params.properties.map((property) => property.id));
  const allowedClientIds = new Set(params.user.clientIds);
  const propertyIdList = Array.from(propertyIds);
  const chunk = <T,>(items: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
      items.slice(index * size, index * size + size)
    );

  const bookingQueries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
    ...params.user.clientIds.map((clientId) =>
      adminDb.collection('bookings').where('clientId', '==', clientId).limit(200).get()
    ),
    ...chunk(propertyIdList, 30).map((ids) =>
      adminDb.collection('bookings').where('propertyId', 'in', ids).limit(200).get()
    ),
    adminDb
      .collection('bookings')
      .where('property.customerEmail', '==', params.user.email)
      .limit(200)
      .get(),
  ];

  const bookingResults = await Promise.allSettled(bookingQueries);
  const bookingMap = new Map<string, BookingRecord>();
  bookingResults.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    result.value.docs.forEach((doc) => {
      const booking = docWithId<BookingRecord>(doc);
      const authorised =
        (booking.clientId ? allowedClientIds.has(booking.clientId) : false) ||
        (booking.propertyId ? propertyIds.has(booking.propertyId) : false) ||
        (!booking.clientId &&
          !booking.propertyId &&
          booking.property.customerEmail.trim().toLowerCase() === params.user.email.trim().toLowerCase());

      if (authorised) bookingMap.set(booking.id, booking);
    });
  });

  const bookings = Array.from(bookingMap.values())
    .sort((a, b) => b.appointment.start.localeCompare(a.appointment.start))
    .map((booking) => ({
      id: booking.id,
      bookingReference: booking.bookingReference,
      propertyId: booking.propertyId,
      serviceName: booking.serviceName,
      status: booking.status,
      appointment: {
        start: booking.appointment.start,
        end: booking.appointment.end,
        dateString: booking.appointment.dateString,
        timeString: booking.appointment.timeString,
      },
      property: {
        streetAddress: booking.property.streetAddress,
        unit: booking.property.unit,
        suburb: booking.property.suburb,
        state: booking.property.state,
        postcode: booking.property.postcode,
      },
    }));

  const memberships: ClientMembership[] = params.user.clientIds.map((clientId) => ({
    clientId,
    role: params.user.clientRoles?.[clientId] || 'member',
    status: 'active',
  }));

  return {
    clientUser: {
      id: params.user.id,
      email: params.user.email,
      displayName: params.user.displayName,
      phone: params.user.phone,
      memberships,
    },
    clients: params.clients,
    properties: params.properties,
    propertyLinks: params.propertyLinks,
    bookings,
    requests,
    documents: params.documents,
    approvals,
    payments,
    notifications,
    teamUsers,
  };
}
