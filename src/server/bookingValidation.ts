import type {
  AccessDetails,
  BookingReadinessStatus,
  PropertyDetails,
  PropertyType,
} from '../types/booking.js';
import {
  isValidAustralianPhone,
  isValidAustralianPostcode,
  isValidEmail,
} from '../utils/australianValidation.js';

const PROPERTY_TYPES: PropertyType[] = [
  'House',
  'Apartment / Unit',
  'Townhouse',
  'Commercial',
  'Retail',
  'Office',
  'Industrial',
  'Strata / Common Property',
  'Other',
];

const AUSTRALIAN_STATES = new Set(['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT']);

export interface SensitiveAccessSecrets {
  lockboxCode?: string;
  securityAlarm?: string;
}

export function normalizeText(value: unknown, maxLength = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function postcodeMatchesState(postcode: string, state: string): boolean {
  const value = Number(postcode);
  if (!Number.isInteger(value)) return false;

  switch (state) {
    case 'WA':
      return value >= 6000 && value <= 6999;
    case 'NSW':
      return (
        (value >= 1000 && value <= 2599) ||
        (value >= 2619 && value <= 2899) ||
        (value >= 2921 && value <= 2999)
      );
    case 'ACT':
      return (
        (value >= 200 && value <= 299) ||
        (value >= 2600 && value <= 2618) ||
        (value >= 2900 && value <= 2920)
      );
    case 'VIC':
      return (value >= 3000 && value <= 3999) || (value >= 8000 && value <= 8999);
    case 'QLD':
      return (value >= 4000 && value <= 4999) || (value >= 9000 && value <= 9999);
    case 'SA':
      return value >= 5000 && value <= 5999;
    case 'TAS':
      return value >= 7000 && value <= 7999;
    case 'NT':
      return value >= 800 && value <= 999;
    default:
      return false;
  }
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return !Number.isNaN(parsed.getTime());
}

export function sanitizeBookingProperty(
  input: unknown
): { property?: PropertyDetails; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Property details are required.' };
  }

  const value = input as Record<string, unknown>;
  const streetAddress = normalizeText(value.streetAddress, 150);
  const unit = normalizeText(value.unit, 50);
  const suburb = normalizeText(value.suburb, 100);
  const state = normalizeText(value.state, 10).toUpperCase() || 'WA';
  const postcode = normalizeText(value.postcode, 4);
  const customerName = normalizeText(value.customerName, 100);
  const customerEmail = normalizeText(value.customerEmail, 120).toLowerCase();
  const customerPhone = normalizeText(value.customerPhone, 50);
  const clientName = normalizeText(value.clientName, 100);
  const clientReference = normalizeText(value.clientReference, 100);
  const propertyType = PROPERTY_TYPES.includes(value.propertyType as PropertyType)
    ? (value.propertyType as PropertyType)
    : null;

  if (!streetAddress || !suburb) {
    return { error: 'A complete property street address and suburb are required.' };
  }

  if (!AUSTRALIAN_STATES.has(state)) {
    return { error: 'Select a valid Australian state or territory.' };
  }

  if (!isValidAustralianPostcode(postcode) || !postcodeMatchesState(postcode, state)) {
    return {
      error: 'The postcode does not match the selected Australian state or territory.',
    };
  }

  if (!propertyType) {
    return { error: 'Select a valid property type.' };
  }

  if (!customerName) {
    return { error: 'A booking contact name is required.' };
  }

  if (!isValidEmail(customerEmail)) {
    return { error: 'Enter a valid booking contact email address.' };
  }

  if (!isValidAustralianPhone(customerPhone)) {
    return { error: 'Enter a valid Australian booking contact phone number.' };
  }

  return {
    property: {
      streetAddress,
      unit: unit || undefined,
      suburb,
      state,
      postcode,
      propertyType,
      clientName: clientName || undefined,
      clientReference: clientReference || undefined,
      customerName,
      customerEmail,
      customerPhone,
    },
  };
}

export function sanitizeBookingAccess(
  input: unknown
): {
  access?: AccessDetails;
  secrets?: SensitiveAccessSecrets;
  readinessStatus?: BookingReadinessStatus;
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { error: 'Property access details are required.' };
  }

  const value = input as Record<string, any>;
  const method = normalizeText(value.method, 40);

  if (
    ![
      'tenant',
      'meet_onsite',
      'keys_agency',
      'keys_proinspect',
      'lockbox',
      'vacant',
      'other',
    ].includes(method)
  ) {
    return { error: 'Select a valid property access method.' };
  }

  const access: AccessDetails = {
    method: method as AccessDetails['method'],
    specialInstructions: normalizeText(value.specialInstructions, 2000) || undefined,
  };
  const secrets: SensitiveAccessSecrets = {};
  let readinessStatus: BookingReadinessStatus = 'ready';

  if (method === 'tenant') {
    const tenant = value.tenant || {};
    const tenantName = normalizeText(tenant.tenantName, 100);
    const tenantPhone = normalizeText(tenant.tenantPhone, 50);
    const tenantEmail = normalizeText(tenant.tenantEmail, 120).toLowerCase();
    const noticeIssued = normalizeText(tenant.noticeIssued, 20) as 'yes' | 'no' | 'pending';
    const noticeDate = normalizeText(tenant.noticeDate, 20);

    if (!tenantName || !isValidAustralianPhone(tenantPhone)) {
      return { error: 'Valid tenant name and Australian phone details are required.' };
    }

    if (tenantEmail && !isValidEmail(tenantEmail)) {
      return { error: 'The tenant email address is not valid.' };
    }

    if (!['yes', 'no', 'pending'].includes(noticeIssued)) {
      return { error: 'Select whether the required entry notice has been issued.' };
    }

    if (noticeIssued === 'yes' && (!noticeDate || !isValidIsoDate(noticeDate))) {
      return { error: 'Enter the date the tenant entry notice was issued.' };
    }

    if (noticeIssued === 'pending') readinessStatus = 'pending_notice';
    if (noticeIssued === 'no') readinessStatus = 'access_action_required';

    access.tenant = {
      tenantName,
      tenantPhone,
      tenantEmail: tenantEmail || undefined,
      noticeIssued,
      noticeDate: noticeIssued === 'yes' ? noticeDate : undefined,
      accessRestrictions: normalizeText(tenant.accessRestrictions, 1000) || undefined,
    };
  }

  if (method === 'meet_onsite') {
    const contact = value.meetOnsite || {};
    const contactName = normalizeText(contact.contactName, 100);
    const contactPhone = normalizeText(contact.contactPhone, 50);

    if (!contactName || !isValidAustralianPhone(contactPhone)) {
      return { error: 'Valid onsite contact name and Australian phone details are required.' };
    }

    access.meetOnsite = {
      contactName,
      contactPhone,
      relationship: normalizeText(contact.relationship, 100) || 'Other',
      specialInstructions: normalizeText(contact.specialInstructions, 1000) || undefined,
    };
  }

  if (method === 'keys_agency') {
    const agency = value.agencyKeys || {};
    const agencyName = normalizeText(agency.agencyName, 120);
    const collectionAddress = normalizeText(agency.collectionAddress, 200);

    if (!agencyName || !collectionAddress) {
      return { error: 'Agency name and key collection address are required.' };
    }

    access.agencyKeys = {
      agencyName,
      collectionAddress,
      keyReference: normalizeText(agency.keyReference, 100) || undefined,
      keyInstructions: normalizeText(agency.keyInstructions, 1000) || undefined,
      returnInstructions: normalizeText(agency.returnInstructions, 1000) || undefined,
    };
  }

  if (method === 'keys_proinspect') {
    const keys = value.proInspectKeys || {};
    access.proInspectKeys = {
      keyReference: normalizeText(keys.keyReference, 100) || undefined,
      additionalInstructions: normalizeText(keys.additionalInstructions, 1000) || undefined,
    };
  }

  if (method === 'lockbox') {
    const lockbox = value.lockbox || {};
    const location = normalizeText(lockbox.location, 200);
    const code = normalizeText(lockbox.code, 100);

    if (!location || !code) {
      return { error: 'Lockbox location and combination code are required.' };
    }

    access.lockbox = {
      location,
      instructions: normalizeText(lockbox.instructions, 1000) || undefined,
    };
    secrets.lockboxCode = code;
  }

  if (method === 'vacant') {
    const vacant = value.vacant || {};
    const accessInstructions = normalizeText(vacant.accessInstructions, 1000);

    if (!accessInstructions) {
      return { error: 'Vacant property access instructions are required.' };
    }

    access.vacant = {
      accessInstructions,
    };

    const securityAlarm = normalizeText(vacant.securityAlarm, 500);
    if (securityAlarm) secrets.securityAlarm = securityAlarm;
  }

  if (method === 'other') {
    const other = value.other || {};
    const instructions = normalizeText(other.instructions, 1000);
    if (!instructions) {
      return { error: 'Provide the custom property access procedure.' };
    }
    access.other = { instructions };
  }

  return {
    access,
    secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
    readinessStatus,
  };
}
