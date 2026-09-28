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

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log('Dry run only. Re-run with --apply after reviewing counts.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
