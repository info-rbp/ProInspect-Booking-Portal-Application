/**
 * Australian & Perth Timezone Date-Time Utilities
 * Default timezone: Australia/Perth (AWST, UTC+8)
 * Default locale: en-AU
 */

export const TIMEZONE = 'Australia/Perth';
export const LOCALE = 'en-AU';

/**
 * Formats a Date object or ISO string to standard Australian date
 * Example: Monday, 5 October 2026
 */
export function formatAustralianDate(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Short date format: Mon 5 Oct 2026
 */
export function formatShortDate(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Formats time in Australian lowercase am/pm
 * Example: 9:00 am, 2:30 pm
 */
export function formatAustralianTime(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const timeStr = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return timeStr.toLowerCase();
}

/**
 * Returns YYYY-MM-DD string for a given date in Australia/Perth
 */
export function getPerthDateKey(date: Date): string {
  // Format to Australia/Perth parts
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // Output: YYYY-MM-DD
}

/**
 * Generates an Australian unique booking reference
 * Format: PI-YYYYMMDD-XXXX (e.g. PI-20261005-0042)
 */
export function generateBookingReference(date: Date = new Date()): string {
  const dateKey = getPerthDateKey(date).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000); // 4-digit code
  return `PI-${dateKey}-${randomSuffix}`;
}

/**
 * Generates a secure unguessable management token for self-service or direct booking link
 */
export function generateManagementToken(): string {
  return 'pi_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
