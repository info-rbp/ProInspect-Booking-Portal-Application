/** Explicit table allowlist. Unknown legacy collections fail closed. */
export const COLLECTIONS = [
  '_releaseControl','adminUsers','auditEvents','bookingAccessSecrets','bookings',
  'clientApprovals','clientMemberships','clientPropertyLinks','clientRequests','clientUsers',
  'clients','contractors','documentProducts','documentRequestSecrets','documentRequests',
  'formDefinitions','payments','portalNotifications','properties','propertyDocuments',
  'scheduleLocks','sensitiveAuditEvents','sensitiveTenantForms','services','settings',
  'systemMetadata','tenancies','tenantFormRequests','tenantInspections','tenantRequests',
  'tenantUsers','workOrders','nativeCalendarEvents','communications','subscriptions'
] as const;
export const APPEND_ONLY = new Set(['auditEvents','sensitiveAuditEvents']);
export type CollectionName = typeof COLLECTIONS[number];
export function collectionName(value: string): CollectionName {
  if (!(COLLECTIONS as readonly string[]).includes(value)) throw new Error('UNKNOWN_COLLECTION');
  return value as CollectionName;
}
