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

export interface TenantProperty {
  id: string;
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  propertyType?: string;
  clientName?: string;
  clientReference?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface TenancyRecord {
  id: string;
  propertyId: string;
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
  | 'bond'
  | 'inspection_notice'
  | 'rent_notice'
  | 'breach_notice'
  | 'variation'
  | 'pet_modification'
  | 'termination'
  | 'correspondence'
  | 'other';

export interface TenantDocument {
  id: string;
  tenancyId: string;
  propertyId: string;
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

export interface TenantPortalDashboard {
  tenant: Pick<TenantUserRecord, 'id' | 'email' | 'displayName' | 'phone'>;
  tenancies: TenantTenancyView[];
  requests: TenantRequest[];
  documents: TenantDocument[];
  inspections: TenantInspection[];
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
  properties: TenantProperty[];
  tenancies: TenancyRecord[];
  tenantUsers: TenantUserRecord[];
  requests: TenantRequest[];
  documents: TenantDocument[];
  inspections: TenantInspection[];
}
