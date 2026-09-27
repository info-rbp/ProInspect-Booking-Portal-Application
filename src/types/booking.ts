export interface InspectionService {
  id: string;
  name: string;
  publicDescription: string;
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
  code: string;
}

export interface VacantDetails {
  accessInstructions: string;
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

export interface BookingRecord {
  id: string;
  bookingReference: string; // e.g. PI-20261005-0042
  managementToken: string;  // secure random token for self-service or direct access
  serviceId: string;
  serviceName: string;
  calendarEventId?: string;
  property: PropertyDetails;
  access: AccessDetails;
  appointment: {
    start: string; // ISO string in Australia/Perth
    end: string;   // ISO string
    dateString: string;
    timeString: string;
    durationMinutes: number;
    timezone: string;
  };
  status: BookingStatus;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
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
