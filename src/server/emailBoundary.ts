/** Staging notifications never go to customer addresses from rehearsal data. */
export function outboundRecipients(recipients: string[]): string[] {
  if (process.env.PLATFORM_ENVIRONMENT !== 'staging') return recipients;
  const sink = process.env.STAGING_EMAIL_RECIPIENT?.trim();
  if (!sink || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(sink)) {
    throw new Error('Staging email delivery requires one explicit STAGING_EMAIL_RECIPIENT.');
  }
  return [sink];
}
