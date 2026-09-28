import type { Transaction } from 'firebase-admin/firestore';
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
