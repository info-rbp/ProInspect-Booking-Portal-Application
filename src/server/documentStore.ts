import { randomBytes } from 'crypto';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { DEFAULT_DOCUMENT_PRODUCTS } from '../documents/defaultDocumentProducts.js';
import type { ServiceCategory } from '../types/booking.js';
import type {
  AuditActor,
  DocumentProduct,
  DocumentRequest,
  DocumentRequestStatus,
} from '../types/platform.js';
import { createPaymentRecord, writeAuditEvent } from './platformStore.js';

function docWithId<T>(doc: DocumentSnapshot): T {
  return { ...(doc.data() as object), id: doc.id } as T;
}
function nowIso() { return new Date().toISOString(); }
function requestReference() {
  const date = new Date().toISOString().slice(0,10).replaceAll('-','');
  return `DR-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

let seeded: Promise<void> | null = null;
export async function ensureDocumentProducts() {
  if (!seeded) {
    seeded = (async () => {
      const refs = DEFAULT_DOCUMENT_PRODUCTS.map((p) => adminDb.collection('documentProducts').doc(p.id));
      const docs = await Promise.all(refs.map((ref) => ref.get()));
      const batch = adminDb.batch();
      let writes = false;
      docs.forEach((doc, index) => {
        if (!doc.exists) {
          batch.set(refs[index], DEFAULT_DOCUMENT_PRODUCTS[index]);
          writes = true;
        }
      });
      if (writes) await batch.commit();
    })().catch((error) => {
      seeded = null;
      throw error;
    });
  }
  await seeded;
}

export async function listDocumentProducts(publicOnly = false): Promise<DocumentProduct[]> {
  await ensureDocumentProducts();
  const snap = await adminDb.collection('documentProducts').orderBy('order').get();
  const products = snap.docs.map((doc) => docWithId<DocumentProduct>(doc));
  return publicOnly ? products.filter((p) => p.active && p.publiclyRequestable) : products;
}

export async function getDocumentProduct(id: string): Promise<DocumentProduct | null> {
  await ensureDocumentProducts();
  const doc = await adminDb.collection('documentProducts').doc(id).get();
  return doc.exists ? docWithId<DocumentProduct>(doc) : null;
}

export async function createDocumentRequest(input: {
  id?: string;
  reference?: string;
  product: DocumentProduct;
  documentName?: string;
  category: ServiceCategory;
  propertyId?: string;
  clientId?: string;
  clientUserId?: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  address: DocumentRequest['address'];
  notes?: string;
  workflow?: DocumentRequest['workflow'];
}): Promise<DocumentRequest> {
  const ref = input.id
    ? adminDb.collection('documentRequests').doc(input.id)
    : adminDb.collection('documentRequests').doc();
  const now = nowIso();
  const request: DocumentRequest = {
    id: ref.id,
    reference: input.reference || requestReference(),
    documentProductId: input.product.id,
    documentName: input.documentName || input.product.name,
    documentCategory: input.category,
    pricingMode: input.product.pricingMode,
    priceExGst: input.product.priceExGst,
    propertyId: input.propertyId,
    clientId: input.clientId,
    clientUserId: input.clientUserId,
    requesterName: input.requesterName,
    requesterEmail: input.requesterEmail,
    requesterPhone: input.requesterPhone,
    address: input.address,
    notes: input.notes,
    workflow: input.workflow,
    status: 'submitted',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(request);

  if (request.pricingMode === 'fixed' && request.priceExGst) {
    const payment = await createPaymentRecord({
      clientId: request.clientId,
      propertyId: request.propertyId,
      sourceType: 'document_request',
      sourceId: request.id,
      description: request.documentName,
      amountExGst: request.priceExGst,
      provider: 'manual',
    });
    request.paymentId = payment.id;
    await ref.set({ paymentId: payment.id }, { merge: true });
  }

  await writeAuditEvent({
    entityType: 'document_request',
    entityId: request.id,
    action: 'submitted',
    summary: `${request.reference} submitted for ${request.documentName}.`,
    actor: input.clientUserId
      ? { type:'client', id:input.clientUserId, email:input.requesterEmail }
      : { type:'system', email:input.requesterEmail },
    propertyId: request.propertyId,
    clientId: request.clientId,
  });
  return request;
}

export async function updateDocumentRequest(
  id: string,
  changes: {
    status?: DocumentRequestStatus;
    generatedDocumentId?: string;
    propertyId?: string;
    clientId?: string;
  },
  actor: AuditActor
): Promise<DocumentRequest | null> {
  const ref = adminDb.collection('documentRequests').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const current = docWithId<DocumentRequest>(doc);
  const updatedAt = nowIso();
  await ref.set({ ...changes, updatedAt }, { merge:true });
  const updated = { ...current, ...changes, updatedAt };
  await writeAuditEvent({
    entityType:'document_request',
    entityId:id,
    action:'updated',
    summary:`${current.reference} updated${changes.status ? ` to ${changes.status}` : ''}.`,
    actor,
    propertyId: updated.propertyId,
    clientId: updated.clientId,
  });
  return updated;
}

export async function listDocumentRequestsForClient(clientIds: string[]): Promise<DocumentRequest[]> {
  if (!clientIds.length) return [];
  const snaps = await Promise.all(clientIds.map((clientId) =>
    adminDb.collection('documentRequests').where('clientId','==',clientId).get()
  ));
  const map = new Map<string,DocumentRequest>();
  snaps.forEach((snap)=>snap.docs.forEach((doc)=>map.set(doc.id,docWithId<DocumentRequest>(doc))));
  return Array.from(map.values()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
