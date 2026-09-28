import { createHash, randomUUID } from 'crypto';
import { authoriseClientWrite, assertClientWrite } from './clientAuthority.js';
import type { BookingRecord, BusinessSettings, InspectionService, PropertyDetails, ServiceCategory } from '../types/booking.js';
import type {
  DocumentProduct,
  DocumentRequestRecord,
  DocumentRequestStatus,
} from '../types/documentRequest.js';
import type {
  ClientApproval,
  ClientBookingSummary,
  ClientDocumentSummary,
  ClientMembership,
  ClientOnboardingInput,
  ClientOrganisation,
  ClientOrganisationRole,
  ClientPortalDashboard,
  ClientProfile,
  ClientProperty,
  ClientPropertyInput,
  ClientRequestSummary,
  ClientRequestType,
} from '../types/clientPortal.js';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from '../services/defaultServices.js';
import { DEFAULT_DOCUMENT_PRODUCTS } from '../documents/defaultDocumentProducts.js';
import { adminDb } from './firebaseAdmin.js';
import {
  decryptDocumentRequestSecrets,
  type EncryptedDocumentRequestSecrets,
} from './documentRequestSecrets.js';
import {
  decryptAccessSecrets,
  restoreSensitiveAccess,
  type EncryptedAccessSecretsDocument,
} from './accessSecrets.js';

const SETTINGS_ID = 'business';
const SERVICE_CATALOGUE_META_ID = 'serviceCatalogue';
const SERVICE_CATALOGUE_VERSION = 4;
let seeded: Promise<void> | null = null;
let documentCatalogueSeeded: Promise<void> | null = null;

export async function ensureSeedData() {
  if (!seeded) {
    seeded = (async () => {
      const settingsRef = adminDb.collection('settings').doc(SETTINGS_ID);
      const catalogueMetaRef = adminDb.collection('systemMetadata').doc(SERVICE_CATALOGUE_META_ID);
      const refs = DEFAULT_SERVICES.map((service) => adminDb.collection('services').doc(service.id));
      const [settingsDoc, catalogueMetaDoc, ...docs] = await Promise.all([
        settingsRef.get(),
        catalogueMetaRef.get(),
        ...refs.map((ref) => ref.get()),
      ]);
      const catalogueVersion = Number(catalogueMetaDoc.data()?.version || 0);
      const batch = adminDb.batch();
      let hasWrites = false;

      if (!settingsDoc.exists) {
        batch.set(settingsRef, DEFAULT_SETTINGS);
        hasWrites = true;
      }

      docs.forEach((doc, index) => {
        if (!doc.exists) {
          batch.set(refs[index], DEFAULT_SERVICES[index]);
          hasWrites = true;
          return;
        }

        const existing = doc.data() as Partial<InspectionService>;
        const defaultService = DEFAULT_SERVICES[index];

        if (!Array.isArray(existing.categories) || existing.categories.length === 0) {
          batch.set(
            refs[index],
            { categories: defaultService.categories },
            { merge: true }
          );
          hasWrites = true;
        }

        if (catalogueVersion < SERVICE_CATALOGUE_VERSION) {
          const migrationPatch: Partial<InspectionService> = {
            order: defaultService.order,
          };

          if (
            defaultService.id === 'maintenance-attendance' ||
            defaultService.id === 'other-custom-appointment' ||
            defaultService.id === 'commercial-property-inspection' ||
            defaultService.id === 'building-management-attendance' ||
            defaultService.id === 'follow-up-reinspection' ||
            defaultService.id === 'contractor-access-attendance' ||
            defaultService.id === 'key-handover-collection'
          ) {
            migrationPatch.publicDescription = defaultService.publicDescription;
          }

          if (defaultService.id === 'key-handover-collection') {
            migrationPatch.name = defaultService.name;
          }

          if (
            defaultService.id === 'completed-works-inspection' ||
            defaultService.id === 'follow-up-reinspection' ||
            defaultService.id === 'contractor-access-attendance' ||
            defaultService.id === 'key-handover-collection'
          ) {
            migrationPatch.categories = defaultService.categories;
          }

          batch.set(refs[index], migrationPatch, { merge: true });
          hasWrites = true;
        }
      });

      if (catalogueVersion < SERVICE_CATALOGUE_VERSION) {
        batch.set(
          catalogueMetaRef,
          {
            version: SERVICE_CATALOGUE_VERSION,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        hasWrites = true;
      }

      if (hasWrites) await batch.commit();
    })().catch((error) => {
      seeded = null;
      throw error;
    });
  }
  return seeded;
}

function serviceFromDocument(
  data: Partial<InspectionService>,
  id: string
): InspectionService {
  const service = data as InspectionService;
  return {
    ...service,
    id,
    categories: Array.isArray(service.categories) ? service.categories : [],
  };
}

export async function listServices(publicOnly = false): Promise<InspectionService[]> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').orderBy('order', 'asc').get();
  const services = snapshot.docs.map((doc) =>
    serviceFromDocument(doc.data() as Partial<InspectionService>, doc.id)
  );
  return publicOnly ? services.filter((service) => service.active && service.publiclyBookable) : services;
}

export async function getService(serviceId: string): Promise<InspectionService | null> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').doc(serviceId).get();
  return snapshot.exists
    ? serviceFromDocument(
        (snapshot.data() || {}) as Partial<InspectionService>,
        snapshot.id
      )
    : null;
}

export async function createService(service: InspectionService): Promise<InspectionService> {
  await ensureSeedData();
  const ref = adminDb.collection('services').doc(service.id);

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      throw new Error('SERVICE_ALREADY_EXISTS');
    }
    transaction.set(ref, service);
  });

  return service;
}

export async function updateService(
  serviceId: string,
  service: InspectionService
): Promise<InspectionService | null> {
  await ensureSeedData();
  const ref = adminDb.collection('services').doc(serviceId);
  const existing = await ref.get();

  if (!existing.exists) return null;

  await ref.set(
    {
      ...service,
      id: serviceId,
    },
    { merge: false }
  );

  return {
    ...service,
    id: serviceId,
  };
}

export async function reorderServices(serviceIds: string[]): Promise<InspectionService[]> {
  await ensureSeedData();
  const uniqueIds = Array.from(new Set(serviceIds));

  if (uniqueIds.length !== serviceIds.length) {
    throw new Error('DUPLICATE_SERVICE_IDS');
  }

  const refs = serviceIds.map((id) => adminDb.collection('services').doc(id));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));

  if (snapshots.some((snapshot) => !snapshot.exists)) {
    throw new Error('SERVICE_NOT_FOUND');
  }

  const batch = adminDb.batch();
  refs.forEach((ref, index) => {
    batch.set(ref, { order: index + 1 }, { merge: true });
  });
  await batch.commit();

  return listServices(false);
}

async function ensureDocumentCatalogue(): Promise<void> {
  if (!documentCatalogueSeeded) {
    documentCatalogueSeeded = (async () => {
      const refs = DEFAULT_DOCUMENT_PRODUCTS.map((product) =>
        adminDb.collection('documentProducts').doc(product.id)
      );
      const snapshots = await Promise.all(refs.map((ref) => ref.get()));
      const batch = adminDb.batch();
      let hasWrites = false;

      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) {
          batch.set(refs[index], DEFAULT_DOCUMENT_PRODUCTS[index]);
          hasWrites = true;
        }
      });

      if (hasWrites) await batch.commit();
    })().catch((error) => {
      documentCatalogueSeeded = null;
      throw error;
    });
  }

  await documentCatalogueSeeded;
}

function documentProductFromDocument(
  data: Partial<DocumentProduct>,
  id: string
): DocumentProduct {
  const product = data as DocumentProduct;
  return {
    ...product,
    id,
    categories: Array.isArray(product.categories) ? product.categories : [],
  };
}

export async function listDocumentProducts(
  publicOnly = false
): Promise<DocumentProduct[]> {
  await ensureDocumentCatalogue();
  const snapshot = await adminDb
    .collection('documentProducts')
    .orderBy('order', 'asc')
    .get();
  const products = snapshot.docs.map((doc) =>
    documentProductFromDocument(
      doc.data() as Partial<DocumentProduct>,
      doc.id
    )
  );

  return publicOnly
    ? products.filter(
        (product) => product.active && product.publiclyRequestable
      )
    : products;
}

export async function getDocumentProduct(
  documentId: string
): Promise<DocumentProduct | null> {
  await ensureDocumentCatalogue();
  const snapshot = await adminDb
    .collection('documentProducts')
    .doc(documentId)
    .get();

  return snapshot.exists
    ? documentProductFromDocument(
        (snapshot.data() || {}) as Partial<DocumentProduct>,
        snapshot.id
      )
    : null;
}

export function newDocumentRequestId(): string {
  return adminDb.collection('documentRequests').doc().id;
}

export async function documentRequestReferenceExists(
  reference: string
): Promise<boolean> {
  const snapshot = await adminDb
    .collection('documentRequests')
    .where('requestReference', '==', reference)
    .limit(1)
    .get();
  return !snapshot.empty;
}

export async function saveDocumentRequest(
  request: DocumentRequestRecord,
  encryptedSecrets?: EncryptedDocumentRequestSecrets
): Promise<DocumentRequestRecord> {
  const requestRef = adminDb.collection('documentRequests').doc(request.id);
  const batch = adminDb.batch();
  batch.set(requestRef, request);

  if (encryptedSecrets) {
    batch.set(
      adminDb.collection('documentRequestSecrets').doc(request.id),
      encryptedSecrets
    );
  }

  await batch.commit();
  return request;
}

export async function listDocumentRequests(): Promise<DocumentRequestRecord[]> {
  const snapshot = await adminDb
    .collection('documentRequests')
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();

  return snapshot.docs.map((doc) => ({
    ...(doc.data() as DocumentRequestRecord),
    id: doc.id,
  }));
}

export async function updateDocumentRequestStatusForAdmin(params: {
  requestId: string;
  status: DocumentRequestStatus;
}): Promise<DocumentRequestRecord | null> {
  const requestRef = adminDb.collection('documentRequests').doc(params.requestId);
  const requestDoc = await requestRef.get();
  if (!requestDoc.exists) return null;

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  batch.set(
    requestRef,
    {
      status: params.status,
      updatedAt: now,
    },
    { merge: true }
  );

  const mirrorSnapshot = await adminDb
    .collection('clientRequests')
    .where('details.sourceDocumentRequestId', '==', params.requestId)
    .limit(20)
    .get();

  const mirrorStatus: ClientRequestSummary['status'] =
    params.status === 'in_review'
      ? 'in_progress'
      : params.status === 'completed'
        ? 'completed'
        : params.status === 'cancelled'
          ? 'cancelled'
          : 'submitted';

  mirrorSnapshot.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        status: mirrorStatus,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  await batch.commit();

  return {
    ...(requestDoc.data() as DocumentRequestRecord),
    id: requestDoc.id,
    status: params.status,
    updatedAt: now,
  };
}

export async function listDocumentRequestsWithSecrets(): Promise<DocumentRequestRecord[]> {
  const requests = await listDocumentRequests();
  if (requests.length === 0) return requests;

  const secretRefs = requests.map((request) =>
    adminDb.collection('documentRequestSecrets').doc(request.id)
  );
  const secretDocs = await adminDb.getAll(...secretRefs);

  return requests.map((request, index) => {
    const secretDoc = secretDocs[index];
    if (!secretDoc?.exists) return request;

    try {
      const secrets = decryptDocumentRequestSecrets(
        request.id,
        secretDoc.data() as EncryptedDocumentRequestSecrets
      );
      return {
        ...request,
        workflow: {
          ...request.workflow,
          answers: {
            ...request.workflow.answers,
            ...secrets,
          },
        },
      };
    } catch (error) {
      console.error(
        `Failed to decrypt sensitive document-request details for ${request.id}:`,
        error
      );
      return request;
    }
  });
}

export async function getSettings(): Promise<BusinessSettings> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('settings').doc(SETTINGS_ID).get();
  return { ...DEFAULT_SETTINGS, ...(snapshot.exists ? snapshot.data() : {}) } as BusinessSettings;
}

export function newBookingId(): string {
  return adminDb.collection('bookings').doc().id;
}

export async function bookingReferenceExists(reference: string): Promise<boolean> {
  const snapshot = await adminDb.collection('bookings').where('bookingReference', '==', reference).limit(1).get();
  return !snapshot.empty;
}

export async function saveBooking(
  booking: BookingRecord,
  encryptedAccessSecrets?: EncryptedAccessSecretsDocument
): Promise<BookingRecord> {
  const bookingRef = adminDb.collection('bookings').doc(booking.id);
  const batch = adminDb.batch();
  batch.set(bookingRef, booking);

  if (encryptedAccessSecrets) {
    batch.set(
      adminDb.collection('bookingAccessSecrets').doc(booking.id),
      encryptedAccessSecrets
    );
  }

  await batch.commit();
  return booking;
}

export async function listBookings(): Promise<BookingRecord[]> {
  const snapshot = await adminDb.collection('bookings').orderBy('appointment.start', 'desc').limit(500).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as BookingRecord), id: doc.id }));
}

export async function listBookingsWithAccessSecrets(): Promise<BookingRecord[]> {
  const bookings = await listBookings();
  if (bookings.length === 0) return bookings;

  const refs = bookings.map((booking) =>
    adminDb.collection('bookingAccessSecrets').doc(booking.id)
  );
  const secretDocs = await adminDb.getAll(...refs);

  return bookings.map((booking, index) => {
    const secretDoc = secretDocs[index];
    if (!secretDoc?.exists) return booking;

    try {
      const secrets = decryptAccessSecrets(
        booking.id,
        secretDoc.data() as EncryptedAccessSecretsDocument
      );
      return {
        ...booking,
        access: restoreSensitiveAccess(booking.access, secrets),
      };
    } catch (error) {
      console.error(
        `Failed to decrypt sensitive access details for booking ${booking.id}:`,
        error
      );
      return booking;
    }
  });
}

export async function getBooking(bookingId: string): Promise<BookingRecord | null> {
  const snapshot = await adminDb.collection('bookings').doc(bookingId).get();
  return snapshot.exists ? ({ ...(snapshot.data() as BookingRecord), id: snapshot.id }) : null;
}

export async function findBookingByToken(token: string): Promise<BookingRecord | null> {
  const snapshot = await adminDb.collection('bookings').where('managementToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { ...(doc.data() as BookingRecord), id: doc.id };
}

export async function activeBookingsForDate(dateKey: string): Promise<BookingRecord[]> {
  const snapshot = await adminDb.collection('bookings').where('appointment.dateKey', '==', dateKey).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as BookingRecord), id: doc.id }))
    .filter((booking) => booking.status === 'confirmed');
}

export async function updateBooking(bookingId: string, changes: Partial<BookingRecord>): Promise<BookingRecord | null> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  await ref.set({ ...changes, updatedAt: new Date().toISOString() }, { merge: true });
  const updated = await ref.get();
  return { ...(updated.data() as BookingRecord), id: updated.id };
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function clientOrganisationIdFor(uid: string): string {
  return `org_${stableHash(uid)}`;
}

function clientMembershipIdFor(organisationId: string, email: string): string {
  return `membership_${stableHash(`${organisationId}|${normaliseEmail(email)}`)}`;
}

function clientPropertyKey(organisationId: string, property: {
  unit?: string;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
}): string {
  const address = [
    property.unit || '',
    property.streetAddress,
    property.suburb,
    property.state,
    property.postcode,
  ]
    .map((value) => value.trim().toLowerCase())
    .join('|');

  return `property_${stableHash(`${organisationId}|${address}`)}`;
}

export interface ClientContext {
  profile: ClientProfile;
  organisation: ClientOrganisation;
  membership: ClientMembership;
}

async function activeMembershipsForUid(uid: string): Promise<ClientMembership[]> {
  const snapshot = await adminDb
    .collection('clientMemberships')
    .where('uid', '==', uid)
    .get();

  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientMembership), id: doc.id }))
    .filter((membership) => membership.status === 'active');
}

async function claimInvitations(params: { uid: string; email: string; displayName?: string }): Promise<void> {
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
}

async function createDefaultClientOrganisation(params: { uid: string; email: string; displayName?: string }): Promise<{ organisation: ClientOrganisation; membership: ClientMembership }> {
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
}

export async function ensureClientContext(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientContext> {
  const email = normaliseEmail(params.email);
  const profileRef = adminDb.collection('clientUsers').doc(params.uid);
  const existingProfile = await profileRef.get();
  const now = new Date().toISOString();
  const current = existingProfile.exists
    ? (existingProfile.data() as Partial<ClientProfile>)
    : {};

  if (current.active === false) {
    throw new Error('CLIENT_ACCOUNT_DISABLED');
  }

  await claimInvitations({
    uid: params.uid,
    email,
    displayName: params.displayName,
  });

  let memberships = (await activeMembershipsForUid(params.uid)).filter(item => item.email === email);
  if (memberships.length === 0) {
    const created = await createDefaultClientOrganisation({
      uid: params.uid,
      email,
      displayName: params.displayName,
    });
    memberships = [created.membership];
  }

  const activeOrganisationId =
    memberships.find((item) => item.organisationId === current.activeOrganisationId)
      ?.organisationId || memberships[0].organisationId;
  const membership =
    memberships.find((item) => item.organisationId === activeOrganisationId) ||
    memberships[0];

  const organisationDoc = await adminDb
    .collection('clientOrganisations')
    .doc(membership.organisationId)
    .get();

  if (!organisationDoc.exists) {
    throw new Error('CLIENT_ORGANISATION_NOT_FOUND');
  }

  const organisation = {
    ...(organisationDoc.data() as ClientOrganisation),
    id: organisationDoc.id,
  };

  const profile: ClientProfile = {
    uid: params.uid,
    email,
    displayName:
      params.displayName?.trim() ||
      current.displayName ||
      membership.displayName ||
      email,
    phone: current.phone,
    active: true,
    onboardingStatus: current.onboardingStatus || 'not_started',
    activeOrganisationId: membership.organisationId,
    createdAt: current.createdAt || now,
    updatedAt: now,
  };

  const finalMembership = await adminDb.runTransaction(async tx => {
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
  return { profile, organisation, membership: finalMembership };
}

export async function ensureClientProfile(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientProfile> {
  return (await ensureClientContext(params)).profile;
}

export async function activateClientOrganisation(params: {
  uid: string;
  email: string;
  organisationId: string;
}): Promise<ClientContext> {
  const memberships = await activeMembershipsForUid(params.uid);
  if (!memberships.some((item) => item.organisationId === params.organisationId)) {
    throw new Error('CLIENT_ORGANISATION_FORBIDDEN');
  }

  await adminDb.collection('clientUsers').doc(params.uid).set(
    {
      activeOrganisationId: params.organisationId,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return ensureClientContext(params);
}

async function upsertClientProperty(params: {
  organisationId: string;
  createdByUid: string;
  property: PropertyDetails | ClientPropertyInput;
  category?: ServiceCategory;
  lastBookingAt?: string;
}): Promise<ClientProperty> {
  const id = clientPropertyKey(params.organisationId, params.property);
  const ref = adminDb.collection('clientProperties').doc(id);
  const existing = await ref.get();
  const now = new Date().toISOString();
  const current = existing.exists
    ? (existing.data() as Partial<ClientProperty>)
    : {};
  const propertyCategories = Array.isArray((params.property as ClientPropertyInput).categories)
    ? (params.property as ClientPropertyInput).categories
    : [];
  const categories = Array.from(
    new Set<ServiceCategory>([
      ...((current.categories || []) as ServiceCategory[]),
      ...propertyCategories,
      ...(params.category ? [params.category] : []),
    ])
  );

  const record: ClientProperty = {
    id,
    organisationId: params.organisationId,
    createdByUid: current.createdByUid || params.createdByUid,
    streetAddress: params.property.streetAddress,
    unit: params.property.unit,
    suburb: params.property.suburb,
    state: params.property.state,
    postcode: params.property.postcode,
    propertyType: params.property.propertyType,
    nickname:
      'nickname' in params.property
        ? params.property.nickname
        : current.nickname,
    clientName:
      'clientName' in params.property
        ? params.property.clientName
        : current.clientName,
    clientReference:
      'clientReference' in params.property
        ? params.property.clientReference
        : current.clientReference,
    categories,
    notes:
      'notes' in params.property
        ? params.property.notes
        : current.notes,
    status: current.status || 'active',
    createdAt: current.createdAt || now,
    updatedAt: now,
    lastBookingAt: params.lastBookingAt || current.lastBookingAt,
  };

  await ref.set(record, { merge: true });
  return record;
}

export async function createClientProperty(params: {
  context: ClientContext;
  input: ClientPropertyInput;
}): Promise<ClientProperty> {
  await assertClientWrite(params.context);
  if (params.context.membership.role === 'viewer') {
    throw new Error('CLIENT_WRITE_FORBIDDEN');
  }

  return upsertClientProperty({
    organisationId: params.context.organisation.id,
    createdByUid: params.context.profile.uid,
    property: params.input,
  });
}

export async function findClientPropertyByAddress(params: {
  organisationId: string;
  unit?: string;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
}): Promise<ClientProperty | null> {
  const propertyId = clientPropertyKey(params.organisationId, params);
  return getClientProperty({
    organisationId: params.organisationId,
    propertyId,
  });
}

export async function getClientProperty(params: {
  organisationId: string;
  propertyId: string;
}): Promise<ClientProperty | null> {
  const doc = await adminDb.collection('clientProperties').doc(params.propertyId).get();
  if (!doc.exists) return null;
  const property = { ...(doc.data() as ClientProperty), id: doc.id };
  return property.organisationId === params.organisationId ? property : null;
}

export async function updateClientProperty(params: {
  context: ClientContext;
  propertyId: string;
  changes: Partial<Pick<ClientProperty, 'nickname' | 'clientReference' | 'categories' | 'notes' | 'status'>>;
}): Promise<ClientProperty> {
  await assertClientWrite(params.context);
  if (params.context.membership.role === 'viewer') {
    throw new Error('CLIENT_WRITE_FORBIDDEN');
  }

  const property = await getClientProperty({
    organisationId: params.context.organisation.id,
    propertyId: params.propertyId,
  });
  if (!property) throw new Error('CLIENT_PROPERTY_NOT_FOUND');

  await adminDb.collection('clientProperties').doc(property.id).set(
    {
      ...params.changes,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return {
    ...property,
    ...params.changes,
    updatedAt: new Date().toISOString(),
  };
}

export async function completeClientOnboarding(params: {
  context: ClientContext;
  input: ClientOnboardingInput;
}): Promise<ClientContext> {
  await assertClientWrite(params.context, ['owner', 'admin']);

  const now = new Date().toISOString();
  const organisationPatch: Partial<ClientOrganisation> = {
    name: params.input.organisationName,
    entityType: params.input.entityType,
    abn: params.input.abn,
    acn: params.input.acn,
    billingEmail: params.input.billingEmail || params.context.profile.email,
    phone: params.input.phone,
    updatedAt: now,
  };

  await Promise.all([
    adminDb
      .collection('clientOrganisations')
      .doc(params.context.organisation.id)
      .set(organisationPatch, { merge: true }),
    adminDb
      .collection('clientUsers')
      .doc(params.context.profile.uid)
      .set(
        {
          displayName: params.input.displayName,
          phone: params.input.phone,
          onboardingStatus: 'complete',
          updatedAt: now,
        },
        { merge: true }
      ),
  ]);

  if (params.input.firstProperty) {
    await createClientProperty({
      context: params.context,
      input: params.input.firstProperty,
    });
  }

  return ensureClientContext({
    uid: params.context.profile.uid,
    email: params.context.profile.email,
    displayName: params.input.displayName,
  });
}

export async function inviteClientOrganisationMember(params: { context: ClientContext; email: string; role: Exclude<ClientOrganisationRole, 'owner'> }): Promise<ClientMembership> {
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
}

export async function updateClientOrganisationMember(params: { context: ClientContext; membershipId: string; role?: Exclude<ClientOrganisationRole, 'owner'>; status?: 'active' | 'revoked' }): Promise<ClientMembership> {
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
    tx.update(ref, { ...updated });
    return updated;
  });
}

/** Linking a historical booking requires its secure management token, not email alone. */
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
}

export async function linkBookingToClient(params: {
  context: ClientContext;
  booking: BookingRecord;
}): Promise<{
  clientUid: string;
  clientOrganisationId: string;
  propertyId: string;
}> {
  await assertClientWrite(params.context);
  const property = await upsertClientProperty({
    organisationId: params.context.organisation.id,
    createdByUid: params.context.profile.uid,
    property: params.booking.property,
    category: params.booking.serviceCategory,
    lastBookingAt: params.booking.appointment.start,
  });

  return {
    clientUid: params.context.profile.uid,
    clientOrganisationId: params.context.organisation.id,
    propertyId: property.id,
  };
}

function clientBookingView(booking: BookingRecord): ClientBookingSummary {
  return {
    id: booking.id,
    bookingReference: booking.bookingReference,
    propertyId: booking.propertyId,
    serviceName: booking.serviceName,
    serviceCategory: booking.serviceCategory,
    status: booking.status,
    property: {
      streetAddress: booking.property.streetAddress,
      unit: booking.property.unit,
      suburb: booking.property.suburb,
      state: booking.property.state,
      postcode: booking.property.postcode,
      propertyType: booking.property.propertyType,
    },
    appointment: {
      start: booking.appointment.start,
      end: booking.appointment.end,
      dateString: booking.appointment.dateString,
      timeString: booking.appointment.timeString,
      durationMinutes: booking.appointment.durationMinutes,
      timezone: booking.appointment.timezone,
    },
    createdAt: booking.createdAt,
  };
}

export async function createClientRequest(params: {
  context: ClientContext;
  type: ClientRequestType;
  title: string;
  propertyId?: string;
  priority?: 'routine' | 'priority' | 'urgent';
  details?: Record<string, string | number | boolean | string[]>;
}): Promise<ClientRequestSummary> {
  await assertClientWrite(params.context);
  if (params.context.membership.role === 'viewer') {
    throw new Error('CLIENT_WRITE_FORBIDDEN');
  }

  if (params.propertyId) {
    const property = await getClientProperty({
      organisationId: params.context.organisation.id,
      propertyId: params.propertyId,
    });
    if (!property) throw new Error('CLIENT_PROPERTY_NOT_FOUND');
  }

  const ref = adminDb.collection('clientRequests').doc();
  const now = new Date().toISOString();
  const request: ClientRequestSummary = {
    id: ref.id,
    organisationId: params.context.organisation.id,
    clientUid: params.context.profile.uid,
    propertyId: params.propertyId,
    type: params.type,
    title: params.title,
    status: 'submitted',
    priority: params.priority,
    details: params.details,
    attachmentDocumentIds: [],
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(request);
  return request;
}

export async function getClientRequest(params: {
  organisationId: string;
  requestId: string;
}): Promise<ClientRequestSummary | null> {
  const doc = await adminDb.collection('clientRequests').doc(params.requestId).get();
  if (!doc.exists) return null;
  const request = { ...(doc.data() as ClientRequestSummary), id: doc.id };
  return request.organisationId === params.organisationId ? request : null;
}

export async function updateClientRequest(params: {
  context: ClientContext;
  requestId: string;
  changes: Partial<Pick<ClientRequestSummary, 'status' | 'attachmentDocumentIds' | 'generatedDocumentId' | 'draftGenerationStatus'>>;
}): Promise<ClientRequestSummary> {
  await assertClientWrite(params.context);
  const ref = adminDb.collection('clientRequests').doc(params.requestId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('CLIENT_REQUEST_NOT_FOUND');
  const request = { ...(doc.data() as ClientRequestSummary), id: doc.id };

  if (request.organisationId !== params.context.organisation.id) {
    throw new Error('CLIENT_REQUEST_FORBIDDEN');
  }

  const updated = {
    ...request,
    ...params.changes,
    updatedAt: new Date().toISOString(),
  };
  await ref.set(updated, { merge: true });
  return updated;
}

export async function claimClientDocumentDraftGeneration(params: { context: ClientContext; requestId: string }): Promise<ClientRequestSummary> {
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
}

export async function releaseClientDocumentDraftGeneration(params: { context: ClientContext; requestId: string; generationToken: string }): Promise<void> {
  const ref = adminDb.collection('clientRequests').doc(params.requestId);
  await adminDb.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const request = doc.data() as ClientRequestSummary | undefined;
    if (!request || request.organisationId !== params.context.organisation.id || request.generatedDocumentId ||
        request.draftGenerationStatus !== 'generating' || request.draftGenerationToken !== params.generationToken) return;
    tx.update(ref, { draftGenerationStatus: 'failed', draftGenerationToken: '', draftGenerationExpiresAt: '', updatedAt: new Date().toISOString() });
  });
}

export async function createClientDocument(params: { context: ClientContext; propertyId?: string; requestId?: string; name: string; documentType: string;
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
}

function clientDocumentView(
  document: ClientDocumentSummary
): ClientDocumentSummary {
  const { storagePath: _storagePath, ...safe } = document;
  return safe;
}

export async function getClientDocument(params: {
  organisationId: string;
  documentId: string;
}): Promise<ClientDocumentSummary | null> {
  const doc = await adminDb.collection('clientDocuments').doc(params.documentId).get();
  if (!doc.exists) return null;
  const document = { ...(doc.data() as ClientDocumentSummary), id: doc.id };
  return document.organisationId === params.organisationId && document.status !== 'archived' ? document : null;
}

export async function getClientDocumentForAdmin(
  documentId: string
): Promise<ClientDocumentSummary | null> {
  const doc = await adminDb.collection('clientDocuments').doc(documentId).get();
  return doc.exists
    ? ({ ...(doc.data() as ClientDocumentSummary), id: doc.id })
    : null;
}

export async function listClientDocumentsForAdmin(): Promise<ClientDocumentSummary[]> {
  const snapshot = await adminDb
    .collection('clientDocuments')
    .orderBy('updatedAt', 'desc')
    .limit(1000)
    .get();
  return snapshot.docs.map((doc) =>
    clientDocumentView({
      ...(doc.data() as ClientDocumentSummary),
      id: doc.id,
    })
  );
}

export async function createClientApproval(params: {
  context: ClientContext;
  propertyId?: string;
  requestId?: string;
  documentId?: string;
  type: ClientApproval['type'];
  title: string;
  summary?: string;
}): Promise<ClientApproval> {
  await assertClientWrite(params.context);
  const ref = adminDb.collection('clientApprovals').doc();
  const now = new Date().toISOString();
  const approval: ClientApproval = {
    id: ref.id,
    organisationId: params.context.organisation.id,
    propertyId: params.propertyId,
    requestId: params.requestId,
    documentId: params.documentId,
    type: params.type,
    title: params.title,
    summary: params.summary,
    status: 'pending',
    requestedByUid: params.context.profile.uid,
    requestedAt: now,
    updatedAt: now,
  };
  await ref.set(approval);
  return approval;
}

export async function respondToClientApproval(params: {
  context: ClientContext;
  approvalId: string;
  status: 'approved' | 'changes_requested' | 'declined';
  comment?: string;
}): Promise<ClientApproval> {
  if (params.context.membership.role === 'viewer') {
    throw new Error('CLIENT_WRITE_FORBIDDEN');
  }

  const approvalRef = adminDb.collection('clientApprovals').doc(params.approvalId);
  let updatedApproval: ClientApproval | null = null;

  await adminDb.runTransaction(async (transaction) => {
    await authoriseClientWrite(transaction, params.context);
    const approvalDoc = await transaction.get(approvalRef);
    if (!approvalDoc.exists) throw new Error('CLIENT_APPROVAL_NOT_FOUND');

    const approval = {
      ...(approvalDoc.data() as ClientApproval),
      id: approvalDoc.id,
    };

    if (approval.organisationId !== params.context.organisation.id) {
      throw new Error('CLIENT_APPROVAL_FORBIDDEN');
    }

    if (approval.status !== 'pending') {
      throw new Error('CLIENT_APPROVAL_ALREADY_RESPONDED');
    }

    let requestRef:
      | ReturnType<ReturnType<typeof adminDb.collection>['doc']>
      | undefined;

    if (approval.requestId) {
      const candidateRef = adminDb.collection('clientRequests').doc(approval.requestId);
      const requestDoc = await transaction.get(candidateRef);
      if (requestDoc.exists) {
        const request = requestDoc.data() as ClientRequestSummary;
        if (request.organisationId === params.context.organisation.id) {
          requestRef = candidateRef;
        }
      }
    }

    const now = new Date().toISOString();
    updatedApproval = {
      ...approval,
      status: params.status,
      responseComment: params.comment,
      respondedByUid: params.context.profile.uid,
      respondedAt: now,
      updatedAt: now,
    };

    transaction.set(approvalRef, updatedApproval, { merge: true });

    if (requestRef) {
      transaction.set(
        requestRef,
        {
          status: 'in_progress',
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  if (!updatedApproval) throw new Error('CLIENT_APPROVAL_NOT_FOUND');
  return updatedApproval;
}

export async function getClientPortalDashboard(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientPortalDashboard> {
  const context = await ensureClientContext(params);
  const memberships = await activeMembershipsForUid(params.uid);

  // Historical bookings are linked only by an explicit secure-token claim.

  const organisationDocs = await Promise.all(
    memberships.map((membership) =>
      adminDb.collection('clientOrganisations').doc(membership.organisationId).get()
    )
  );

  const [
    membersSnapshot,
    propertiesSnapshot,
    bookingsSnapshot,
    requestsSnapshot,
    documentsSnapshot,
    approvalsSnapshot,
  ] = await Promise.all([
    adminDb
      .collection('clientMemberships')
      .where('organisationId', '==', context.organisation.id)
      .get(),
    adminDb
      .collection('clientProperties')
      .where('organisationId', '==', context.organisation.id)
      .get(),
    adminDb
      .collection('bookings')
      .where('clientOrganisationId', '==', context.organisation.id)
      .get(),
    adminDb
      .collection('clientRequests')
      .where('organisationId', '==', context.organisation.id)
      .get(),
    adminDb
      .collection('clientDocuments')
      .where('organisationId', '==', context.organisation.id)
      .get(),
    adminDb
      .collection('clientApprovals')
      .where('organisationId', '==', context.organisation.id)
      .get(),
  ]);

  const organisations = memberships.flatMap((membership, index) => {
    const doc = organisationDocs[index];
    if (!doc?.exists) return [];
    return [{
      organisation: {
        ...(doc.data() as ClientOrganisation),
        id: doc.id,
      },
      role: membership.role,
    }];
  });

  const members = membersSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientMembership), id: doc.id }))
    .filter((membership) => membership.status !== 'revoked')
    .sort((a, b) => a.email.localeCompare(b.email));

  const properties = propertiesSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientProperty), id: doc.id }))
    .filter((property) => property.status !== 'inactive')
    .sort((a, b) => (b.lastBookingAt || '').localeCompare(a.lastBookingAt || ''));

  const bookings = bookingsSnapshot.docs
    .map((doc) => clientBookingView({ ...(doc.data() as BookingRecord), id: doc.id }))
    .sort(
      (a, b) =>
        new Date(b.appointment.start).getTime() -
        new Date(a.appointment.start).getTime()
    );

  const requests = requestsSnapshot.docs
    .map((doc) => { const { draftGenerationToken: _token, ...safe } = doc.data() as ClientRequestSummary; return { ...safe, id: doc.id }; })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const documents = documentsSnapshot.docs
    .filter(doc => doc.data().status !== 'archived')
    .map((doc) =>
      clientDocumentView({
        ...(doc.data() as ClientDocumentSummary),
        id: doc.id,
      })
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const approvals = approvalsSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientApproval), id: doc.id }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    profile: context.profile,
    organisation: context.organisation,
    organisations,
    membership: context.membership,
    members,
    properties,
    bookings,
    requests,
    documents,
    approvals,
  };
}

export async function listClientRequestsForAdmin(): Promise<ClientRequestSummary[]> {
  const snapshot = await adminDb
    .collection('clientRequests')
    .orderBy('updatedAt', 'desc')
    .limit(500)
    .get();

  const requests = snapshot.docs.map((doc) => ({
    ...(doc.data() as ClientRequestSummary),
    id: doc.id,
  }));

  const organisationIds = Array.from(
    new Set(requests.map((request) => request.organisationId).filter(Boolean))
  );
  const propertyIds = Array.from(
    new Set(requests.map((request) => request.propertyId).filter((id): id is string => Boolean(id)))
  );
  const clientUids = Array.from(
    new Set(requests.map((request) => request.clientUid).filter(Boolean))
  );

  const [organisationDocs, propertyDocs, clientDocs] = await Promise.all([
    organisationIds.length
      ? adminDb.getAll(
          ...organisationIds.map((id) => adminDb.collection('clientOrganisations').doc(id))
        )
      : [],
    propertyIds.length
      ? adminDb.getAll(
          ...propertyIds.map((id) => adminDb.collection('clientProperties').doc(id))
        )
      : [],
    clientUids.length
      ? adminDb.getAll(
          ...clientUids.map((uid) => adminDb.collection('clientUsers').doc(uid))
        )
      : [],
  ]);

  const organisations = new Map(
    organisationDocs
      .filter((doc) => doc.exists)
      .map((doc) => [doc.id, doc.data() as ClientOrganisation])
  );
  const properties = new Map(
    propertyDocs
      .filter((doc) => doc.exists)
      .map((doc) => [doc.id, doc.data() as ClientProperty])
  );
  const clients = new Map(
    clientDocs
      .filter((doc) => doc.exists)
      .map((doc) => [doc.id, doc.data() as ClientProfile])
  );

  return requests.map((request) => {
    const organisation = organisations.get(request.organisationId);
    const property = request.propertyId
      ? properties.get(request.propertyId)
      : undefined;
    const client = clients.get(request.clientUid);

    return {
      ...request,
      organisationName: organisation?.name,
      propertyAddress: property
        ? [
            property.unit
              ? `${property.unit}, ${property.streetAddress}`
              : property.streetAddress,
            `${property.suburb} ${property.state} ${property.postcode}`,
          ].join(', ')
        : undefined,
      submittedByName: client?.displayName,
      submittedByEmail: client?.email,
    };
  });
}

export async function listClientApprovalsForAdmin(): Promise<ClientApproval[]> {
  const snapshot = await adminDb
    .collection('clientApprovals')
    .orderBy('updatedAt', 'desc')
    .limit(500)
    .get();
  return snapshot.docs.map((doc) => ({
    ...(doc.data() as ClientApproval),
    id: doc.id,
  }));
}

export async function updateClientRequestForAdmin(params: {
  requestId: string;
  status: ClientRequestSummary['status'];
}): Promise<ClientRequestSummary | null> {
  const ref = adminDb.collection('clientRequests').doc(params.requestId);
  const doc = await ref.get();
  if (!doc.exists) return null;

  const updatedAt = new Date().toISOString();
  await ref.set(
    {
      status: params.status,
      updatedAt,
    },
    { merge: true }
  );
  const updated = await ref.get();
  return {
    ...(updated.data() as ClientRequestSummary),
    id: updated.id,
  };
}


const SCHEDULE_LOCK_INTERVAL_MINUTES = 15;

function scheduleLockIndexes(
  startIso: string,
  endIso: string,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): number[] {
  const intervalMs = SCHEDULE_LOCK_INTERVAL_MINUTES * 60_000;
  const startMs = new Date(startIso).getTime() - bufferBeforeMinutes * 60_000;
  const endMs = new Date(endIso).getTime() + bufferAfterMinutes * 60_000;
  const first = Math.floor(startMs / intervalMs);
  const lastExclusive = Math.ceil(endMs / intervalMs);
  const indexes: number[] = [];

  for (let index = first; index < lastExclusive; index += 1) {
    indexes.push(index);
  }

  return indexes;
}

function calendarLockPrefix(calendarId: string): string {
  return createHash('sha256').update(calendarId).digest('hex').slice(0, 16);
}

export class ScheduleLockConflictError extends Error {
  constructor() {
    super('The requested appointment is currently being confirmed by another booking.');
    this.name = 'ScheduleLockConflictError';
  }
}

export async function acquireScheduleLocks(params: {
  bookingId: string;
  calendarId: string;
  start: string;
  end: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}): Promise<void> {
  const prefix = calendarLockPrefix(params.calendarId);
  const indexes = scheduleLockIndexes(
    params.start,
    params.end,
    params.bufferBeforeMinutes,
    params.bufferAfterMinutes
  );
  const refs = indexes.map((index) =>
    adminDb.collection('scheduleLocks').doc(`${prefix}_${index}`)
  );
  const now = Date.now();
  const temporaryExpiry = new Date(now + 5 * 60_000).toISOString();

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const data = snapshot.data();
      const expiresAt = Date.parse(String(data?.expiresAt || ''));

      if (
        data?.bookingId !== params.bookingId &&
        Number.isFinite(expiresAt) &&
        expiresAt > now
      ) {
        throw new ScheduleLockConflictError();
      }
    }

    for (const ref of refs) {
      transaction.set(ref, {
        bookingId: params.bookingId,
        expiresAt: temporaryExpiry,
        updatedAt: new Date().toISOString(),
      });
    }
  });
}

export async function releaseScheduleLocks(bookingId: string): Promise<void> {
  const snapshot = await adminDb
    .collection('scheduleLocks')
    .where('bookingId', '==', bookingId)
    .get();

  if (snapshot.empty) return;

  const batch = adminDb.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
