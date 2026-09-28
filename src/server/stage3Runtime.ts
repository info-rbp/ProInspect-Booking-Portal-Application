const PRODUCTION_PROJECT = 'business-plan-applicatio-17047';
/** Legacy production behaviour is unchanged unless an explicit environment is supplied. */
export function emailDeliveryEnabled(): boolean {
  return process.env.PLATFORM_ENVIRONMENT !== 'staging' && process.env.EMAIL_DELIVERY_MODE !== 'disabled';
}
export function assertRuntimeIsolation(): void {
  if (process.env.PLATFORM_ENVIRONMENT !== 'staging') return;
  const project = process.env.FIREBASE_PROJECT_ID;
  if (!project || project === PRODUCTION_PROJECT || !process.env.FIRESTORE_DATABASE_ID || !process.env.FIREBASE_STORAGE_BUCKET) {
    throw new Error('Staging requires explicit isolated Firebase project, database and storage configuration.');
  }
  if (process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Cloud staging must use keyless service identity, not embedded service-account credentials.');
  if (process.env.EMAIL_DELIVERY_MODE !== 'disabled') throw new Error('Staging outbound email must be disabled.');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Cloud staging must not use emulator endpoints.');
}

export function assertCalendarAllowed(calendarId: string): void {
  if (process.env.PLATFORM_ENVIRONMENT !== 'staging') return;
  const allowed = (process.env.STAGING_CALENDAR_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(calendarId)) throw new Error('Calendar is not explicitly allowlisted for staging.');
}
