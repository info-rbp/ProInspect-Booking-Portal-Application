import 'dotenv/config';
import { createHash } from 'crypto';
import { adminDb } from '../src/server/firebaseAdmin.js';

const apply = process.argv.includes('--apply');

function value(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stablePropertyId(property: Record<string, unknown>): string {
  const key = [
    value(property.unit),
    value(property.streetAddress),
    value(property.suburb),
    value(property.state || 'WA'),
    value(property.postcode),
  ]
    .map((part) => part.toLowerCase().replace(/\s+/g, ' '))
    .join('|');

  return `property_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

function stableId(prefix: string, input: string): string {
  return `${prefix}_${createHash('sha256').update(input).digest('hex').slice(0, 32)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function exists(collection: string, id?: string): Promise<boolean> {
  if (!id) return false;
  return (await adminDb.collection(collection).doc(id).get()).exists;
}

async function main() {
  const summary = {
    dryRun: !apply,
    bookingsScanned: 0,
    bookingPropertiesBackfilled: 0,
    bookingWorkOrdersBackfilled: 0,
    legacyDocumentRequestsScanned: 0,
    documentRequestsNormalised: 0,
    legacyMaintenanceRequestsScanned: 0,
    maintenanceWorkOrdersCreated: 0,
    legacyAuditEventsScanned: 0,
    auditEventsNormalised: 0,
    legacyClientsScanned: 0,
    clientsNormalised: 0,
    legacyPropertiesScanned: 0,
    propertiesNormalised: 0,
    legacyDocumentsScanned: 0,
    documentsNormalised: 0,
    legacySubscriptionsScanned: 0,
    subscriptionsNormalised: 0,
    legacyCommunicationsScanned: 0,
    communicationsNormalised: 0,
    legacyTenantRecordsRequiringReview: 0,
    skippedMissingReferences: 0,
  };

  const bookings = await adminDb.collection('bookings').get();
  summary.bookingsScanned = bookings.size;

  for (const bookingDoc of bookings.docs) {
    const booking = bookingDoc.data() as Record<string, any>;
    const embeddedProperty = (booking.property || {}) as Record<string, unknown>;

    if (
      !value(embeddedProperty.streetAddress) ||
      !value(embeddedProperty.suburb) ||
      !value(embeddedProperty.postcode)
    ) {
      summary.skippedMissingReferences += 1;
      continue;
    }

    const propertyId = value(booking.propertyId) || stablePropertyId(embeddedProperty);
    const propertyRef = adminDb.collection('properties').doc(propertyId);
    const propertyDoc = await propertyRef.get();
    const now = nowIso();

    if (!propertyDoc.exists) {
      summary.bookingPropertiesBackfilled += 1;
      if (apply) {
        await propertyRef.set({
          id: propertyId,
          streetAddress: value(embeddedProperty.streetAddress),
          unit: value(embeddedProperty.unit) || undefined,
          suburb: value(embeddedProperty.suburb),
          state: value(embeddedProperty.state || 'WA').toUpperCase(),
          postcode: value(embeddedProperty.postcode),
          propertyType: value(embeddedProperty.propertyType) || undefined,
          addressKey: propertyId.replace(/^property_/, ''),
          placeId: value(embeddedProperty.addressVerification?.placeId) || undefined,
          latitude:
            typeof embeddedProperty.addressVerification?.latitude === 'number'
              ? embeddedProperty.addressVerification.latitude
              : undefined,
          longitude:
            typeof embeddedProperty.addressVerification?.longitude === 'number'
              ? embeddedProperty.addressVerification.longitude
              : undefined,
          status: 'active',
          createdAt: value(booking.createdAt) || now,
          updatedAt: now,
          migrationSource: 'admin-platform-p0',
        });
      }
    }

    if (booking.propertyId !== propertyId) {
      if (apply) {
        await bookingDoc.ref.set({ propertyId, updatedAt: now }, { merge: true });
      }
    }

    const workOrderId = `booking_${bookingDoc.id}`;
    const workOrderRef = adminDb.collection('workOrders').doc(workOrderId);
    if (!(await workOrderRef.get()).exists) {
      summary.bookingWorkOrdersBackfilled += 1;
      if (apply) {
        await workOrderRef.set({
          id: workOrderId,
          reference: `WO-${value(booking.bookingReference).replace(/^PI-/, '') || bookingDoc.id}`,
          sourceType: 'booking',
          sourceId: bookingDoc.id,
          propertyId,
          clientId: value(booking.clientId) || undefined,
          assignedStaffId: value(booking.assignedStaffId) || undefined,
          title: value(booking.serviceName) || 'Booking',
          description: `Booking ${value(booking.bookingReference) || bookingDoc.id}.`,
          priority: 'routine',
          status:
            booking.status === 'completed'
              ? 'completed'
              : booking.status === 'cancelled'
                ? 'cancelled'
                : 'scheduled',
          scheduledStart: value(booking.appointment?.start) || undefined,
          scheduledEnd: value(booking.appointment?.end) || undefined,
          accessNotes: value(booking.access?.specialInstructions) || undefined,
          completionDocumentIds: [],
          createdBy: 'migration',
          completedAt: booking.status === 'completed' ? value(booking.updatedAt) || now : undefined,
          createdAt: value(booking.createdAt) || now,
          updatedAt: now,
          migrationSource: 'admin-platform-p0',
        });
      }
    }
  }

  const requests = await adminDb.collection('documentRequests').get();
  summary.legacyDocumentRequestsScanned = requests.size;
  for (const doc of requests.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.reference && data.requesterEmail && data.address) continue;

    const details = (data.details || {}) as Record<string, unknown>;
    const address = {
      streetAddress: value(details.streetAddress),
      unit: value(details.unit) || undefined,
      suburb: value(details.suburb),
      state: value(details.state || 'WA').toUpperCase(),
      postcode: value(details.postcode),
    };
    if (!address.streetAddress || !address.suburb || !address.postcode) {
      summary.skippedMissingReferences += 1;
      continue;
    }

    const propertyId = value(data.propertyId) || stablePropertyId(address);
    if (!(await adminDb.collection('properties').doc(propertyId).get()).exists && apply) {
      const now = nowIso();
      await adminDb.collection('properties').doc(propertyId).set({
        id: propertyId,
        ...address,
        addressKey: propertyId.replace(/^property_/, ''),
        status: 'active',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0-document-request',
      });
    }

    summary.documentRequestsNormalised += 1;
    if (apply) {
      const now = nowIso();
      await doc.ref.set({
        id: doc.id,
        reference: value(data.requestReference) || `DR-LEGACY-${doc.id.slice(0, 10)}`,
        documentProductId: value(data.documentId),
        documentName: value(data.documentName) || 'Document request',
        documentCategory:
          ['residential', 'commercial', 'strata-building'].includes(value(data.documentCategory))
            ? value(data.documentCategory)
            : 'residential',
        pricingMode: 'fixed',
        priceExGst: Number.isFinite(Number(data.priceExGst)) ? Number(data.priceExGst) : 0,
        propertyId,
        requesterName: value(details.customerName) || 'Legacy requester',
        requesterEmail: value(details.customerEmail).toLowerCase(),
        requesterPhone: value(details.customerPhone),
        address,
        notes: value(details.notes) || undefined,
        status:
          data.status === 'completed' || data.status === 'cancelled'
            ? data.status
            : data.status === 'in_review'
              ? 'under_review'
              : 'submitted',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const maintenance = await adminDb.collection('maintenanceRequests').get();
  summary.legacyMaintenanceRequestsScanned = maintenance.size;
  for (const doc of maintenance.docs) {
    const data = doc.data() as Record<string, any>;
    const propertyId = value(data.propertyId);
    if (!propertyId || !(await exists('properties', propertyId))) {
      summary.skippedMissingReferences += 1;
      continue;
    }
    const workOrderId = stableId('legacy_maintenance', doc.id);
    if (await exists('workOrders', workOrderId)) continue;

    summary.maintenanceWorkOrdersCreated += 1;
    if (apply) {
      const now = nowIso();
      await adminDb.collection('workOrders').doc(workOrderId).set({
        id: workOrderId,
        reference: value(data.reference) || `WO-LEGACY-${doc.id.slice(0, 10)}`,
        sourceType: 'manual',
        sourceId: doc.id,
        propertyId,
        clientId: value(data.clientId) || undefined,
        assignedStaffId: value(data.assignedStaffId) || undefined,
        title: value(data.title) || 'Migrated maintenance request',
        description: value(data.description || data.notes) || 'Migrated maintenance request.',
        priority:
          ['routine', 'priority', 'urgent', 'emergency'].includes(value(data.priority))
            ? value(data.priority)
            : value(data.priority) === 'high'
              ? 'priority'
              : 'routine',
        status:
          data.status === 'completed'
            ? 'completed'
            : data.status === 'cancelled'
              ? 'cancelled'
              : data.status === 'in_progress'
                ? 'in_progress'
                : data.status === 'scheduled'
                  ? 'scheduled'
                  : 'triage',
        contractorId: value(data.contractorId) || undefined,
        quoteAmountExGst:
          Number.isFinite(Number(data.estimatedCost)) && Number(data.estimatedCost) >= 0
            ? Number(data.estimatedCost)
            : undefined,
        accessNotes: value(data.accessNotes) || undefined,
        completionNotes: value(data.completionNotes) || undefined,
        completionDocumentIds: [],
        createdBy: 'migration',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'legacy-maintenanceRequests',
      });
    }
  }

  const clients = await adminDb.collection('clients').get();
  summary.legacyClientsScanned = clients.size;
  for (const doc of clients.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.clientType && data.createdAt && data.updatedAt) continue;
    summary.clientsNormalised += 1;
    if (apply) {
      const now = nowIso();
      await doc.ref.set({
        id: doc.id,
        name: value(data.name) || value(data.primaryContactName) || 'Legacy client',
        clientType: value(data.clientType) || 'landlord',
        email: value(data.email).toLowerCase() || undefined,
        phone: value(data.phone) || undefined,
        externalReference: value(data.externalReference) || undefined,
        status: data.active === false || data.status === 'inactive' ? 'inactive' : 'active',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const properties = await adminDb.collection('properties').get();
  summary.legacyPropertiesScanned = properties.size;
  for (const doc of properties.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.state && data.createdAt && data.updatedAt) continue;
    if (!value(data.streetAddress) || !value(data.suburb) || !value(data.postcode)) {
      summary.skippedMissingReferences += 1;
      continue;
    }
    summary.propertiesNormalised += 1;
    if (apply) {
      const now = nowIso();
      await doc.ref.set({
        id: doc.id,
        state: value(data.state || 'WA').toUpperCase(),
        status: data.active === false || data.status === 'inactive' ? 'inactive' : 'active',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const propertyDocuments = await adminDb.collection('propertyDocuments').get();
  summary.legacyDocumentsScanned = propertyDocuments.size;
  for (const doc of propertyDocuments.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.version && data.audiences && data.fileName && data.updatedAt) continue;
    const propertyId = value(data.propertyId);
    if (!propertyId || !(await exists('properties', propertyId))) {
      summary.skippedMissingReferences += 1;
      continue;
    }
    summary.documentsNormalised += 1;
    if (apply) {
      const now = nowIso();
      const title = value(data.title) || 'Legacy document';
      await doc.ref.set({
        id: doc.id,
        propertyId,
        clientIds: Array.isArray(data.clientIds)
          ? data.clientIds
          : value(data.clientId) ? [value(data.clientId)] : [],
        audiences: Array.isArray(data.audiences) ? data.audiences : ['staff'],
        title,
        category: value(data.category || data.documentType) || 'other',
        fileName: value(data.fileName) || `${title}.pdf`,
        storagePath: value(data.storagePath || data.storageUrl) || undefined,
        contentType: value(data.contentType) || 'application/pdf',
        size: Number.isFinite(Number(data.size)) ? Number(data.size) : 0,
        version: Number.isFinite(Number(data.version)) && Number(data.version) > 0 ? Number(data.version) : 1,
        status:
          ['draft', 'generated', 'review', 'approved', 'issued', 'archived'].includes(value(data.status))
            ? value(data.status)
            : 'draft',
        uploadedAt: value(data.uploadedAt || data.createdAt) || now,
        uploadedBy: value(data.uploadedBy) || 'migration',
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const subscriptions = await adminDb.collection('subscriptions').get();
  summary.legacySubscriptionsScanned = subscriptions.size;
  for (const doc of subscriptions.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.planCode && data.startDate && Array.isArray(data.allowances)) continue;
    const clientId = value(data.clientId);
    if (!clientId || !(await exists('clients', clientId))) {
      summary.skippedMissingReferences += 1;
      continue;
    }
    summary.subscriptionsNormalised += 1;
    if (apply) {
      const now = nowIso();
      await doc.ref.set({
        id: doc.id,
        clientId,
        propertyId: value(data.propertyId) || undefined,
        planCode: value(data.planCode) || 'legacy',
        name: value(data.name) || 'Legacy subscription',
        monthlyFeeExGst:
          Number.isFinite(Number(data.monthlyFeeExGst)) ? Number(data.monthlyFeeExGst) : 0,
        status:
          ['active', 'paused', 'ended', 'cancelled'].includes(value(data.status))
            ? value(data.status)
            : 'active',
        startDate: value(data.startDate) || now.slice(0, 10),
        endDate: value(data.endDate) || undefined,
        allowances: Array.isArray(data.allowances) ? data.allowances : [],
        xeroContactId: value(data.xeroContactId) || undefined,
        invoiceReference: value(data.invoiceReference) || undefined,
        notes: value(data.notes) || undefined,
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const communications = await adminDb.collection('communications').get();
  summary.legacyCommunicationsScanned = communications.size;
  for (const doc of communications.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.direction && data.createdBy && data.updatedAt) continue;
    summary.communicationsNormalised += 1;
    if (apply) {
      const now = nowIso();
      await doc.ref.set({
        id: doc.id,
        title: value(data.title) || 'Legacy communication',
        recipient: value(data.recipient) || 'internal',
        channel:
          ['email', 'phone', 'sms', 'portal', 'internal'].includes(value(data.channel))
            ? value(data.channel)
            : 'internal',
        direction: 'internal',
        status:
          ['draft', 'queued', 'sent', 'failed', 'received', 'logged'].includes(value(data.status))
            ? value(data.status)
            : 'logged',
        body: value(data.body) || value(data.notes) || 'Legacy communication record.',
        createdBy: value(data.createdBy) || 'migration',
        createdAt: value(data.createdAt) || now,
        updatedAt: now,
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const audit = await adminDb.collection('auditEvents').get();
  summary.legacyAuditEventsScanned = audit.size;
  for (const doc of audit.docs) {
    const data = doc.data() as Record<string, any>;
    if (data.actor && data.entityType && data.entityId) continue;
    summary.auditEventsNormalised += 1;
    if (apply) {
      await doc.ref.set({
        id: doc.id,
        entityType: value(data.resourceType) || 'staff',
        entityId: value(data.resourceId) || doc.id,
        action: value(data.action) || 'updated',
        summary: value(data.summary) || 'Legacy administrative event',
        actor: {
          type: 'staff',
          id: value(data.actorUid) || undefined,
          email: value(data.actorEmail) || undefined,
        },
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : undefined,
        createdAt: value(data.createdAt) || nowIso(),
        migrationSource: 'admin-platform-p0',
      }, { merge: true });
    }
  }

  const legacyTenants = await adminDb.collection('tenants').get();
  summary.legacyTenantRecordsRequiringReview = legacyTenants.size;

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log(
      'Dry run only. No Firestore writes were performed. Review the counts, then rerun with --apply if appropriate.'
    );
  }
  if (legacyTenants.size > 0) {
    console.log(
      'Legacy /tenants records were not auto-migrated because a tenant identity requires an explicit tenancy/property relationship. Review them and create canonical /tenancies + /tenantUsers records through the Admin Portal.'
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
