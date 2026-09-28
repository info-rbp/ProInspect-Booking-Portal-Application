from pathlib import Path
import re

def edit(path, old, new, count=1):
    p=Path(path); s=p.read_text(); assert s.count(old)==count, (path, old[:70], s.count(old)); p.write_text(s.replace(old,new))
def block(path, start, end, new):
    p=Path(path); s=p.read_text(); assert s.count(start)==1 and s.count(end)==1, (path,start,end); a=s.index(start); b=s.index(end,a); p.write_text(s[:a]+new+'\n\n'+s[b:])

Path('src/server/clientAuthority.ts').write_text('''import type { Transaction } from 'firebase-admin/firestore';
import type { ClientContext } from './store.js';
import type { ClientMembership, ClientOrganisationRole } from '../types/clientPortal.js';
import { adminDb } from './firebaseAdmin.js';

/** Read authority in the same transaction as a sensitive write. Revocations win retries. */
export async function authoriseClientWrite(tx: Transaction, context: ClientContext, roles?: ClientOrganisationRole[]): Promise<ClientMembership> {
  const [profile, member] = await Promise.all([
    tx.get(adminDb.collection('clientUsers').doc(context.profile.uid)),
    tx.get(adminDb.collection('clientMemberships').doc(context.membership.id)),
  ]);
  if (!profile.exists || profile.data()?.active === false) throw new Error('CLIENT_ACCOUNT_DISABLED');
  const membership = member.data() as ClientMembership | undefined;
  if (!membership || membership.status !== 'active' || membership.uid !== context.profile.uid ||
      membership.email !== context.profile.email || membership.organisationId !== context.organisation.id) {
    throw new Error('CLIENT_MEMBERSHIP_REVOKED');
  }
  if (membership.role === 'viewer' || (roles && !roles.includes(membership.role))) throw new Error('CLIENT_WRITE_FORBIDDEN');
  return membership;
}

export async function assertClientWrite(context: ClientContext, roles?: ClientOrganisationRole[]): Promise<void> {
  await adminDb.runTransaction(async tx => { await authoriseClientWrite(tx, context, roles); });
}
''')
edit('src/server/store.ts', "import { createHash } from 'crypto';", "import { createHash, randomUUID } from 'crypto';\nimport { authoriseClientWrite, assertClientWrite } from './clientAuthority.js';")
block('src/server/store.ts', 'async function claimInvitations(', 'async function createDefaultClientOrganisation(', '''async function claimInvitations(params: { uid: string; email: string; displayName?: string }): Promise<void> {
  const email = normaliseEmail(params.email);
  const snapshot = await adminDb.collection('clientMemberships').where('email', '==', email).get();
  for (const candidate of snapshot.docs) {
    await adminDb.runTransaction(async tx => {
      const [profile, doc] = await Promise.all([
        tx.get(adminDb.collection('clientUsers').doc(params.uid)), tx.get(candidate.ref),
      ]);
      if (profile.data()?.active === false) throw new Error('CLIENT_ACCOUNT_DISABLED');
      const membership = doc.data() as ClientMembership | undefined;
      if (!membership || membership.email !== email || membership.status !== 'invited' ||
          (membership.uid && membership.uid !== params.uid)) return;
      tx.update(candidate.ref, { uid: params.uid, displayName: params.displayName || membership.displayName || email,
        status: 'active', updatedAt: new Date().toISOString() });
    });
  }
}''')
block('src/server/store.ts', 'async function createDefaultClientOrganisation(', 'export async function ensureClientContext(', '''async function createDefaultClientOrganisation(params: { uid: string; email: string; displayName?: string }): Promise<{ organisation: ClientOrganisation; membership: ClientMembership }> {
  const organisationId = clientOrganisationIdFor(params.uid);
  const orgRef = adminDb.collection('clientOrganisations').doc(organisationId);
  const memberId = clientMembershipIdFor(organisationId, params.email);
  const memberRef = adminDb.collection('clientMemberships').doc(memberId);
  return adminDb.runTransaction(async tx => {
    const [orgDoc, memberDoc, profileDoc] = await Promise.all([
      tx.get(orgRef), tx.get(memberRef), tx.get(adminDb.collection('clientUsers').doc(params.uid)),
    ]);
    if (profileDoc.data()?.active === false) throw new Error('CLIENT_ACCOUNT_DISABLED');
    if (memberDoc.exists) {
      const membership = { ...memberDoc.data(), id: memberId } as ClientMembership;
      if (membership.status !== 'active' || membership.uid !== params.uid || !orgDoc.exists) throw new Error('CLIENT_MEMBERSHIP_REVOKED');
      return { membership, organisation: { ...orgDoc.data(), id: organisationId } as ClientOrganisation };
    }
    if (orgDoc.exists || profileDoc.exists) throw new Error('CLIENT_MEMBERSHIP_REVOKED');
    const now = new Date().toISOString();
    const organisation: ClientOrganisation = { id: organisationId, name: params.displayName?.trim() || params.email,
      entityType: 'individual', billingEmail: normaliseEmail(params.email), createdByUid: params.uid, createdAt: now, updatedAt: now };
    const membership: ClientMembership = { id: memberId, organisationId, email: normaliseEmail(params.email), uid: params.uid,
      displayName: params.displayName, role: 'owner', status: 'active', createdAt: now, updatedAt: now };
    tx.create(orgRef, organisation); tx.create(memberRef, membership);
    return { organisation, membership };
  });
}''')
edit('src/server/store.ts', 'let memberships = await activeMembershipsForUid(params.uid);', "let memberships = (await activeMembershipsForUid(params.uid)).filter(item => item.email === email);")
edit('src/server/store.ts', 'await profileRef.set(profile, { merge: true });\n  return { profile, organisation, membership };', '''const finalMembership = await adminDb.runTransaction(async tx => {
    const [liveProfile, liveMembership] = await Promise.all([
      tx.get(profileRef), tx.get(adminDb.collection('clientMemberships').doc(membership.id)),
    ]);
    if (liveProfile.data()?.active === false) throw new Error('CLIENT_ACCOUNT_DISABLED');
    const active = liveMembership.data() as ClientMembership | undefined;
    if (!active || active.status !== 'active' || active.uid !== params.uid || active.email !== email ||
        active.organisationId !== organisation.id) throw new Error('CLIENT_MEMBERSHIP_REVOKED');
    profile.phone = liveProfile.data()?.phone || profile.phone;
    profile.onboardingStatus = liveProfile.data()?.onboardingStatus || profile.onboardingStatus;
    tx.set(profileRef, profile, { merge: true });
    return { ...active, id: membership.id };
  });
  return { profile, organisation, membership: finalMembership };''')
for marker in ['export async function createClientProperty(', 'export async function updateClientProperty(', 'export async function createClientRequest(', 'export async function updateClientRequest(', 'export async function createClientApproval(']:
    p=Path('src/server/store.ts'); s=p.read_text(); a=s.index(marker); pos=s.index(' {\n',s.index('): Promise<',a))+3; s=s[:pos]+'  await assertClientWrite(params.context);\n'+s[pos:]; p.write_text(s)
block('src/server/store.ts', 'export async function inviteClientOrganisationMember(', 'export async function updateClientOrganisationMember(', '''export async function inviteClientOrganisationMember(params: { context: ClientContext; email: string; role: Exclude<ClientOrganisationRole, 'owner'> }): Promise<ClientMembership> {
  const email = normaliseEmail(params.email);
  const id = clientMembershipIdFor(params.context.organisation.id, email);
  const ref = adminDb.collection('clientMemberships').doc(id);
  if (!['admin', 'member', 'viewer'].includes(params.role)) throw new Error('CLIENT_WRITE_FORBIDDEN');
  return adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context, ['owner', 'admin']);
    const existing = await tx.get(ref);
    if (existing.exists) throw new Error('CLIENT_MEMBERSHIP_ALREADY_EXISTS');
    const now = new Date().toISOString();
    const membership: ClientMembership = { id, organisationId: params.context.organisation.id, email,
      role: params.role, status: 'invited', invitedByUid: params.context.profile.uid, createdAt: now, updatedAt: now };
    tx.create(ref, membership);
    return membership;
  });
}''')
block('src/server/store.ts', 'export async function updateClientOrganisationMember(', 'export async function linkHistoricalBookingsToClient(', '''export async function updateClientOrganisationMember(params: { context: ClientContext; membershipId: string; role?: Exclude<ClientOrganisationRole, 'owner'>; status?: 'active' | 'revoked' }): Promise<ClientMembership> {
  const ref = adminDb.collection('clientMemberships').doc(params.membershipId);
  return adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context, ['owner']);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('CLIENT_MEMBERSHIP_NOT_FOUND');
    const member = { ...doc.data(), id: doc.id } as ClientMembership;
    if (member.organisationId !== params.context.organisation.id || member.role === 'owner') throw new Error('CLIENT_MEMBERSHIP_FORBIDDEN');
    if (params.role && !['admin', 'member', 'viewer'].includes(params.role)) throw new Error('CLIENT_WRITE_FORBIDDEN');
    const updated: ClientMembership = { ...member, ...(params.role ? { role: params.role } : {}),
      ...(params.status ? { status: params.status === 'active' && !member.uid ? 'invited' : params.status } : {}), updatedAt: new Date().toISOString() };
    tx.update(ref, updated);
    return updated;
  });
}''')
block('src/server/store.ts', 'export async function linkHistoricalBookingsToClient(', 'export async function linkBookingToClient(', '''/** Linking a historical booking requires its secure management token, not email alone. */
export async function claimClientBooking(params: { context: ClientContext; managementToken: string }): Promise<void> {
  const matches = await adminDb.collection('bookings').where('managementToken', '==', params.managementToken).limit(1).get();
  if (matches.empty) throw new Error('CLIENT_BOOKING_NOT_FOUND');
  const ref = matches.docs[0].ref;
  await adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context, ['owner', 'admin']);
    const doc = await tx.get(ref);
    const booking = doc.data() as BookingRecord | undefined;
    if (!booking || booking.managementToken !== params.managementToken ||
        normaliseEmail(booking.property.customerEmail) !== params.context.profile.email ||
        (booking.clientOrganisationId && booking.clientOrganisationId !== params.context.organisation.id) ||
        (booking.clientUid && booking.clientUid !== params.context.profile.uid)) throw new Error('CLIENT_BOOKING_NOT_FOUND');
    const id = clientPropertyKey(params.context.organisation.id, booking.property);
    const propertyRef = adminDb.collection('clientProperties').doc(id);
    const existing = await tx.get(propertyRef);
    const now = new Date().toISOString();
    if (!existing.exists) tx.create(propertyRef, { id, organisationId: params.context.organisation.id, createdByUid: params.context.profile.uid,
      streetAddress: booking.property.streetAddress, unit: booking.property.unit, suburb: booking.property.suburb, state: booking.property.state,
      postcode: booking.property.postcode, propertyType: booking.property.propertyType,
      categories: booking.serviceCategory ? [booking.serviceCategory] : [], status: 'active', createdAt: now, updatedAt: now, lastBookingAt: booking.appointment.start });
    tx.update(ref, { clientUid: params.context.profile.uid, clientOrganisationId: params.context.organisation.id, propertyId: id, updatedAt: now });
  });
}''')
p=Path('src/server/store.ts'); s=p.read_text(); a=s.index('  // Automatic historical-email reconciliation is safe only when the client has'); b=s.index('  const organisationDocs',a); p.write_text(s[:a]+'  // Historical bookings are linked only by an explicit secure-token claim.\n\n'+s[b:])
block('src/server/store.ts', 'export async function claimClientDocumentDraftGeneration(', 'export async function releaseClientDocumentDraftGeneration(', '''export async function claimClientDocumentDraftGeneration(params: { context: ClientContext; requestId: string }): Promise<ClientRequestSummary> {
  const ref = adminDb.collection('clientRequests').doc(params.requestId);
  const token = randomUUID();
  return adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new Error('CLIENT_REQUEST_NOT_FOUND');
    const request = { ...doc.data(), id: doc.id } as ClientRequestSummary;
    if (request.organisationId !== params.context.organisation.id || request.type !== 'document') throw new Error('CLIENT_REQUEST_FORBIDDEN');
    if (request.status === 'cancelled' || request.status === 'completed') throw new Error('CLIENT_REQUEST_CLOSED');
    const expires = Date.parse(request.draftGenerationExpiresAt || '') || (Date.parse(request.updatedAt) + 10 * 60_000);
    if (request.generatedDocumentId || request.draftGenerationStatus === 'generated' ||
        (request.draftGenerationStatus === 'generating' && expires > Date.now())) throw new Error('CLIENT_DRAFT_ALREADY_GENERATED');
    const patch = { draftGenerationStatus: 'generating' as const, draftGenerationToken: token,
      draftGenerationExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), updatedAt: new Date().toISOString() };
    tx.update(ref, patch);
    return { ...request, ...patch };
  });
}''')
block('src/server/store.ts', 'export async function releaseClientDocumentDraftGeneration(', 'export async function createClientDocument(', '''export async function releaseClientDocumentDraftGeneration(params: { context: ClientContext; requestId: string; generationToken: string }): Promise<void> {
  const ref = adminDb.collection('clientRequests').doc(params.requestId);
  await adminDb.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const request = doc.data() as ClientRequestSummary | undefined;
    if (!request || request.organisationId !== params.context.organisation.id || request.generatedDocumentId ||
        request.draftGenerationStatus !== 'generating' || request.draftGenerationToken !== params.generationToken) return;
    tx.update(ref, { draftGenerationStatus: 'failed', draftGenerationToken: '', draftGenerationExpiresAt: '', updatedAt: new Date().toISOString() });
  });
}''')
block('src/server/store.ts', 'export async function createClientDocument(', 'function clientDocumentView(', '''export async function createClientDocument(params: { context: ClientContext; propertyId?: string; requestId?: string; name: string; documentType: string;
  status: 'available' | 'draft' | 'archived'; storagePath: string; contentType?: string; sizeBytes?: number; generated?: boolean }): Promise<ClientDocumentSummary> {
  const ref = adminDb.collection('clientDocuments').doc();
  return adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context);
    const requestRef = params.requestId ? adminDb.collection('clientRequests').doc(params.requestId) : undefined;
    const requestDoc = requestRef ? await tx.get(requestRef) : undefined;
    const request = requestDoc?.data() as ClientRequestSummary | undefined;
    if (requestRef && (!request || request.organisationId !== params.context.organisation.id)) throw new Error('CLIENT_REQUEST_FORBIDDEN');
    if (request && ['cancelled', 'completed'].includes(request.status)) throw new Error('CLIENT_REQUEST_CLOSED');
    if (params.propertyId && request?.propertyId && params.propertyId !== request.propertyId) throw new Error('CLIENT_ATTACHMENT_PROPERTY_MISMATCH');
    const propertyId = params.propertyId || request?.propertyId;
    if (propertyId) {
      const property = await tx.get(adminDb.collection('clientProperties').doc(propertyId));
      if (!property.exists || property.data()?.organisationId !== params.context.organisation.id || property.data()?.status === 'inactive') throw new Error('CLIENT_PROPERTY_NOT_FOUND');
    }
    const now = new Date().toISOString();
    const document: ClientDocumentSummary = { id: ref.id, organisationId: params.context.organisation.id, clientUid: params.context.profile.uid,
      propertyId, requestId: params.requestId, name: params.name, documentType: params.documentType, status: params.status,
      storagePath: params.storagePath, contentType: params.contentType, sizeBytes: params.sizeBytes, generated: params.generated, createdAt: now, updatedAt: now };
    tx.create(ref, document);
    if (requestRef && request) tx.update(requestRef, { attachmentDocumentIds: [...new Set([...(request.attachmentDocumentIds || []), ref.id])], updatedAt: now });
    return document;
  });
}

/** Publish the file metadata, approval and request transition together, under the attempt's lease. */
export async function completeClientDocumentDraftGeneration(params: { context: ClientContext; requestId: string; generationToken: string;
  name: string; documentType: string; storagePath: string; contentType: string; sizeBytes: number }): Promise<{ document: ClientDocumentSummary; approval: ClientApproval }> {
  const requestRef = adminDb.collection('clientRequests').doc(params.requestId);
  const docRef = adminDb.collection('clientDocuments').doc();
  const approvalRef = adminDb.collection('clientApprovals').doc();
  return adminDb.runTransaction(async tx => {
    await authoriseClientWrite(tx, params.context);
    const snapshot = await tx.get(requestRef);
    const request = snapshot.data() as ClientRequestSummary | undefined;
    if (!request || request.organisationId !== params.context.organisation.id || request.type !== 'document') throw new Error('CLIENT_REQUEST_FORBIDDEN');
    const expires = Date.parse(request.draftGenerationExpiresAt || '');
    if (request.generatedDocumentId || request.draftGenerationStatus !== 'generating' || request.draftGenerationToken !== params.generationToken ||
        !Number.isFinite(expires) || expires <= Date.now()) throw new Error('CLIENT_DRAFT_LEASE_LOST');
    if (['cancelled', 'completed'].includes(request.status)) throw new Error('CLIENT_REQUEST_CLOSED');
    const now = new Date().toISOString();
    const document: ClientDocumentSummary = { id: docRef.id, organisationId: params.context.organisation.id, clientUid: params.context.profile.uid,
      propertyId: request.propertyId, requestId: params.requestId, name: params.name, documentType: params.documentType, status: 'draft',
      storagePath: params.storagePath, contentType: params.contentType, sizeBytes: params.sizeBytes, generated: true, createdAt: now, updatedAt: now };
    const approval: ClientApproval = { id: approvalRef.id, organisationId: params.context.organisation.id, propertyId: request.propertyId,
      requestId: params.requestId, documentId: docRef.id, type: 'document', title: `Confirm ${params.documentType} drafting instructions`,
      summary: 'Review the preparation summary. Approval confirms instructions only; it does not issue or execute a completed document.',
      status: 'pending', requestedByUid: params.context.profile.uid, requestedAt: now, updatedAt: now };
    tx.create(docRef, document); tx.create(approvalRef, approval);
    tx.update(requestRef, { status: 'waiting_client', generatedDocumentId: docRef.id, draftGenerationStatus: 'generated',
      draftGenerationToken: '', draftGenerationExpiresAt: '', attachmentDocumentIds: [...new Set([...(request.attachmentDocumentIds || []), docRef.id])], updatedAt: now });
    return { document, approval };
  });
}''')
edit('src/server/store.ts', 'return document.organisationId === params.organisationId ? document : null;', "return document.organisationId === params.organisationId && document.status !== 'archived' ? document : null;")
edit('src/server/store.ts', 'const documents = documentsSnapshot.docs\n    .map', "const documents = documentsSnapshot.docs\n    .filter(doc => doc.data().status !== 'archived')\n    .map")
edit('src/server/store.ts', 'const approvalDoc = await transaction.get(approvalRef);', 'await authoriseClientWrite(transaction, params.context);\n    const approvalDoc = await transaction.get(approvalRef);')
edit('src/types/clientPortal.ts', "draftGenerationStatus?: 'generating' | 'generated' | 'failed';", "draftGenerationStatus?: 'generating' | 'generated' | 'failed';\n  draftGenerationToken?: string;\n  draftGenerationExpiresAt?: string;")
edit('src/server/store.ts', '.map((doc) => ({ ...(doc.data() as ClientRequestSummary), id: doc.id }))', ".map((doc) => { const { draftGenerationToken: _token, ...safe } = doc.data() as ClientRequestSummary; return { ...safe, id: doc.id }; })")
Path('src/server/clientFiles.ts').write_text(Path('src/server/clientFiles.ts').read_text()+'''\nexport async function deleteClientFile(storagePath: string): Promise<void> {
  if (!storagePath.startsWith('client-files/') || storagePath.includes('..')) throw new Error('Invalid file cleanup path.');
  await adminStorageBucket.file(storagePath).delete({ ignoreNotFound: true });
}
''')
edit('server.ts', '  claimClientDocumentDraftGeneration,', '  claimClientBooking,\n  completeClientDocumentDraftGeneration,\n  claimClientDocumentDraftGeneration,')
edit('server.ts', '  saveClientFile,', '  deleteClientFile,\n  saveClientFile,')
edit('server.ts', "error.message === 'CLIENT_ACCOUNT_DISABLED'", "['CLIENT_ACCOUNT_DISABLED', 'CLIENT_MEMBERSHIP_REVOKED'].includes(error.message)")
edit('server.ts', 'async function optionalClientIdentity(', '''function clientFailure(error: unknown, res: Response): boolean {
  const code = error instanceof Error ? error.message : '';
  if (res.headersSent || !code.startsWith('CLIENT_')) return false;
  const status = /MISMATCH/.test(code) ? 400 : /ALREADY|LEASE|CLOSED/.test(code) ? 409 : /NOT_FOUND|FORBIDDEN/.test(code) && !/WRITE/.test(code) ? 404 : 403;
  res.status(status).json({ error: status === 409 ? 'This request has changed or is already being processed. Refresh and try again.' : status === 400 ? 'The selected records do not belong together.' : 'This action is not available for the current account or record.', code });
  return true;
}

async function optionalClientIdentity(''')
edit('server.ts', 'let generationClaimed = false;', "let generationToken = '';\n  let pendingStoragePath: string | undefined;")
edit('server.ts', 'generationClaimed = true;', "generationToken = request.draftGenerationToken || '';\n    if (!generationToken) throw new Error('CLIENT_DRAFT_LEASE_LOST');")
p=Path('server.ts'); s=p.read_text(); a=s.index('    const document = await createClientDocument({', s.index("app.post('/api/client/requests/:id/generate-draft'")); b=s.index('    const { storagePath: _storagePath, ...clientDocument }',a); p.write_text(s[:a]+'''    pendingStoragePath = stored.storagePath;
    const { document, approval } = await completeClientDocumentDraftGeneration({
      context, requestId: request.id, generationToken, name: stored.fileName,
      documentType: input.documentType, storagePath: stored.storagePath,
      contentType: generated.contentType, sizeBytes: stored.sizeBytes,
    });
    pendingStoragePath = undefined;

'''+s[b:])
edit('server.ts', 'if (generationClaimed) {', "if (pendingStoragePath) await deleteClientFile(pendingStoragePath).catch(() => undefined);\n    if (generationToken) {")
edit('server.ts', "requestId: req.params.id,\n      }).catch((releaseError)", "requestId: req.params.id,\n        generationToken,\n      }).catch((releaseError)")
edit('server.ts', "console.error('Client document draft generation failed:', error);", "if (clientFailure(error, res)) return;\n    console.error('Client document draft generation failed:', error);")
edit('server.ts', "express.raw({ type: () => true, limit: '10mb' }),\n  async (req, res) => {\n    try {", "express.raw({ type: () => true, limit: '10mb' }),\n  async (req, res) => {\n    let pendingStoragePath: string | undefined;\n    try {")
edit('server.ts', '      const document = await createClientDocument({', '      pendingStoragePath = stored.storagePath;\n      const document = await createClientDocument({')
edit('server.ts', '      const { storagePath: _storagePath, ...clientDocument } = document;', '      pendingStoragePath = undefined;\n      const { storagePath: _storagePath, ...clientDocument } = document;')
edit('server.ts', "console.error('Client file upload failed:', error);", "if (pendingStoragePath) await deleteClientFile(pendingStoragePath).catch(() => undefined);\n      if (error instanceof URIError) return res.status(400).json({ error: 'Invalid file name.' });\n      if (clientFailure(error, res)) return;\n      console.error('Client file upload failed:', error);")
p=Path('server.ts'); s=p.read_text(); guard="    if (!document.storagePath) {\n      return res.status(500).json({ error: 'This document is missing its storage reference.' });\n    }\n"; start=s.index("app.get('/api/client/documents/:id/download'"); end=s.index("app.",start+10); sub=s[start:end]; assert sub.count(guard)==3; sub=sub.replace(guard,'',2); p.write_text(s[:start]+sub+s[end:])
p=Path('server.ts'); s=p.read_text(); s=re.sub(r"(?m)^(\s*)(console\.error\('Client (?!file upload|document draft generation|authentication|portal booking linkage)[^\n]+)",r"\1if (clientFailure(error, res)) return;\n\1\2",s); p.write_text(s)
edit('server.ts', "app.get('/api/client/session',", '''app.post('/api/client/bookings/claim', requireClient, clientMutationRateLimit, async (req, res) => {
  const managementToken = typeof req.body?.managementToken === 'string' ? req.body.managementToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(managementToken)) return res.status(400).json({ error: 'Enter the secure management code from your booking confirmation.' });
  try {
    await claimClientBooking({ context: clientContext(res), managementToken });
    return res.json({ success: true });
  } catch (error) {
    if (clientFailure(error, res)) return;
    return res.status(500).json({ error: 'Unable to link this booking.' });
  }
});

app.get('/api/client/session',''')
Path('src/services/api.ts').write_text(Path('src/services/api.ts').read_text()+'''\nexport async function claimClientBooking(managementToken: string): Promise<void> {
  await clientJson('/api/client/bookings/claim', { method: 'POST', body: JSON.stringify({ managementToken }) });
}
''')
edit('src/components/client/ClientPortal.tsx', '  downloadClientDocument,', '  claimClientBooking,\n  downloadClientDocument,')
edit('src/components/client/ClientPortal.tsx', 'const [editingProperty, setEditingProperty] = useState(false);', "const [editingProperty, setEditingProperty] = useState(false);\n  const [bookingClaimToken, setBookingClaimToken] = useState('');")
edit('src/components/client/ClientPortal.tsx', '''            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {data.bookings.map''', '''            {['owner', 'admin'].includes(data.membership.role) && (
              <form className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" onSubmit={async event => {
                event.preventDefault(); setActionId('booking-claim'); setError(null);
                try { await claimClientBooking(bookingClaimToken.trim()); setBookingClaimToken(''); await load(); }
                catch (err: any) { setError(err?.message || 'Unable to link booking.'); }
                finally { setActionId(null); }
              }}>
                <label htmlFor="booking-claim" className="block font-semibold text-sm">Link an existing booking</label>
                <p className="text-sm text-slate-600">Use the secure management code from a booking made with your verified email. This will share the booking with this organisation.</p>
                <input id="booking-claim" type="password" autoComplete="off" required minLength={20} maxLength={200} value={bookingClaimToken} onChange={event => setBookingClaimToken(event.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                <button type="submit" disabled={actionId === 'booking-claim'} className="rounded-lg bg-[#007F82] text-white px-4 py-2 disabled:opacity-50">{actionId === 'booking-claim' ? 'Linking...' : 'Link Booking'}</button>
              </form>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {data.bookings.map''')
edit('server.ts', 'could not be written. The next portal load can reconcile by verified email.', 'could not be written. The client can explicitly link using the management code.')
edit('src/server/store.ts', "if (!['owner', 'admin'].includes(params.context.membership.role)) {\n    throw new Error('CLIENT_ORGANISATION_ADMIN_REQUIRED');\n  }", "await assertClientWrite(params.context, ['owner', 'admin']);")
edit('src/server/store.ts', "}> {\n  const property = await upsertClientProperty({", "}> {\n  await assertClientWrite(params.context);\n  const property = await upsertClientProperty({")
edit('server.ts', "app.use(express.json({ limit: '256kb' }));", "app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });\napp.use(express.json({ limit: '256kb' }));")
edit('server.ts', 'async function startServer() {', '''app.use((error: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);
  const status = error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError || error instanceof URIError ? 400 : 500;
  return res.status(status).json({ error: status === 413 ? 'The request exceeds the permitted size.' : status === 400 ? 'The request could not be parsed.' : 'The request could not be completed.' });
});

async function startServer() {''')
Path('scripts/stage1-firebase.json').write_text('{"emulators":{"auth":{"host":"127.0.0.1","port":9099},"firestore":{"host":"127.0.0.1","port":8080},"ui":{"enabled":false},"singleProjectMode":true},"firestore":{"rules":"../firestore.rules"}}\n')
print('Applied Client Portal authority, attachment, lease and secure booking-claim fixes; no cloud writes.')
