import 'dotenv/config';
import { createHash } from 'crypto';
import { adminDb } from '../src/server/firebaseAdmin.js';

const apply = process.argv.includes('--apply');

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
    normalise(property.state).toUpperCase(),
    normalise(property.postcode),
  ].join('|');
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function clientNameKey(value: unknown) {
  return normalise(value);
}

async function main() {
  const [
    bookingSnapshot,
    propertySnapshot,
    clientSnapshot,
    clientUserSnapshot,
    legacyProperties,
    legacyDocuments,
  ] = await Promise.all([
    adminDb.collection('bookings').get(),
    adminDb.collection('properties').get(),
    adminDb.collection('clients').get(),
    adminDb.collection('clientUsers').get(),
    adminDb.collection('clientProperties').get(),
    adminDb.collection('clientDocuments').get(),
  ]);

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
    legacyClientPropertiesScanned: legacyProperties.size,
    legacyClientDocumentsScanned: legacyDocuments.size,
    legacyRecordsMigrated: 0,
    dryRun: !apply,
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

  // Backfill explicit roles for client users created before clientRoles existed.
  for (const doc of clientUserSnapshot.docs) {
    const user = doc.data() as any;
    const clientIds = Array.isArray(user.clientIds)
      ? Array.from(new Set(user.clientIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim())))
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
        nextRoles[clientId] = index === 0 ? 'owner' : 'member';
        changed = true;
      }
    });

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
          propertyId: rawPropertyId,
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

  if (!apply) {
    console.log('Dry run only. Review duplicate counts and relationship counts before using --apply.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
