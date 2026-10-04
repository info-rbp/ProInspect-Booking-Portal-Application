import { randomBytes } from 'crypto';
import { getPerthDateKey } from '../utils/dateTime.js';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import type {
  ClientUserRecord,
  TenancyRecord,
  TenantDocument,
  TenantProperty,
  TenantUserRecord,
} from '../types/tenant.js';
import type {
  SensitiveTenantFormRequest,
  SensitiveTenantFormStatus,
  TenantFormAttachment,
  TenantFormCreateInput,
  TenantFormRequest,
  TenantFormStatus,
  TenantFormsDashboard,
} from '../types/tenantForms.js';
import {
  TENANT_FORM_DEFINITIONS,
  getTenantFormDefinition,
} from '../tenantForms/formDefinitions.js';
import {
  createApproval,
  createNotification,
  writeAuditEvent,
} from './platformStore.js';

function nowIso() {
  return new Date().toISOString();
}

let definitionsSeeded: Promise<void> | null = null;

export async function ensureTenantFormDefinitions() {
  if (!definitionsSeeded) {
    definitionsSeeded = (async () => {
      const batch = adminDb.batch();
      TENANT_FORM_DEFINITIONS.forEach((definition) => {
        const ref = adminDb.collection('formDefinitions').doc(definition.id);
        batch.set(
          ref,
          {
            ...definition,
            updatedAt: nowIso(),
          },
          { merge: true }
        );
      });
      await batch.commit();
    })().catch((error) => {
      definitionsSeeded = null;
      throw error;
    });
  }
  await definitionsSeeded;
}

function docWithId<T>(doc: DocumentSnapshot): T {
  return { ...(doc.data() as object), id: doc.id } as T;
}

function makeReference(prefix: string) {
  const datePart = getPerthDateKey(new Date()).replaceAll('-', '');
  return `${prefix}-${datePart}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function textValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function arrayValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function requireText(payload: Record<string, unknown>, key: string, label: string) {
  if (!textValue(payload, key)) throw new Error(`FORM_FIELD_REQUIRED:${label}`);
}

function validateNormalPayload(
  workflowType: TenantFormRequest['workflowType'],
  payload: Record<string, unknown>
) {
  switch (workflowType) {
    case 'furniture_safety':
      requireText(payload, 'furnitureDescription', 'Furniture description');
      requireText(payload, 'location', 'Furniture location');
      if (!['child', 'disability'].includes(textValue(payload, 'safetyReason'))) {
        throw new Error('FORM_FIELD_REQUIRED:Safety reason');
      }
      break;
    case 'pet_request':
      requireText(payload, 'petType', 'Pet type');
      requireText(payload, 'petName', 'Pet name');
      requireText(payload, 'petDescription', 'Pet description');
      break;
    case 'minor_modification':
      requireText(payload, 'modificationType', 'Modification type');
      requireText(payload, 'location', 'Modification location');
      requireText(payload, 'description', 'Modification description');
      break;
    case 'major_modification':
      requireText(payload, 'description', 'Modification description');
      requireText(payload, 'location', 'Modification location');
      break;
    case 'bond_release': {
      const partialRelease = payload.partialRelease === true;
      if (!partialRelease) requireText(payload, 'tenancyEndDate', 'Tenancy end date');

      const totalBondAmount = Number(payload.totalBondAmount);
      if (!Number.isFinite(totalBondAmount) || totalBondAmount <= 0) {
        throw new Error('FORM_FIELD_REQUIRED:Total bond amount');
      }

      const distributions = arrayValue(payload, 'proposedDistributions');
      if (distributions.length === 0) {
        throw new Error('FORM_FIELD_REQUIRED:Proposed bond distribution');
      }

      const distributionTotal = distributions.reduce((sum, item) => {
        if (!item || typeof item !== 'object') return sum;
        const amount = Number((item as Record<string, unknown>).amount);
        return Number.isFinite(amount) && amount >= 0 ? sum + amount : sum;
      }, 0);

      if (Math.abs(distributionTotal - totalBondAmount) > 0.01) {
        throw new Error('BOND_DISTRIBUTION_MISMATCH');
      }
      break;
    }
    case 'bond_variation':
      requireText(payload, 'changeType', 'Bond change type');
      break;
    case 'pcr_response': {
      requireText(payload, 'sourceDocumentId', 'Property Condition Report');
      const responses = arrayValue(payload, 'responses');
      if (responses.length === 0) {
        throw new Error('FORM_FIELD_REQUIRED:PCR responses');
      }
      const invalidDisagreement = responses.some((item) => {
        if (!item || typeof item !== 'object') return true;
        const row = item as Record<string, unknown>;
        const agreement = typeof row.agreement === 'string' ? row.agreement : '';
        const comments = typeof row.comments === 'string' ? row.comments.trim() : '';
        return agreement === 'disagree' && comments.length < 3;
      });
      if (invalidDisagreement) {
        throw new Error('PCR_DISAGREEMENT_COMMENT_REQUIRED');
      }
      break;
    }
  }
}

function deriveResponseStatus(request: TenantFormRequest): TenantFormRequest {
  if (
    request.responseDueAt &&
    new Date(request.responseDueAt).getTime() < Date.now() &&
    ['submitted', 'delivered', 'under_review'].includes(request.status)
  ) {
    return { ...request, status: 'response_period_elapsed' };
  }
  return request;
}

function publicFormRequest(
  request: TenantFormRequest & { attachments?: Array<TenantFormAttachment & { storagePath?: string }> }
): TenantFormRequest {
  const derived = deriveResponseStatus(request);
  return {
    ...derived,
    attachments: (derived.attachments || []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
    })),
    adminNotes: undefined,
  };
}

function adminFormRequest(
  request: TenantFormRequest & { attachments?: Array<TenantFormAttachment & { storagePath?: string }> }
): TenantFormRequest {
  const adminNotes = request.adminNotes;
  return {
    ...publicFormRequest(request),
    adminNotes,
  };
}

async function loadAuthorisedTenancy(
  tenant: TenantUserRecord,
  tenancyId: string,
  options: { allowEnded?: boolean } = {}
): Promise<{ tenancy: TenancyRecord; property: TenantProperty }> {
  if (!tenant.tenancyIds.includes(tenancyId)) throw new Error('TENANCY_NOT_AUTHORISED');
  const tenancyDoc = await adminDb.collection('tenancies').doc(tenancyId).get();
  if (!tenancyDoc.exists) throw new Error('TENANCY_NOT_FOUND');
  const tenancy = docWithId<TenancyRecord>(tenancyDoc);
  if (tenancy.status === 'ended' && !options.allowEnded) throw new Error('TENANCY_ENDED');

  const propertyDoc = await adminDb.collection('properties').doc(tenancy.propertyId).get();
  if (!propertyDoc.exists) throw new Error('PROPERTY_NOT_FOUND');
  return { tenancy, property: docWithId<TenantProperty>(propertyDoc) };
}

async function resolveClientId(tenancy: TenancyRecord, property: TenantProperty) {
  if (tenancy.clientId) return tenancy.clientId;
  if (property.primaryClientId) return property.primaryClientId;

  const links = await adminDb
    .collection('clientPropertyLinks')
    .where('propertyId', '==', property.id)
    .get();
  const active = links.docs
    .map((doc) => doc.data() as { clientId?: string; active?: boolean; primary?: boolean })
    .filter((link) => link.active !== false && link.clientId);
  return active.find((link) => link.primary)?.clientId || active[0]?.clientId;
}

async function notifyClientUsers(params: {
  clientId: string;
  propertyId: string;
  title: string;
  message: string;
}) {
  const users = await adminDb
    .collection('clientUsers')
    .where('clientIds', 'array-contains', params.clientId)
    .get();

  await Promise.all(
    users.docs
      .map((doc) => docWithId<ClientUserRecord>(doc))
      .filter((user) => user.active)
      .map((user) =>
        createNotification({
          audience: 'client',
          clientUserId: user.id,
          clientId: params.clientId,
          propertyId: params.propertyId,
          title: params.title,
          message: params.message,
          link: '/client/approvals',
        })
      )
  );
}

async function validatePcrSource(params: {
  tenant: TenantUserRecord;
  tenancy: TenancyRecord;
  sourceDocumentId: string;
}) {
  const doc = await adminDb.collection('propertyDocuments').doc(params.sourceDocumentId).get();
  if (!doc.exists) throw new Error('PCR_DOCUMENT_NOT_FOUND');
  const document = docWithId<TenantDocument & { storagePath?: string }>(doc);
  if (
    document.propertyId !== params.tenancy.propertyId ||
    document.category !== 'property_condition_report' ||
    !(document.audiences || []).includes('tenant') ||
    (document.tenancyId && document.tenancyId !== params.tenancy.id)
  ) {
    throw new Error('PCR_DOCUMENT_NOT_AUTHORISED');
  }
  return document;
}

export async function getTenantFormsDashboard(
  tenant: TenantUserRecord
): Promise<TenantFormsDashboard> {
  await ensureTenantFormDefinitions();
  const tenancyIds = tenant.tenancyIds;
  const normalSnapshots = await Promise.all(
    tenancyIds.map((tenancyId) =>
      adminDb.collection('tenantFormRequests').where('tenancyId', '==', tenancyId).get()
    )
  );

  const normalMap = new Map<string, TenantFormRequest>();
  normalSnapshots.forEach((snapshot) =>
    snapshot.docs.forEach((doc) => normalMap.set(doc.id, docWithId<TenantFormRequest>(doc)))
  );

  const sensitive = await adminDb
    .collection('sensitiveTenantForms')
    .where('tenantUserId', '==', tenant.id)
    .get();

  const requests = Array.from(normalMap.values())
    .filter((request) => request.tenantUserId === tenant.id)
    .map(publicFormRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    definitions: TENANT_FORM_DEFINITIONS.filter((definition) => definition.active),
    requests,
    sensitiveRequests: sensitive.docs
      .map((doc) => docWithId<SensitiveTenantFormRequest>(doc))
      .map((request) => ({
        id: request.id,
        reference: request.reference,
        workflowType: request.workflowType,
        formCode: request.formCode,
        formName: request.formName,
        status: request.status,
        submittedAt: request.submittedAt,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function createTenantFormRequest(
  tenant: TenantUserRecord,
  input: TenantFormCreateInput
): Promise<TenantFormRequest> {
  await ensureTenantFormDefinitions();
  const definition = getTenantFormDefinition(input.formDefinitionId);
  if (!definition || definition.sensitive || definition.workflowType === 'family_violence_termination') {
    throw new Error('FORM_NOT_AVAILABLE');
  }

  const workflowType = definition.workflowType as TenantFormRequest['workflowType'];
  const { tenancy, property } = await loadAuthorisedTenancy(
    tenant,
    input.tenancyId,
    { allowEnded: workflowType === 'bond_release' }
  );
  validateNormalPayload(workflowType, input.payload);

  let sourceDocument: TenantDocument | undefined;
  if (workflowType === 'pcr_response') {
    sourceDocument = await validatePcrSource({
      tenant,
      tenancy,
      sourceDocumentId: textValue(input.payload, 'sourceDocumentId'),
    });
  }

  const clientId = await resolveClientId(tenancy, property);
  const now = nowIso();
  const ref = adminDb.collection('tenantFormRequests').doc();

  const deliveredAt = definition.clientApproval ? now : undefined;
  const responseDueAt =
    definition.responseDays && deliveredAt
      ? addCalendarDays(deliveredAt, definition.responseDays)
      : definition.tenantResponseDays && sourceDocument
        ? addCalendarDays(sourceDocument.uploadedAt, definition.tenantResponseDays)
        : undefined;

  const initialStatus: TenantFormStatus = 'submitted';

  const request: TenantFormRequest = {
    id: ref.id,
    reference: makeReference('TF'),
    workflowType,
    formDefinitionId: definition.id,
    formCode: definition.formCode,
    formName: definition.name,
    officialSourceUrl: definition.officialSourceUrl,
    officialVersion: definition.officialVersion,
    tenantUserId: tenant.id,
    tenancyId: tenancy.id,
    propertyId: tenancy.propertyId,
    clientId,
    status: initialStatus,
    payload: input.payload,
    attachments: [],
    submittedAt: now,
    deliveredAt,
    responseDueAt,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(request);

  if (definition.clientApproval && clientId) {
    const approval = await createApproval({
      clientId,
      propertyId: request.propertyId,
      requestId: request.id,
      type: 'instruction',
      title: `Form ${definition.formCode} – ${definition.shortName}`,
      summary: `Tenant ${tenant.displayName} submitted ${definition.name}. Response requested by ${responseDueAt ? new Date(responseDueAt).toLocaleDateString('en-AU') : 'the applicable date'}.`,
      requestedBy: 'tenant-portal',
    });

    request.clientApprovalId = approval.id;
    await ref.set({ clientApprovalId: approval.id }, { merge: true });
    await notifyClientUsers({
      clientId,
      propertyId: request.propertyId,
      title: `Tenant action required – Form ${definition.formCode}`,
      message: `${definition.shortName} has been submitted for ${property.streetAddress}, ${property.suburb}.`,
    });
  }

  await writeAuditEvent({
    entityType: 'tenant_request',
    entityId: request.id,
    action: 'statutory_form_submitted',
    summary: `${request.reference} submitted – ${definition.name}.`,
    actor: {
      type: 'tenant',
      id: tenant.id,
      email: tenant.email,
      displayName: tenant.displayName,
    },
    propertyId: request.propertyId,
    clientId,
    tenancyId: request.tenancyId,
    metadata: {
      formCode: definition.formCode,
      workflowType,
    },
  });

  return publicFormRequest(request);
}

export async function addTenantFormAttachment(
  tenant: TenantUserRecord,
  requestId: string,
  attachment: TenantFormAttachment & { storagePath: string }
): Promise<TenantFormRequest | null> {
  const ref = adminDb.collection('tenantFormRequests').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const request = docWithId<TenantFormRequest & { attachments: Array<TenantFormAttachment & { storagePath?: string }> }>(doc);
  if (request.tenantUserId !== tenant.id || !tenant.tenancyIds.includes(request.tenancyId)) {
    return null;
  }

  const attachments = [...(request.attachments || []), attachment];
  await ref.set({ attachments, updatedAt: nowIso() }, { merge: true });
  return publicFormRequest({ ...request, attachments });
}

export async function getTenantFormAttachment(
  tenant: TenantUserRecord,
  requestId: string,
  attachmentId: string
) {
  const doc = await adminDb.collection('tenantFormRequests').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<TenantFormRequest & {
    attachments: Array<TenantFormAttachment & { storagePath?: string }>;
  }>(doc);
  if (request.tenantUserId !== tenant.id || !tenant.tenancyIds.includes(request.tenancyId)) {
    return null;
  }
  const attachment = (request.attachments || []).find((item) => item.id === attachmentId);
  return attachment?.storagePath ? attachment : null;
}

export async function createSensitiveTenantFormDraft(
  tenant: TenantUserRecord,
  input: TenantFormCreateInput
): Promise<SensitiveTenantFormRequest> {
  await ensureTenantFormDefinitions();
  const definition = getTenantFormDefinition(input.formDefinitionId);
  if (!definition || !definition.sensitive || definition.workflowType !== 'family_violence_termination') {
    throw new Error('FORM_NOT_AVAILABLE');
  }
  const { tenancy } = await loadAuthorisedTenancy(tenant, input.tenancyId);

  const evidenceType = textValue(input.payload, 'evidenceType');
  const allowedEvidence = [
    'dvo',
    'family_court',
    'prosecution_or_conviction',
    'family_violence_evidence_form',
  ];
  if (!allowedEvidence.includes(evidenceType)) {
    throw new Error('FORM_FIELD_REQUIRED:Evidence type');
  }

  const proposedTerminationDate = textValue(input.payload, 'proposedTerminationDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedTerminationDate)) {
    throw new Error('FORM_FIELD_REQUIRED:Proposed termination date');
  }
  const perthToday = getPerthDateKey(new Date());
  const minimumTermination = new Date(`${perthToday}T00:00:00+08:00`);
  minimumTermination.setUTCDate(minimumTermination.getUTCDate() + 7);
  const minimumKey = getPerthDateKey(minimumTermination);
  if (proposedTerminationDate < minimumKey) {
    throw new Error('FAMILY_VIOLENCE_NOTICE_TOO_SHORT');
  }

  const now = nowIso();
  const ref = adminDb.collection('sensitiveTenantForms').doc();
  const request: SensitiveTenantFormRequest = {
    id: ref.id,
    reference: makeReference('SF'),
    workflowType: 'family_violence_termination',
    formDefinitionId: definition.id,
    formCode: '2',
    formName: definition.name,
    officialSourceUrl: definition.officialSourceUrl,
    tenantUserId: tenant.id,
    tenancyId: tenancy.id,
    propertyId: tenancy.propertyId,
    status: 'draft',
    payload: input.payload,
    evidence: [],
    submittedAt: '',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(request);

  await writeSensitiveAudit({
    requestId: request.id,
    action: 'draft_created',
    actorId: tenant.id,
  });

  return request;
}

export async function addSensitiveTenantEvidence(
  tenant: TenantUserRecord,
  requestId: string,
  attachment: TenantFormAttachment & { storagePath: string }
) {
  const ref = adminDb.collection('sensitiveTenantForms').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const request = docWithId<SensitiveTenantFormRequest & {
    evidence: Array<TenantFormAttachment & { storagePath?: string }>;
  }>(doc);
  if (request.tenantUserId !== tenant.id || request.status !== 'draft') return null;

  const evidence = [...(request.evidence || []), attachment];
  await ref.set({ evidence, updatedAt: nowIso() }, { merge: true });
  return { ...request, evidence };
}

export async function submitSensitiveTenantForm(
  tenant: TenantUserRecord,
  requestId: string
) {
  const ref = adminDb.collection('sensitiveTenantForms').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const request = docWithId<SensitiveTenantFormRequest>(doc);
  if (request.tenantUserId !== tenant.id || request.status !== 'draft') return null;

  const stored = doc.data() as { evidence?: unknown[] };
  if (!Array.isArray(stored.evidence) || stored.evidence.length === 0) {
    throw new Error('SENSITIVE_EVIDENCE_REQUIRED');
  }

  const submittedAt = nowIso();
  await ref.set(
    {
      status: 'submitted',
      submittedAt,
      updatedAt: submittedAt,
    },
    { merge: true }
  );

  await writeSensitiveAudit({
    requestId,
    action: 'submitted',
    actorId: tenant.id,
  });

  return {
    ...request,
    status: 'submitted' as const,
    submittedAt,
    updatedAt: submittedAt,
  };
}

export async function getSensitiveEvidenceForTenant(
  tenant: TenantUserRecord,
  requestId: string,
  attachmentId: string
) {
  const doc = await adminDb.collection('sensitiveTenantForms').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<SensitiveTenantFormRequest & {
    evidence: Array<TenantFormAttachment & { storagePath?: string }>;
  }>(doc);
  if (request.tenantUserId !== tenant.id) return null;
  const evidence = (request.evidence || []).find((item) => item.id === attachmentId);
  return evidence?.storagePath ? evidence : null;
}

async function writeSensitiveAudit(input: {
  requestId: string;
  action: string;
  actorId: string;
}) {
  const ref = adminDb.collection('sensitiveAuditEvents').doc();
  await ref.set({
    id: ref.id,
    requestId: input.requestId,
    action: input.action,
    actorId: input.actorId,
    createdAt: nowIso(),
  });
}

export async function getTenantFormAttachmentForAdmin(
  requestId: string,
  attachmentId: string
) {
  const doc = await adminDb.collection('tenantFormRequests').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<TenantFormRequest & {
    attachments: Array<TenantFormAttachment & { storagePath?: string }>;
  }>(doc);
  const attachment = (request.attachments || []).find((item) => item.id === attachmentId);
  return attachment?.storagePath ? attachment : null;
}

export async function listAdminTenantForms(): Promise<TenantFormRequest[]> {
  const snapshot = await adminDb
    .collection('tenantFormRequests')
    .orderBy('updatedAt', 'desc')
    .limit(500)
    .get();
  return snapshot.docs.map((doc) =>
    adminFormRequest(docWithId<TenantFormRequest>(doc))
  );
}

export async function updateAdminTenantForm(
  requestId: string,
  changes: {
    status?: TenantFormStatus;
    adminNotes?: string;
    serviceMethod?: TenantFormRequest['serviceMethod'];
    generatedDocumentId?: string;
    finalDocumentId?: string;
  },
  actor: { id?: string; email?: string }
) {
  const ref = adminDb.collection('tenantFormRequests').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const current = docWithId<TenantFormRequest>(doc);
  const definition = getTenantFormDefinition(current.formDefinitionId);

  const updatedAt = nowIso();
  const patch: Record<string, unknown> = { ...changes, updatedAt };

  if (
    changes.status === 'delivered' &&
    !current.deliveredAt
  ) {
    patch.deliveredAt = updatedAt;
    if (definition?.responseDays) {
      patch.responseDueAt = addCalendarDays(updatedAt, definition.responseDays);
    }
  }

  if (
    changes.status &&
    ['approved', 'approved_with_conditions', 'declined', 'agreed', 'disputed', 'processed', 'completed'].includes(changes.status)
  ) {
    patch.respondedAt = updatedAt;
    patch.responseOutcome = changes.status;
  }

  if (
    changes.status === 'lodged' &&
    current.workflowType === 'bond_release' &&
    definition?.responseDays
  ) {
    patch.responseDueAt = addCalendarDays(updatedAt, definition.responseDays);
  }

  await ref.set(patch, { merge: true });
  const updated = docWithId<TenantFormRequest>(await ref.get());

  await writeAuditEvent({
    entityType: 'tenant_request',
    entityId: requestId,
    action: 'statutory_form_updated',
    summary: `${current.reference} updated${changes.status ? ` to ${changes.status}` : ''}.`,
    actor: { type: 'staff', id: actor.id, email: actor.email },
    propertyId: current.propertyId,
    clientId: current.clientId,
    tenancyId: current.tenancyId,
    metadata: {
      formCode: current.formCode,
      status: changes.status || current.status,
    },
  });

  if (changes.status && changes.status !== current.status) {
    await createNotification({
      audience: 'tenant',
      tenantUserId: current.tenantUserId,
      clientId: current.clientId,
      propertyId: current.propertyId,
      tenancyId: current.tenancyId,
      title: 'Tenancy form updated',
      message: `${current.reference} is now ${changes.status.replaceAll('_', ' ')}.`,
      link: '/tenant',
    });
  }

  return adminFormRequest(updated);
}

export async function getSensitiveEvidenceForAdmin(
  requestId: string,
  attachmentId: string
) {
  const doc = await adminDb.collection('sensitiveTenantForms').doc(requestId).get();
  if (!doc.exists) return null;
  const request = docWithId<SensitiveTenantFormRequest & {
    evidence: Array<TenantFormAttachment & { storagePath?: string }>;
  }>(doc);
  const evidence = (request.evidence || []).find((item) => item.id === attachmentId);
  return evidence?.storagePath ? evidence : null;
}

export async function listSensitiveTenantFormsForAdmin() {
  const snapshot = await adminDb
    .collection('sensitiveTenantForms')
    .orderBy('updatedAt', 'desc')
    .limit(200)
    .get();

  return snapshot.docs.map((doc) => {
    const request = docWithId<SensitiveTenantFormRequest & {
      evidence: Array<TenantFormAttachment & { storagePath?: string }>;
    }>(doc);
    return {
      id: request.id,
      reference: request.reference,
      formName: request.formName,
      formCode: request.formCode,
      tenantUserId: request.tenantUserId,
      tenancyId: request.tenancyId,
      propertyId: request.propertyId,
      status: request.status,
      payload: request.payload,
      evidence: (request.evidence || []).map((item) => ({
        id: item.id,
        fileName: item.fileName,
        contentType: item.contentType,
        size: item.size,
        uploadedAt: item.uploadedAt,
      })),
      submittedAt: request.submittedAt,
      noticePreparedAt: request.noticePreparedAt,
      noticeServedAt: request.noticeServedAt,
      completedAt: request.completedAt,
      restrictedNotes: request.restrictedNotes,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  });
}

export async function updateSensitiveTenantFormAdmin(
  requestId: string,
  changes: {
    status?: SensitiveTenantFormStatus;
    restrictedNotes?: string;
  },
  actorId: string
) {
  const ref = adminDb.collection('sensitiveTenantForms').doc(requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const request = docWithId<SensitiveTenantFormRequest>(doc);
  const updatedAt = nowIso();
  const patch: Record<string, unknown> = { ...changes, updatedAt };

  if (changes.status === 'notice_prepared') patch.noticePreparedAt = updatedAt;
  if (changes.status === 'notice_served') patch.noticeServedAt = updatedAt;
  if (changes.status === 'completed') patch.completedAt = updatedAt;

  await ref.set(patch, { merge: true });
  await writeSensitiveAudit({
    requestId,
    action: changes.status ? `status:${changes.status}` : 'notes_updated',
    actorId,
  });

  return { ...request, ...patch };
}
