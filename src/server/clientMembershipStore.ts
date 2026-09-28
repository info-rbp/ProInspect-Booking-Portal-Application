import { createHash } from 'crypto';
import { adminDb } from './firebaseAdmin.js';
import type { ClientRecord, ClientUserRecord } from '../types/tenant.js';

export type CanonicalClientRole = 'owner' | 'admin' | 'member' | 'viewer';
export type CanonicalMembershipStatus = 'active' | 'invited' | 'revoked';

export interface CanonicalClientMembership {
  id: string;
  clientId: string;
  clientUserId: string;
  email: string;
  role: CanonicalClientRole;
  status: CanonicalMembershipStatus;
  invitedBy?: string;
  createdAt: string;
  updatedAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 28)}`;
}

export function canonicalClientMembershipId(clientUserId: string, clientId: string) {
  return stableId('cm', `${clientUserId}|${clientId}`);
}

function sameArray(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function upsertCanonicalClientMembership(input: {
  clientUserId: string;
  clientId: string;
  email: string;
  role: CanonicalClientRole;
  status?: CanonicalMembershipStatus;
  invitedBy?: string;
}) {
  const id = canonicalClientMembershipId(input.clientUserId, input.clientId);
  const ref = adminDb.collection('clientMemberships').doc(id);
  const existing = await ref.get();
  const now = nowIso();
  const record: CanonicalClientMembership = {
    id,
    clientId: input.clientId,
    clientUserId: input.clientUserId,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    status: input.status || 'active',
    invitedBy: input.invitedBy,
    createdAt: existing.exists ? String(existing.data()?.createdAt || now) : now,
    updatedAt: now,
  };
  await ref.set(record, { merge: true });
  return record;
}

export async function revokeCanonicalClientMembership(clientUserId: string, clientId: string) {
  const ref = adminDb.collection('clientMemberships').doc(
    canonicalClientMembershipId(clientUserId, clientId)
  );
  const existing = await ref.get();
  if (!existing.exists) return;
  await ref.set({ status: 'revoked', updatedAt: nowIso() }, { merge: true });
}

export async function syncCanonicalMembershipsFromCache(user: ClientUserRecord) {
  const clientIds = Array.from(new Set(Array.isArray(user.clientIds) ? user.clientIds : []));
  for (const clientId of clientIds) {
    await upsertCanonicalClientMembership({
      clientUserId: user.id,
      clientId,
      email: user.email,
      role: user.clientRoles?.[clientId] || 'member',
      status: 'active',
    });
  }
}

export async function hydrateClientUserFromCanonicalMemberships(
  user: ClientUserRecord
): Promise<ClientUserRecord> {
  let snapshot = await adminDb
    .collection('clientMemberships')
    .where('clientUserId', '==', user.id)
    .get();

  if (snapshot.empty && user.clientIds.length > 0) {
    await syncCanonicalMembershipsFromCache(user);
    snapshot = await adminDb
      .collection('clientMemberships')
      .where('clientUserId', '==', user.id)
      .get();
  }

  const active = snapshot.docs
    .map((doc) => ({ ...(doc.data() as CanonicalClientMembership), id: doc.id }))
    .filter((membership) => membership.status === 'active')
    .sort((a, b) => a.clientId.localeCompare(b.clientId));

  const clientIds = active.map((membership) => membership.clientId);
  const clientRoles = Object.fromEntries(
    active.map((membership) => [membership.clientId, membership.role])
  ) as Record<string, CanonicalClientRole>;

  const currentIds = [...(user.clientIds || [])].sort();
  const nextIds = [...clientIds].sort();
  const currentRoles = user.clientRoles || {};
  const rolesChanged =
    Object.keys(currentRoles).length !== Object.keys(clientRoles).length ||
    Object.entries(clientRoles).some(([clientId, role]) => currentRoles[clientId] !== role);

  if (!sameArray(currentIds, nextIds) || rolesChanged) {
    const updatedAt = nowIso();
    await adminDb.collection('clientUsers').doc(user.id).set(
      {
        clientIds,
        clientRoles,
        active: clientIds.length > 0 ? user.active : false,
        updatedAt,
      },
      { merge: true }
    );
    return {
      ...user,
      clientIds,
      clientRoles,
      active: clientIds.length > 0 ? user.active : false,
      updatedAt,
    };
  }

  return user;
}

export async function onboardCanonicalClient(input: {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  clientName: string;
  clientType: ClientRecord['clientType'];
  externalReference?: string;
}): Promise<{ client: ClientRecord; clientUser: ClientUserRecord }> {
  const email = input.email.trim().toLowerCase();
  const emailLower = email;
  const existingByEmail = await adminDb
    .collection('clientUsers')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();

  const userId = existingByEmail.empty
    ? stableId('client_user', input.uid)
    : existingByEmail.docs[0].id;
  const clientId = stableId('client_self', input.uid);
  const membershipId = canonicalClientMembershipId(userId, clientId);
  const userRef = adminDb.collection('clientUsers').doc(userId);
  const clientRef = adminDb.collection('clients').doc(clientId);
  const membershipRef = adminDb.collection('clientMemberships').doc(membershipId);

  const now = nowIso();
  await adminDb.runTransaction(async (transaction) => {
    const [userDoc, clientDoc, membershipDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(clientRef),
      transaction.get(membershipRef),
    ]);

    const userData = userDoc.exists ? userDoc.data() || {} : {};
    if (userData.firebaseUid && userData.firebaseUid !== input.uid) {
      throw new Error('CLIENT_IDENTITY_ALREADY_BOUND');
    }

    if (!clientDoc.exists) {
      transaction.set(clientRef, {
        id: clientId,
        name: input.clientName.trim(),
        clientType: input.clientType,
        email,
        phone: input.phone?.trim() || undefined,
        externalReference: input.externalReference?.trim() || undefined,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        onboardingSource: 'client-self-service',
      });
    }

    const existingIds = Array.isArray(userData.clientIds) ? userData.clientIds as string[] : [];
    const existingRoles =
      userData.clientRoles && typeof userData.clientRoles === 'object'
        ? userData.clientRoles as Record<string, CanonicalClientRole>
        : {};
    const clientIds = Array.from(new Set([...existingIds, clientId]));
    const clientRoles = { ...existingRoles, [clientId]: existingRoles[clientId] || 'owner' };

    transaction.set(userRef, {
      id: userId,
      email,
      emailLower,
      displayName: input.displayName.trim(),
      phone: input.phone?.trim() || userData.phone || undefined,
      firebaseUid: input.uid,
      clientIds,
      clientRoles,
      active: true,
      createdAt: userData.createdAt || now,
      updatedAt: now,
      lastLoginAt: now,
    }, { merge: true });

    transaction.set(membershipRef, {
      id: membershipId,
      clientId,
      clientUserId: userId,
      email,
      role: clientRoles[clientId],
      status: 'active',
      createdAt: membershipDoc.exists ? membershipDoc.data()?.createdAt || now : now,
      updatedAt: now,
    }, { merge: true });
  });

  const [clientDoc, userDoc] = await Promise.all([clientRef.get(), userRef.get()]);
  return {
    client: { ...(clientDoc.data() as ClientRecord), id: clientDoc.id },
    clientUser: {
      ...(userDoc.data() as ClientUserRecord),
      id: userDoc.id,
    },
  };
}
