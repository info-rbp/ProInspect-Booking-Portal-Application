import 'dotenv/config';
import { createHash } from 'crypto';
import { adminDb } from '../src/server/firebaseAdmin.js';

const apply = process.argv.includes('--apply');

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function propertyKey(property: any): string {
  return [
    normalise(property.unit).toLowerCase(),
    normalise(property.streetAddress).toLowerCase(),
    normalise(property.suburb).toLowerCase(),
    normalise(property.state).toUpperCase(),
    normalise(property.postcode),
  ].join('|');
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0,24)}`;
}

async function main() {
  const bookingSnapshot = await adminDb.collection('bookings').get();
  const summary = {
    bookingsScanned: bookingSnapshot.size,
    propertiesCreated: 0,
    clientsCreated: 0,
    linksCreated: 0,
    bookingsPatched: 0,
    legacyClientPropertiesScanned: 0,
    legacyClientDocumentsScanned: 0,
    legacyClientRequestsScanned: 0,
    legacyClientApprovalsScanned: 0,
    legacyRecordsMigrated: 0,
    dryRun: !apply,
  };

  for (const bookingDoc of bookingSnapshot.docs) {
    const booking = bookingDoc.data() as any;
    const property = booking.property || {};
    const key = propertyKey(property);
    if (!normalise(property.streetAddress) || !normalise(property.suburb) || !normalise(property.postcode)) {
      console.warn('Skipping booking without a complete property address:', bookingDoc.id);
      continue;
    }

    const propertyId = booking.propertyId || stableId('prop', key);
    const clientName = normalise(property.clientName);
    const clientEmail = normalise(property.customerEmail).toLowerCase();
    const clientKey = clientEmail || clientName.toLowerCase() || `booking:${bookingDoc.id}`;
    const clientId = stableId('client', clientKey);

    const propertyRef = adminDb.collection('properties').doc(propertyId);
    const clientRef = adminDb.collection('clients').doc(clientId);
    const linkId = stableId('cpl', `${clientId}|${propertyId}`);
    const linkRef = adminDb.collection('clientPropertyLinks').doc(linkId);

    const [existingProperty, existingClient, existingLink] = await Promise.all([
      propertyRef.get(),
      clientRef.get(),
      linkRef.get(),
    ]);

    const now = new Date().toISOString();

    if (!existingClient.exists) {
      summary.clientsCreated += 1;
      if (apply) {
        await clientRef.set({
          id: clientId,
          name: clientName || property.customerName || clientEmail || 'Imported Client',
          clientType: 'landlord',
          email: clientEmail || undefined,
          status: 'active',
          createdAt: booking.createdAt || now,
          updatedAt: now,
          migrationSource: 'booking-backfill',
        }, { merge: true });
      }
    }

    if (!existingProperty.exists) {
      summary.propertiesCreated += 1;
      if (apply) {
        await propertyRef.set({
          id: propertyId,
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
        }, { merge: true });
      }
    }

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

    if (booking.propertyId !== propertyId || booking.clientId !== clientId) {
      summary.bookingsPatched += 1;
      if (apply) {
        await bookingDoc.ref.set({
          propertyId,
          clientId,
          updatedAt: now,
        }, { merge: true });
      }
    }
  }

  // Legacy Client Portal compatibility. These collections may not exist in every
  // environment; empty snapshots are valid and require no action.
  const [
    legacyProperties,
    legacyDocuments,
    legacyRequests,
    legacyApprovals,
  ] = await Promise.all([
    adminDb.collection('clientProperties').get(),
    adminDb.collection('clientDocuments').get(),
    adminDb.collection('clientRequestsLegacy').get().catch(() => adminDb.collection('clientRequests__legacy_missing').get()),
    adminDb.collection('clientApprovalsLegacy').get().catch(() => adminDb.collection('clientApprovals__legacy_missing').get()),
  ]);

  summary.legacyClientPropertiesScanned = legacyProperties.size;
  summary.legacyClientDocumentsScanned = legacyDocuments.size;
  summary.legacyClientRequestsScanned = legacyRequests.size;
  summary.legacyClientApprovalsScanned = legacyApprovals.size;

  for (const doc of legacyProperties.docs) {
    const old = doc.data() as any;
    const organisationId = normalise(old.organisationId || old.clientUid || old.clientId);
    const clientId = organisationId
      ? stableId('client', organisationId)
      : stableId('client', normalise(old.clientEmail || old.createdByUid || doc.id));

    const propertyId = old.id || doc.id;
    const propertyRef = adminDb.collection('properties').doc(propertyId);
    const clientRef = adminDb.collection('clients').doc(clientId);
    const linkRef = adminDb.collection('clientPropertyLinks').doc(
      stableId('cpl', `${clientId}|${propertyId}`)
    );
    const now = new Date().toISOString();

    if (apply) {
      const [clientDoc, propertyDoc, linkDoc] = await Promise.all([
        clientRef.get(), propertyRef.get(), linkRef.get()
      ]);

      if (!clientDoc.exists) {
        await clientRef.set({
          id: clientId,
          name: normalise(old.clientName || old.organisationName) || 'Imported Client',
          clientType: 'landlord',
          status: 'active',
          createdAt: old.createdAt || now,
          updatedAt: now,
          migrationSource: 'legacy-client-portal',
        }, { merge: true });
      }

      if (!propertyDoc.exists) {
        await propertyRef.set({
          id: propertyId,
          streetAddress: old.streetAddress,
          unit: old.unit || undefined,
          suburb: old.suburb,
          state: old.state || 'WA',
          postcode: old.postcode,
          propertyType: old.propertyType || undefined,
          primaryClientId: clientId,
          clientName: old.clientName || undefined,
          clientReference: old.clientReference || undefined,
          status: old.status === 'inactive' ? 'inactive' : 'active',
          createdAt: old.createdAt || now,
          updatedAt: now,
          migrationSource: 'legacy-client-portal',
        }, { merge: true });
      }

      if (!linkDoc.exists) {
        await linkRef.set({
          id: linkRef.id,
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
    summary.legacyRecordsMigrated += 1;
  }

  for (const doc of legacyDocuments.docs) {
    const old = doc.data() as any;
    const propertyId = normalise(old.propertyId);
    if (!propertyId) continue;
    const target = adminDb.collection('propertyDocuments').doc(doc.id);
    const clientId = normalise(old.organisationId || old.clientId);
    if (apply) {
      const existing = await target.get();
      if (!existing.exists) {
        await target.set({
          id: doc.id,
          propertyId,
          clientIds: clientId ? [stableId('client', clientId)] : [],
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
    console.log('Dry run only. Re-run with --apply after reviewing counts.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
