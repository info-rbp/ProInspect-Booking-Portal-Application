import type {
  BookingStatus,
  PropertyType,
  ServiceCategory,
} from './booking';

export interface ClientProfile {
  uid: string;
  email: string;
  displayName: string;
  organisationName?: string;
  phone?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientProperty {
  id: string;
  clientUid: string;
  clientEmail: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType: PropertyType;
  clientName?: string;
  clientReference?: string;
  categories: ServiceCategory[];
  createdAt: string;
  updatedAt: string;
  lastBookingAt?: string;
}

export interface ClientBookingSummary {
  id: string;
  bookingReference: string;
  propertyId?: string;
  serviceName: string;
  serviceCategory?: ServiceCategory;
  status: BookingStatus;
  property: {
    streetAddress: string;
    unit?: string;
    suburb: string;
    state: string;
    postcode: string;
    propertyType: PropertyType;
  };
  appointment: {
    start: string;
    end: string;
    dateString: string;
    timeString: string;
    durationMinutes: number;
    timezone: string;
  };
  createdAt: string;
}

export interface ClientRequestSummary {
  id: string;
  clientUid: string;
  propertyId?: string;
  type: 'document' | 'maintenance' | 'general';
  title: string;
  status: 'submitted' | 'in_progress' | 'waiting_client' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface ClientDocumentSummary {
  id: string;
  clientUid: string;
  propertyId?: string;
  name: string;
  documentType: string;
  status: 'available' | 'draft' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ClientPortalDashboard {
  profile: ClientProfile;
  properties: ClientProperty[];
  bookings: ClientBookingSummary[];
  requests: ClientRequestSummary[];
  documents: ClientDocumentSummary[];
}
