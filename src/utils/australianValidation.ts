/**
 * Australian Data Validation Utilities
 */

/**
 * Validates 4-digit Australian postcodes (0800 - 7999).
 * WA postcodes typically fall in 6000 - 6999 range.
 */
export function isValidAustralianPostcode(postcode: string): boolean {
  const trimmed = postcode.trim();
  if (!/^\d{4}$/.test(trimmed)) return false;
  const num = parseInt(trimmed, 10);
  return num >= 800 && num <= 7999;
}

/**
 * Checks if postcode is within Western Australia (6000-6999)
 */
export function isWAPostcode(postcode: string): boolean {
  const trimmed = postcode.trim();
  if (!/^\d{4}$/.test(trimmed)) return false;
  const num = parseInt(trimmed, 10);
  return num >= 6000 && num <= 6999;
}

/**
 * Validates Australian phone/mobile numbers
 * Accepts: 0400 000 000, 0400000000, (08) 9000 0000, +61 4...
 */
export function isValidAustralianPhone(phone: string): boolean {
  const digitsOnly = phone.replace(/[\s\-\(\)\+]/g, '');
  // Mobile or landline: usually 10 digits starting with 0, or 11 digits starting with 61
  if (/^04\d{8}$/.test(digitsOnly)) return true; // Mobile
  if (/^0[2378]\d{8}$/.test(digitsOnly)) return true; // Landline
  if (/^614\d{8}$/.test(digitsOnly)) return true; // Int mobile
  if (/^61[2378]\d{8}$/.test(digitsOnly)) return true; // Int landline
  // Fallback: at least 8 to 12 digits
  return digitsOnly.length >= 8 && digitsOnly.length <= 12;
}

/**
 * Validates standard email address format
 */
export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

/**
 * Common WA suburbs for instant helper/autocomplete guidance
 */
export const POPULAR_WA_SUBURBS = [
  'Cloverdale',
  'Perth',
  'Victoria Park',
  'Belmont',
  'Burswood',
  'South Perth',
  'Subiaco',
  'Scarborough',
  'Fremantle',
  'Cottesloe',
  'Joondalup',
  'Midland',
  'Armadale',
  'Rockingham',
  'Mandurah',
  'Applecross',
  'Mount Lawley',
  'Como',
  'Morley',
  'Canning Vale',
];

export const AUSTRALIAN_STATES = [
  { code: 'WA', name: 'Western Australia' },
  { code: 'NSW', name: 'New South Wales' },
  { code: 'VIC', name: 'Victoria' },
  { code: 'QLD', name: 'Queensland' },
  { code: 'SA', name: 'South Australia' },
  { code: 'TAS', name: 'Tasmania' },
  { code: 'ACT', name: 'Australian Capital Territory' },
  { code: 'NT', name: 'Northern Territory' },
];
