import { createHash } from 'crypto';
import type { BookingRecord, BusinessSettings, InspectionService, PropertyDetails, ServiceCategory } from '../types/booking.js';
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
import { adminDb } from './firebaseAdmin.js';
import {
  decryptAccessSecrets,
  restoreSensitiveAccess,
  type EncryptedAccessSecretsDocument,
} from './accessSecrets.js';

const SETTINGS_ID = 'business';
const SERVICE_CATALOGUE_META_ID = 'serviceCatalogue';
const SERVICE_CATALOGUE_VERSION = 4;
let seeded: Promise<void> | null = null;

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

async function claimInvitations(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<void> {
  const snapshot = await adminDb
    .collection('clientMemberships')
    .where('email', '==', normaliseEmail(params.email))
    .get();

  const batch = adminDb.batch();
  let changed = false;
  const now = new Date().toISOString();

  snapshot.docs.forEach((doc) => {
    const membership = doc.data() as ClientMembership;
    if (membership.status !== 'invited') return;
    if (membership.uid && membership.uid !== params.uid) return;

    batch.set(
      doc.ref,
      {
        uid: params.uid,
        displayName: params.displayName || membership.displayName,
        status: 'active',
        updatedAt: now,
      },
      { merge: true }
    );
    changed = true;
  });

  if (changed) await batch.commit();
}

async function createDefaultClientOrganisation(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<{ organisation: ClientOrganisation; membership: ClientMembership }> {
  const now = new Date().toISOString();
  const organisationId = clientOrganisationIdFor(params.uid);
  const organisationRef = adminDb.collection('clientOrganisations').doc(organisationId);
  const membershipId = clientMembershipIdFor(organisationId, params.email);
  const membershipRef = adminDb.collection('clientMemberships').doc(membershipId);
  const existingOrganisation = await organisationRef.get();

  const organisation: ClientOrganisation = existingOrganisation.exists
    ? ({ ...(existingOrganisation.data() as ClientOrganisation), id: organisationId })
    : {
        id: organisationId,
        name: params.displayName?.trim() || params.email,
        entityType: 'individual',
        billingEmail: normaliseEmail(params.email),
        createdByUid: params.uid,
        createdAt: now,
        updatedAt: now,
      };

  const membership: ClientMembership = {
    id: membershipId,
    organisationId,
    email: normaliseEmail(params.email),
    uid: params.uid,
    displayName: params.displayName,
    role: 'owner',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const batch = adminDb.batch();
  if (!existingOrganisation.exists) batch.set(organisationRef, organisation);
  batch.set(membershipRef, membership, { merge: true });
  await batch.commit();

  return { organisation, membership };
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

  let memberships = await activeMembershipsForUid(params.uid);
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

  await profileRef.set(profile, { merge: true });
  return { profile, organisation, membership };
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
  if (params.context.membership.role === 'viewer') {
    throw new Error('CLIENT_WRITE_FORBIDDEN');
  }

  return upsertClientProperty({
    organisationId: params.context.organisation.id,
    createdByUid: params.context.profile.uid,
    property: params.input,
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
  if (!['owner', 'admin'].includes(params.context.membership.role)) {
    throw new Error('CLIENT_ORGANISATION_ADMIN_REQUIRED');
  }

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

export async function inviteClientOrganisationMember(params: {
  context: ClientContext;
  email: string;
  role: Exclude<ClientOrganisationRole, 'owner'>;
}): Promise<ClientMembership> {
  if (!['owner', 'admin'].includes(params.context.membership.role)) {
    throw new Error('CLIENT_ORGANISATION_ADMIN_REQUIRED');
  }

  const email = normaliseEmail(params.email);
  const id = clientMembershipIdFor(params.context.organisation.id, email);
  const ref = adminDb.collection('clientMemberships').doc(id);
  const existing = await ref.get();
  const now = new Date().toISOString();
  const current = existing.exists
    ? (existing.data() as Partial<ClientMembership>)
    : {};

  const membership: ClientMembership = {
    id,
    organisationId: params.context.organisation.id,
    email,
    uid: current.uid,
    displayName: current.displayName,
    role: params.role,
    status: current.uid ? 'active' : 'invited',
    invitedByUid: params.context.profile.uid,
    createdAt: current.createdAt || now,
    updatedAt: now,
  };

  await ref.set(membership, { merge: true });
  return membership;
}

export async function updateClientOrganisationMember(params: {
  context: ClientContext;
  membershipId: string;
  role?: Exclude<ClientOrganisationRole, 'owner'>;
  status?: 'active' | 'revoked';
}): Promise<ClientMembership> {
  if (params.context.membership.role !== 'owner') {
    throw new Error('CLIENT_ORGANISATION_OWNER_REQUIRED');
  }

  const ref = adminDb.collection('clientMemberships').doc(params.membershipId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('CLIENT_MEMBERSHIP_NOT_FOUND');
  const membership = { ...(doc.data() as ClientMembership), id: doc.id };

  if (
    membership.organisationId !== params.context.organisation.id ||
    membership.role === 'owner'
  ) {
    throw new Error('CLIENT_MEMBERSHIP_FORBIDDEN');
  }

  const updated: ClientMembership = {
    ...membership,
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status } : {}),
    updatedAt: new Date().toISOString(),
  };
  await ref.set(updated, { merge: true });
  return updated;
}

export async function linkHistoricalBookingsToClient(params: {
  context: ClientContext;
}): Promise<void> {
  const email = normaliseEmail(params.context.profile.email);
  const snapshot = await adminDb
    .collection('bookings')
    .where('property.customerEmail', '==', email)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  for (const doc of snapshot.docs) {
    const booking = { ...(doc.data() as BookingRecord), id: doc.id };
    if (
      booking.clientOrganisationId &&
      booking.clientOrganisationId !== params.context.organisation.id
    ) {
      continue;
    }

    const property = await upsertClientProperty({
      organisationId: params.context.organisation.id,
      createdByUid: params.context.profile.uid,
      property: booking.property,
      category: booking.serviceCategory,
      lastBookingAt: booking.appointment.start,
    });

    if (
      booking.clientUid !== params.context.profile.uid ||
      booking.clientOrganisationId !== params.context.organisation.id ||
      booking.propertyId !== property.id
    ) {
      await doc.ref.set(
        {
          clientUid: params.context.profile.uid,
          clientOrganisationId: params.context.organisation.id,
          propertyId: property.id,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }
}

export async function linkBookingToClient(params: {
  context: ClientContext;
  booking: BookingRecord;
}): Promise<{
  clientUid: string;
  clientOrganisationId: string;
  propertyId: string;
}> {
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

export async function updateClientRequest(params: {
  context: ClientContext;
  requestId: string;
  changes: Partial<Pick<ClientRequestSummary, 'status' | 'attachmentDocumentIds' | 'generatedDocumentId'>>;
}): Promise<ClientRequestSummary> {
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

export async function createClientDocument(params: {
  context: ClientContext;
  propertyId?: string;
  requestId?: string;
  name: string;
  documentType: string;
  status: 'available' | 'draft' | 'archived';
  storagePath: string;
  contentType?: string;
  sizeBytes?: number;
  generated?: boolean;
}): Promise<ClientDocumentSummary> {
  if (params.propertyId) {
    const property = await getClientProperty({
      organisationId: params.context.organisation.id,
      propertyId: params.propertyId,
    });
    if (!property) throw new Error('CLIENT_PROPERTY_NOT_FOUND');
  }

  const ref = adminDb.collection('clientDocuments').doc();
  const now = new Date().toISOString();
  const document: ClientDocumentSummary = {
    id: ref.id,
    organisationId: params.context.organisation.id,
    clientUid: params.context.profile.uid,
    propertyId: params.propertyId,
    requestId: params.requestId,
    name: params.name,
    documentType: params.documentType,
    status: params.status,
    storagePath: params.storagePath,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
    generated: params.generated,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(document);

  if (params.requestId) {
    const requestRef = adminDb.collection('clientRequests').doc(params.requestId);
    const requestDoc = await requestRef.get();
    if (requestDoc.exists) {
      const request = requestDoc.data() as ClientRequestSummary;
      if (request.organisationId === params.context.organisation.id) {
        const attachments = Array.from(
          new Set([...(request.attachmentDocumentIds || []), document.id])
        );
        await requestRef.set(
          {
            attachmentDocumentIds: attachments,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }
  }

  return document;
}

export async function getClientDocument(params: {
  organisationId: string;
  documentId: string;
}): Promise<ClientDocumentSummary | null> {
  const doc = await adminDb.collection('clientDocuments').doc(params.documentId).get();
  if (!doc.exists) return null;
  const document = { ...(doc.data() as ClientDocumentSummary), id: doc.id };
  return document.organisationId === params.organisationId ? document : null;
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

  const ref = adminDb.collection('clientApprovals').doc(params.approvalId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('CLIENT_APPROVAL_NOT_FOUND');
  const approval = { ...(doc.data() as ClientApproval), id: doc.id };
  if (approval.organisationId !== params.context.organisation.id) {
    throw new Error('CLIENT_APPROVAL_FORBIDDEN');
  }

  const now = new Date().toISOString();
  const updated: ClientApproval = {
    ...approval,
    status: params.status,
    responseComment: params.comment,
    respondedByUid: params.context.profile.uid,
    respondedAt: now,
    updatedAt: now,
  };
  await ref.set(updated, { merge: true });
  return updated;
}

export async function getClientPortalDashboard(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientPortalDashboard> {
  const context = await ensureClientContext(params);
  await linkHistoricalBookingsToClient({ context });

  const memberships = await activeMembershipsForUid(params.uid);
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
    .map((doc) => ({ ...(doc.data() as ClientRequestSummary), id: doc.id }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const documents = documentsSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientDocumentSummary), id: doc.id }))
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
  return snapshot.docs.map((doc) => ({
    ...(doc.data() as ClientRequestSummary),
    id: doc.id,
  }));
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
