export type TenantRequestType =
  | 'maintenance'
  | 'emergency_maintenance'
  | 'pet'
  | 'modification'
  | 'occupant'
  | 'inspection_access'
  | 'lease'
  | 'vacate'
  | 'complaint'
  | 'keys_access'
  | 'other';

export type TenantRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'action_required'
  | 'approved'
  | 'declined'
  | 'in_progress'
  | 'completed'
  | 'closed';

export type TenantRequestPriority = 'normal' | 'urgent' | 'emergency';

export type ClientType =
  | 'landlord'
  | 'agency'
  | 'commercial_landlord'
  | 'strata_company'
  | 'asset_manager'
  | 'other';

export type ClientPropertyRole =
  | 'owner'
  | 'landlord'
  | 'managing_agent'
  | 'asset_manager'
  | 'strata_manager'
  | 'other';

export type PortalAudience = 'tenant' | 'client' | 'staff';

export interface ClientRecord {
  id: string;
  name: string;
  clientType: ClientType;
  email?: string;
  phone?: string;
  externalReference?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ClientUserRecord {
  id: string;
  email: string;
  emailLower: string;
  displayName: string;
  phone?: string;
  firebaseUid?: string;
  clientIds: string[];
  clientRoles?: Record<string, 'owner' | 'admin' | 'member' | 'viewer'>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface ClientPropertyLink {
  id: string;
  clientId: string;
  propertyId: string;
  role: ClientPropertyRole;
  primary: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantProperty {
  id: string;
  addressKey?: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType?: string;
  primaryClientId?: string;
  clientName?: string;
  clientReference?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface TenancyRecord {
  id: string;
  propertyId: string;
  clientId?: string;
  status: 'pending' | 'active' | 'ended';
  startDate: string;
  endDate?: string;
  rentAmount?: number;
  rentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  bondReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserRecord {
  id: string;
  email: string;
  emailLower: string;
  displayName: string;
  phone?: string;
  firebaseUid?: string;
  tenancyIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface TenantRequestAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface TenantRequest {
  id: string;
  reference: string;
  requestType: TenantRequestType;
  tenantUserId: string;
  tenancyId: string;
  propertyId: string;
  clientIds?: string[];
  title: string;
  details: string;
  priority: TenantRequestPriority;
  status: TenantRequestStatus;
  accessPermission?: boolean;
  preferredAccessNotes?: string;
  payload?: Record<string, string | number | boolean | null>;
  attachments: TenantRequestAttachment[];
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TenantDocumentCategory =
  | 'tenancy_agreement'
  | 'property_condition_report'
  | 'inspection_report'
  | 'bond'
  | 'inspection_notice'
  | 'rent_notice'
  | 'breach_notice'
  | 'variation'
  | 'pet_modification'
  | 'termination'
  | 'maintenance'
  | 'quote'
  | 'invoice'
  | 'compliance'
  | 'property_report'
  | 'owner_statement'
  | 'correspondence'
  | 'other';

export interface TenantDocument {
  id: string;
  tenancyId?: string;
  propertyId: string;
  clientIds: string[];
  audiences: PortalAudience[];
  title: string;
  category: TenantDocumentCategory;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

export type TenantInspectionType = 'routine' | 'entry' | 'exit' | 'maintenance' | 'other';
export type TenantInspectionStatus = 'scheduled' | 'completed' | 'cancelled';

export interface TenantInspection {
  id: string;
  tenancyId: string;
  propertyId: string;
  type: TenantInspectionType;
  status: TenantInspectionStatus;
  scheduledStart: string;
  scheduledEnd?: string;
  noticeDocumentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantTenancyView {
  tenancy: TenancyRecord;
  property: TenantProperty;
}

export interface TenantPortalNotification {
  id: string;
  title: string;
  message: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface TenantPortalDashboard {
  tenant: Pick<TenantUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
  tenancies: TenantTenancyView[];
  pastTenancies: TenantTenancyView[];
  requests: TenantRequest[];
  documents: TenantDocument[];
  inspections: TenantInspection[];
  notifications: TenantPortalNotification[];
}

export interface ClientPortalDashboard {
  clientUser: Pick<ClientUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
  clients: ClientRecord[];
  properties: TenantProperty[];
  propertyLinks: ClientPropertyLink[];
  documents: TenantDocument[];
}

export interface TenantRequestCreateInput {
  tenancyId: string;
  requestType: TenantRequestType;
  title: string;
  details: string;
  priority?: TenantRequestPriority;
  accessPermission?: boolean;
  preferredAccessNotes?: string;
  payload?: Record<string, string | number | boolean | null>;
}

export interface AdminTenantPortalSnapshot {
  clients: ClientRecord[];
  clientUsers: ClientUserRecord[];
  clientPropertyLinks: ClientPropertyLink[];
  properties: TenantProperty[];
  tenancies: TenancyRecord[];
  tenantUsers: TenantUserRecord[];
  requests: TenantRequest[];
  documents: TenantDocument[];
  inspections: TenantInspection[];
}
