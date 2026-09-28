import 'dotenv/config';
import { createHash } from 'crypto';
import { runMigration } from './stage3/migration-engine.js';
import { pathToFileURL } from 'node:url';

// Only the private planning database is exposed to transform.
const apply = true;

function normalise(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function propertyKey(property: any): string {
  return [
    normalise(property.unit),
    normalise(property.streetAddress),
    normalise(property.suburb),
    normalise(property.state || 'WA').toUpperCase(),
    normalise(property.postcode),
  ].join('|');
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function clientNameKey(value: unknown) {
  return normalise(value);
}

export async function transform(adminDb: any) {
  const legacyPropertyIds = new Map<string, string>();
  const [
    bookingSnapshot,
    propertySnapshot,
    clientSnapshot,
    clientUserSnapshot,
    membershipSnapshot,
    legacyOrganisations,
    legacyProperties,
    legacyDocuments,
  ] = await Promise.all([
    adminDb.collection('bookings').get(),
    adminDb.collection('properties').get(),
    adminDb.collection('clients').get(),
    adminDb.collection('clientUsers').get(),
    adminDb.collection('clientMemberships').get(),
    adminDb.collection('clientOrganisations').get(),
    adminDb.collection('clientProperties').get(),
    adminDb.collection('clientDocuments').get(),
  ]);

  const legacyMembershipDocs = membershipSnapshot.docs.filter((doc: any) => {
    const data = doc.data() as any;
    return typeof data.organisationId === 'string' && !data.clientId;
  });

  const summary = {
    bookingsScanned: bookingSnapshot.size,
    propertiesScanned: propertySnapshot.size,
    clientsScanned: clientSnapshot.size,
    clientUsersScanned: clientUserSnapshot.size,
    propertyAddressKeysBackfilled: 0,
    duplicatePropertyAddressKeys: 0,
    bookingPropertiesCreated: 0,
    clientsCreated: 0,
    linksCreated: 0,
    bookingsPatched: 0,
    bookingsWithoutClientContext: 0,
    clientRolesBackfilled: 0,
    clientMembershipsBackfilled: 0,
    legacyClientOrganisationsScanned: legacyOrganisations.size,
    legacyClientOrganisationsMigrated: 0,
    legacyClientMembershipsScanned: legacyMembershipDocs.length,
    legacyClientMembershipsMigrated: 0,
    legacyClientMembershipsRequiringReview: 0,
    legacyClientPropertiesScanned: legacyProperties.size,
    legacyClientDocumentsScanned: legacyDocuments.size,
    legacyRecordsMigrated: 0,
    dryRun: !process.argv.includes('--apply'),
  };

  const propertiesByAddress = new Map<string, string>();
  const duplicateAddressKeys = new Set<string>();

  for (const doc of propertySnapshot.docs) {
    const property = doc.data() as any;
    const key = propertyKey(property);
    if (!normalise(property.streetAddress) || !normalise(property.suburb) || !normalise(property.postcode)) {
      console.warn('Property has incomplete address and cannot receive an addressKey:', doc.id);
      continue;
    }

    const existingId = propertiesByAddress.get(key);
    if (existingId && existingId !== doc.id) {
      duplicateAddressKeys.add(key);
      console.warn('Duplicate canonical property address detected:', existingId, doc.id, key);
      continue;
    }
    propertiesByAddress.set(key, doc.id);

    if (property.addressKey !== key) {
      summary.propertyAddressKeysBackfilled += 1;
      if (apply) {
        await doc.ref.set({ addressKey: key, updatedAt: new Date().toISOString() }, { merge: true });
      }
    }
  }

  summary.duplicatePropertyAddressKeys = duplicateAddressKeys.size;
  if (apply && duplicateAddressKeys.size > 0) {
    throw new Error(
      'Duplicate canonical property addresses exist. Resolve them before applying the unified portal migration.'
    );
  }

  const clientsByName = new Map<string, string>();
  const duplicateClientNames = new Set<string>();
  for (const doc of clientSnapshot.docs) {
    const client = doc.data() as any;
    const key = clientNameKey(client.name);
    if (!key) continue;
    const existingId = clientsByName.get(key);
    if (existingId && existingId !== doc.id) {
      duplicateClientNames.add(key);
      clientsByName.delete(key);
      continue;
    }
    if (!duplicateClientNames.has(key)) clientsByName.set(key, doc.id);
  }

  const knownClientIds = new Set(clientSnapshot.docs.map((doc: any) => doc.id));
  const clientUsersByUid = new Map<string, { id: string; data: any }>();
  const clientUsersByEmail = new Map<string, { id: string; data: any }>();

  for (const doc of clientUserSnapshot.docs) {
    const data = doc.data() as any;
    if (typeof data.firebaseUid === 'string' && data.firebaseUid.trim()) {
      clientUsersByUid.set(data.firebaseUid.trim(), { id: doc.id, data });
    }
    const emailLower =
      typeof data.emailLower === 'string' && data.emailLower.trim()
        ? data.emailLower.trim().toLowerCase()
        : typeof data.email === 'string'
          ? data.email.trim().toLowerCase()
          : '';
    if (emailLower) clientUsersByEmail.set(emailLower, { id: doc.id, data });
  }

  const legacyClientType = (entityType: unknown) => {
    switch (normalise(entityType)) {
      case 'individual': return 'landlord';
      case 'agency': return 'agency';
      case 'company': return 'commercial_landlord';
      case 'strata': return 'strata_company';
      default: return 'other';
    }
  };

  // Convert the frozen Client Portal organisation model into canonical clients.
  for (const doc of legacyOrganisations.docs) {
    const old = doc.data() as any;
    const name = typeof old.name === 'string' ? old.name.trim() : '';
    if (!name) {
      console.warn('Skipping legacy client organisation without a name:', doc.id);
      continue;
    }

    const now = new Date().toISOString();
    const clientId = doc.id;
    const clientRef = adminDb.collection('clients').doc(clientId);
    const existingClient = await clientRef.get();

    summary.legacyClientOrganisationsMigrated += 1;
    knownClientIds.add(clientId);
    const nameKey = clientNameKey(name);
    if (nameKey && !duplicateClientNames.has(nameKey)) clientsByName.set(nameKey, clientId);

    if (apply) {
      const existing = existingClient.exists ? existingClient.data() as any : {};
      await clientRef.set({
        id: clientId,
        name,
        clientType: existing.clientType || legacyClientType(old.entityType),
        email: existing.email || old.billingEmail || undefined,
        billingEmail: old.billingEmail || existing.billingEmail || undefined,
        phone: old.phone || existing.phone || undefined,
        abn: old.abn || existing.abn || undefined,
        acn: old.acn || existing.acn || undefined,
        externalReference: existing.externalReference,
        status: existing.status || 'active',
        createdAt: existing.createdAt || old.createdAt || now,
        updatedAt: now,
        legacyEntityType: old.entityType || undefined,
        migrationSource: 'legacy-client-organisation',
      }, { merge: true });
    }
  }

  // Convert legacy membership documents that used organisationId/uid into the
  // canonical clientId/clientUserId relationship without inventing ownership.
  for (const doc of legacyMembershipDocs) {
    const old = doc.data() as any;
    const clientId = typeof old.organisationId === 'string' ? old.organisationId.trim() : '';
    const email = typeof old.email === 'string' ? old.email.trim().toLowerCase() : '';
    const uid = typeof old.uid === 'string' ? old.uid.trim() : '';
    const role = ['owner','admin','member','viewer'].includes(old.role) ? old.role : 'member';
    const status = ['active','invited','revoked'].includes(old.status) ? old.status : 'invited';

    if (!clientId || !knownClientIds.has(clientId) || (!uid && !email)) {
      summary.legacyClientMembershipsRequiringReview += 1;
      console.warn('Legacy client membership requires manual review:', doc.id);
      continue;
    }

    const existingUser =
      (uid ? clientUsersByUid.get(uid) : undefined) ||
      (email ? clientUsersByEmail.get(email) : undefined);
    const userId = existingUser?.id || stableId('client_user', uid || email);
    const current = existingUser?.data || {};
    const currentIds = Array.isArray(current.clientIds)
      ? (current.clientIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const currentRoles =
      current.clientRoles && typeof current.clientRoles === 'object'
        ? current.clientRoles as Record<string, string>
        : {};
    const nextClientIds = status === 'active' ? Array.from(new Set([...currentIds, clientId])) : currentIds.filter(id => id !== clientId);
    const nextRoles = { ...currentRoles };
    if (status === 'active') nextRoles[clientId] = role; else delete nextRoles[clientId];
    const now = new Date().toISOString();

    summary.legacyClientMembershipsMigrated += 1;

    if (apply) {
      const userRef = adminDb.collection('clientUsers').doc(userId);
      await userRef.set({
        ...current,
        id: userId,
        email: email || current.email || '',
        emailLower: email || current.emailLower || '',
        displayName: old.displayName || current.displayName || email || 'Client User',
        phone: current.phone,
        firebaseUid: uid || current.firebaseUid || undefined,
        active: nextClientIds.length > 0 && current.active !== false,
        clientIds: nextClientIds,
        clientRoles: nextRoles,
        createdAt: current.createdAt || old.createdAt || now,
        updatedAt: now,
        lastLoginAt: current.lastLoginAt,
        migrationSource: 'legacy-client-membership',
      });

      await doc.ref.set({
        id: doc.id,
        clientId,
        clientUserId: userId,
        email: email || current.email || '',
        role,
        status,
        invitedBy: old.invitedByUid || undefined,
        createdAt: old.createdAt || now,
        updatedAt: now,
        migrationSource: 'legacy-client-membership',
      });

      const mapped = { id: userId, data: (await userRef.get()).data() };
      if (uid) clientUsersByUid.set(uid, mapped);
      if (email) clientUsersByEmail.set(email, mapped);
    }
  }

  // Backfill explicit roles for client users created before clientRoles existed.
  for (const doc of clientUserSnapshot.docs) {
    const user = (await doc.ref.get()).data() as any;
    const clientIds: string[] = Array.isArray(user.clientIds)
      ? Array.from(
          new Set<string>(
            (user.clientIds as unknown[]).filter(
              (id: unknown): id is string =>
                typeof id === 'string' && Boolean(id.trim())
            )
          )
        )
      : [];
    if (clientIds.length === 0) continue;

    const existingRoles =
      user.clientRoles && typeof user.clientRoles === 'object'
        ? user.clientRoles as Record<string, string>
        : {};

    const nextRoles: Record<string, 'owner' | 'admin' | 'member' | 'viewer'> = {};
    let changed = false;

    clientIds.forEach((clientId, index) => {
      const existing = existingRoles[clientId];
      if (['owner', 'admin', 'member', 'viewer'].includes(existing)) {
        nextRoles[clientId] = existing as 'owner' | 'admin' | 'member' | 'viewer';
      } else {
        nextRoles[clientId] = 'viewer'; // Never infer ownership from array position.
        changed = true;
      }
    });

    for (const clientId of clientIds) {
      const membershipId = stableId('cm', `${doc.id}|${clientId}`);
      const membershipRef = adminDb.collection('clientMemberships').doc(membershipId);
      const membershipDoc = await membershipRef.get();
      const matchingMembership = (await adminDb.collection('clientMemberships').get()).docs.find((m: any) => { const d = m.data(); return d.clientId === clientId && d.clientUserId === doc.id; });
      if (!membershipDoc.exists && !matchingMembership) {
        summary.clientMembershipsBackfilled += 1;
        if (apply) {
          const now = new Date().toISOString();
          await membershipRef.set({
            id: membershipId,
            clientId,
            clientUserId: doc.id,
            email: typeof user.email === 'string' ? user.email.trim().toLowerCase() : '',
            role: nextRoles[clientId] || existingRoles[clientId] || 'member',
            status: user.active === false ? 'revoked' : 'active',
            createdAt: user.createdAt || now,
            updatedAt: now,
            migrationSource: 'unified-portal-stage2',
          });
        }
      }
    }

    if (changed) {
      summary.clientRolesBackfilled += 1;
      if (apply) {
        await doc.ref.set(
          { clientRoles: nextRoles, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    }
  }

  for (const bookingDoc of bookingSnapshot.docs) {
    const booking = bookingDoc.data() as any;
    const property = booking.property || {};
    const key = propertyKey(property);

    if (!normalise(property.streetAddress) || !normalise(property.suburb) || !normalise(property.postcode)) {
      console.warn('Skipping booking without a complete property address:', bookingDoc.id);
      continue;
    }

    const now = new Date().toISOString();
    const propertyId =
      (typeof booking.propertyId === 'string' && booking.propertyId.trim())
        ? booking.propertyId.trim()
        : propertiesByAddress.get(key) || stableId('prop', key);

    const clientName = typeof property.clientName === 'string' ? property.clientName.trim() : '';
    let clientId =
      typeof booking.clientId === 'string' && booking.clientId.trim()
        ? booking.clientId.trim()
        : undefined;

    if (!clientId && clientName) {
      const nameKey = clientNameKey(clientName);
      clientId = clientsByName.get(nameKey) || stableId('client', `name:${nameKey}`);
    }

    if (!clientId) {
      summary.bookingsWithoutClientContext += 1;
    }

    const propertyRef = adminDb.collection('properties').doc(propertyId);
    const propertyDoc = await propertyRef.get();

    if (!propertyDoc.exists) {
      summary.bookingPropertiesCreated += 1;
      if (apply) {
        await propertyRef.set({
          id: propertyId,
          addressKey: key,
          streetAddress: property.streetAddress,
          unit: property.unit || undefined,
          suburb: property.suburb,
          state: property.state || 'WA',
          postcode: property.postcode,
          propertyType: property.propertyType || undefined,
          primaryClientId: clientId,
          clientName: clientName || undefined,
          clientReference: property.clientReference || undefined,
          status: 'active',
          createdAt: booking.createdAt || now,
          updatedAt: now,
          migrationSource: 'booking-backfill',
        });
      }
      propertiesByAddress.set(key, propertyId);
    } else {
      const existing = propertyDoc.data() as any;
      const patch: Record<string, unknown> = {};
      if (existing.addressKey !== key) patch.addressKey = key;
      if (!existing.primaryClientId && clientId) patch.primaryClientId = clientId;
      if (!existing.clientName && clientName) patch.clientName = clientName;
      if (Object.keys(patch).length > 0 && apply) {
        patch.updatedAt = now;
        await propertyRef.set(patch, { merge: true });
      }
    }

    if (clientId) {
      const clientRef = adminDb.collection('clients').doc(clientId);
      const clientDoc = await clientRef.get();
      if (!clientDoc.exists) {
        summary.clientsCreated += 1;
        if (apply) {
          await clientRef.set({
            id: clientId,
            name: clientName || 'Imported Client',
            clientType: 'landlord',
            status: 'active',
            createdAt: booking.createdAt || now,
            updatedAt: now,
            migrationSource: 'booking-backfill',
          });
        }
        if (clientName) clientsByName.set(clientNameKey(clientName), clientId);
      }

      const linkId = stableId('cpl', `${clientId}|${propertyId}`);
      const linkRef = adminDb.collection('clientPropertyLinks').doc(linkId);
      const existingLink = await linkRef.get();
      if (!existingLink.exists) {
        summary.linksCreated += 1;
        if (apply) {
          await linkRef.set({
            id: linkId,
            clientId,
            propertyId,
            role: 'owner',
            primary: true,
            active: true,
            createdAt: now,
            updatedAt: now,
            migrationSource: 'booking-backfill',
          });
        }
      }
    }

    const bookingPatch: Record<string, unknown> = {};
    if (booking.propertyId !== propertyId) bookingPatch.propertyId = propertyId;
    if (clientId && booking.clientId !== clientId) bookingPatch.clientId = clientId;

    if (Object.keys(bookingPatch).length > 0) {
      summary.bookingsPatched += 1;
      if (apply) {
        bookingPatch.updatedAt = now;
        await bookingDoc.ref.set(bookingPatch, { merge: true });
      }
    }
  }

  // Compatibility with the earlier client-portal branch where these collections exist.
  for (const doc of legacyProperties.docs) {
    const old = doc.data() as any;
    const key = propertyKey(old);
    if (!normalise(old.streetAddress) || !normalise(old.suburb) || !normalise(old.postcode)) {
      console.warn('Skipping legacy property without complete address:', doc.id);
      continue;
    }

    const organisationId = typeof old.organisationId === 'string' ? old.organisationId.trim() : '';
    const oldClientId = typeof old.clientId === 'string' ? old.clientId.trim() : '';
    const clientName = typeof old.clientName === 'string'
      ? old.clientName.trim()
      : typeof old.organisationName === 'string'
        ? old.organisationName.trim()
        : '';

    let clientId = organisationId || oldClientId || undefined;
    if (!clientId && clientName) {
      clientId = clientsByName.get(clientNameKey(clientName)) ||
        stableId('client', `name:${clientNameKey(clientName)}`);
    }

    const propertyId = propertiesByAddress.get(key) || old.id || doc.id;
    legacyPropertyIds.set(doc.id, propertyId);
    const propertyRef = adminDb.collection('properties').doc(propertyId);
    const clientRef = clientId ? adminDb.collection('clients').doc(clientId) : null;
    const now = new Date().toISOString();

    if (apply) {
      const propertyDoc = await propertyRef.get();
      if (!propertyDoc.exists) {
        await propertyRef.set({
          id: propertyId,
          addressKey: key,
          streetAddress: old.streetAddress,
          unit: old.unit || undefined,
          suburb: old.suburb,
          state: old.state || 'WA',
          postcode: old.postcode,
          propertyType: old.propertyType || undefined,
          primaryClientId: clientId,
          clientName: clientName || undefined,
          clientReference: old.clientReference || undefined,
          status: old.status === 'inactive' ? 'inactive' : 'active',
          createdAt: old.createdAt || now,
          updatedAt: now,
          migrationSource: 'legacy-client-portal',
        });
      }

      if (clientRef) {
        const clientDoc = await clientRef.get();
        if (!clientDoc.exists) {
          await clientRef.set({
            id: clientId,
            name: clientName || 'Imported Client',
            clientType: 'landlord',
            status: 'active',
            createdAt: old.createdAt || now,
            updatedAt: now,
            migrationSource: 'legacy-client-portal',
          });
        }

        const linkId = stableId('cpl', `${clientId}|${propertyId}`);
        const linkRef = adminDb.collection('clientPropertyLinks').doc(linkId);
        const linkDoc = await linkRef.get();
        if (!linkDoc.exists) {
          await linkRef.set({
            id: linkId,
            clientId,
            propertyId,
            role: 'owner',
            primary: true,
            active: true,
            createdAt: now,
            updatedAt: now,
            migrationSource: 'legacy-client-portal',
          });
        }
      }
    }

    propertiesByAddress.set(key, propertyId);
    summary.legacyRecordsMigrated += 1;
  }

  for (const doc of legacyDocuments.docs) {
    const old = doc.data() as any;
    const rawPropertyId = typeof old.propertyId === 'string' ? old.propertyId.trim() : '';
    if (!rawPropertyId) continue;

    const target = adminDb.collection('propertyDocuments').doc(doc.id);
    if (apply) {
      const existing = await target.get();
      if (!existing.exists) {
        const clientId =
          typeof old.clientId === 'string' && old.clientId.trim()
            ? old.clientId.trim()
            : typeof old.organisationId === 'string' && old.organisationId.trim()
              ? old.organisationId.trim()
              : undefined;

        await target.set({
          id: doc.id,
          propertyId: legacyPropertyIds.get(rawPropertyId) || rawPropertyId,
          clientIds: clientId ? [clientId] : [],
          audiences: ['client'],
          title: old.name || old.title || old.documentType || 'Imported Document',
          category: 'other',
          fileName: old.name || old.fileName || 'document',
          contentType: old.contentType || 'application/octet-stream',
          size: Number(old.sizeBytes || old.size || 0),
          storagePath: old.storagePath,
          uploadedAt: old.createdAt || new Date().toISOString(),
          uploadedBy: old.clientUid || old.createdByUid || 'legacy-client-portal',
          migrationSource: 'legacy-client-portal',
        });
      }
    }
    summary.legacyRecordsMigrated += 1;
  }

  console.log(JSON.stringify(summary, null, 2));

  if (!process.argv.includes('--apply')) {
    console.log('Dry run only. Review duplicate counts and relationship counts before using --apply.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMigration(transform).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
