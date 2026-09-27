export type ServiceCategory = 'residential' | 'commercial' | 'strata-building';

export interface InspectionService {
  id: string;
  name: string;
  publicDescription: string;
  categories: ServiceCategory[];
  duration: number; // in minutes (e.g. 45, 60, 90, 120)
  bufferBefore: number; // in minutes (default 15)
  bufferAfter: number; // in minutes (default 15)
  minimumNoticeHours: number; // default 24
  maxFutureBookingDays: number; // default 60
  calendarId?: string;
  active: boolean;
  publiclyBookable: boolean;
  order: number;
  iconName?: string;
  badge?: string;
}

export type ServiceAdminInput = Omit<InspectionService, 'id' | 'order'> & {
  id?: string;
  order?: number;
};

export type PropertyType =
  | 'House'
  | 'Apartment / Unit'
  | 'Townhouse'
  | 'Commercial'
  | 'Retail'
  | 'Office'
  | 'Industrial'
  | 'Strata / Common Property'
  | 'Other';

export interface AddressVerification {
  status: 'verified' | 'unverified';
  formattedAddress?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  validationGranularity?: string;
  possibleNextAction?: string;
  addressComplete?: boolean;
  validatedAt?: string;
}

export interface PropertyDetails {
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType: PropertyType;
  clientName?: string; // Agency or Landlord name
  clientReference?: string; // Agency file ref / property code
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressVerification?: AddressVerification;
}

export type AccessMethod =
  | 'tenant'
  | 'meet_onsite'
  | 'keys_agency'
  | 'keys_proinspect'
  | 'lockbox'
  | 'vacant'
  | 'other';

export interface TenantAccessDetails {
  tenantName: string;
  tenantPhone: string;
  tenantEmail?: string;
  noticeIssued: 'yes' | 'no' | 'pending';
  noticeDate?: string;
  accessRestrictions?: string;
}

export interface MeetOnsiteDetails {
  contactName: string;
  contactPhone: string;
  relationship: string;
  specialInstructions?: string;
}

export interface AgencyKeysDetails {
  agencyName: string;
  collectionAddress: string;
  keyReference?: string;
  keyInstructions?: string;
  returnInstructions?: string;
}

export interface ProInspectKeysDetails {
  keyReference?: string;
  additionalInstructions?: string;
}

export interface LockboxDetails {
  location: string;
  instructions?: string;
  // Required in the customer form, but removed from the booking document after
  // server-side encryption and restored only for authenticated staff responses.
  code?: string;
}

export interface VacantDetails {
  accessInstructions: string;
  // Removed from the booking document after server-side encryption and restored
  // only for authenticated staff responses.
  securityAlarm?: string;
}

export interface OtherAccessDetails {
  instructions: string;
}

export interface AccessDetails {
  method: AccessMethod;
  tenant?: TenantAccessDetails;
  meetOnsite?: MeetOnsiteDetails;
  agencyKeys?: AgencyKeysDetails;
  proInspectKeys?: ProInspectKeysDetails;
  lockbox?: LockboxDetails;
  vacant?: VacantDetails;
  other?: OtherAccessDetails;
  specialInstructions?: string; // Global attendance / pets / parking / security notes
}

export interface AppointmentSlot {
  start: string; // ISO string e.g. 2026-10-05T09:00:00+08:00
  end: string;   // ISO string e.g. 2026-10-05T09:45:00+08:00
  displayTime: string; // e.g. 9:00 am
  displayDate: string; // e.g. Monday, 5 October 2026
  dateKey: string;     // e.g. 2026-10-05
}

export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';
export type BookingReadinessStatus = 'ready' | 'pending_notice' | 'access_action_required';
export type ConfirmationEmailStatus = 'sent' | 'failed' | 'not_configured';

export interface BookingRecord {
  id: string;
  bookingReference: string; // e.g. PI-20261005-0042
  managementToken: string;  // secure random token for self-service or direct access
  serviceId: string;
  serviceName: string;
  serviceCategory?: ServiceCategory; // New bookings retain the customer-selected category; older records may not have it.
  calendarId?: string;
  calendarEventId?: string;
  calendarHtmlLink?: string;
  property: PropertyDetails;
  access: AccessDetails;
  readinessStatus: BookingReadinessStatus;
  appointment: {
    start: string; // ISO timestamp
    end: string;   // ISO timestamp
    dateKey: string; // YYYY-MM-DD in Australia/Perth
    dateString: string;
    timeString: string;
    durationMinutes: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    timezone: string;
  };
  status: BookingStatus;
  adminNotes?: string;
  confirmationEmail?: {
    status: ConfirmationEmailStatus;
    attemptedAt?: string;
    providerMessageId?: string;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PublicBookingSummary {
  bookingReference: string;
  managementToken?: string;
  managementUrl?: string;
  serviceName: string;
  serviceCategory?: ServiceCategory;
  status: BookingStatus;
  readinessStatus: BookingReadinessStatus;
  confirmationEmailStatus?: ConfirmationEmailStatus;
  property: {
    streetAddress: string;
    unit?: string;
    suburb: string;
    state: string;
    postcode: string;
    propertyType: PropertyType;
    customerName: string;
    customerEmail: string;
  };
  access: {
    method: AccessMethod;
  };
  appointment: BookingRecord['appointment'];
}

export interface AddressSuggestion {
  placeId: string;
  text: string;
  mainText?: string;
  secondaryText?: string;
}

export interface AddressValidationResult {
  verified: boolean;
  requiresConfirmation: boolean;
  message?: string;
  formattedAddress?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  validationGranularity?: string;
  possibleNextAction?: string;
  addressComplete?: boolean;
  streetAddress?: string;
  unit?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
}

export interface OperatingHours {
  monday: { open: string; close: string; active: boolean };
  tuesday: { open: string; close: string; active: boolean };
  wednesday: { open: string; close: string; active: boolean };
  thursday: { open: string; close: string; active: boolean };
  friday: { open: string; close: string; active: boolean };
  saturday: { open: string; close: string; active: boolean };
  sunday: { open: string; close: string; active: boolean };
}

export interface BusinessSettings {
  timezone: string; // Australia/Perth
  locale: string;   // en-AU
  operatingHours: OperatingHours;
  minimumNoticeHours: number; // 24
  maxFutureBookingDays: number; // 60
  calendarConnected?: boolean;
  calendarEmail?: string;
}
