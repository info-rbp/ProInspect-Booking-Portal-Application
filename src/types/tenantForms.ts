export type TenantFormWorkflowType =
  | 'furniture_safety'
  | 'pet_request'
  | 'minor_modification'
  | 'major_modification'
  | 'bond_release'
  | 'bond_variation'
  | 'pcr_response'
  | 'family_violence_termination';

export type TenantFormStatus =
  | 'draft'
  | 'submitted'
  | 'delivered'
  | 'under_review'
  | 'action_required'
  | 'more_information_required'
  | 'approved'
  | 'approved_with_conditions'
  | 'declined'
  | 'commissioner_review_required'
  | 'response_period_elapsed'
  | 'ready_for_lodgement'
  | 'lodged'
  | 'awaiting_parties'
  | 'agreed'
  | 'disputed'
  | 'processed'
  | 'completed'
  | 'closed';

export type SensitiveTenantFormStatus =
  | 'draft'
  | 'submitted'
  | 'restricted_review'
  | 'notice_prepared'
  | 'notice_served'
  | 'tenancy_record_updating'
  | 'completed';

export interface TenantFormDefinition {
  id: string;
  workflowType: TenantFormWorkflowType;
  formCode: string;
  name: string;
  shortName: string;
  description: string;
  officialSourceUrl: string;
  officialTemplateUrl?: string;
  officialVersion?: string;
  responseDays?: number;
  tenantResponseDays?: number;
  sensitive: boolean;
  active: boolean;
  category: 'request' | 'bond' | 'inspection' | 'sensitive';
  clientApproval: boolean;
  responseRule?: 'calendar_days_from_delivery' | 'calendar_days_from_receipt';
  expiryBehaviour?: 'flag_elapsed' | 'auto_approved_subject_to_law' | 'none';
}

export interface TenantFormAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  /** Server-side only. Public serializers strip this field before responding. */
  storagePath?: string;
}

export interface TenantFormRequest {
  id: string;
  reference: string;
  workflowType: Exclude<TenantFormWorkflowType, 'family_violence_termination'>;
  formDefinitionId: string;
  formCode: string;
  formName: string;
  officialSourceUrl: string;
  officialVersion?: string;
  tenantUserId: string;
  tenancyId: string;
  propertyId: string;
  clientId?: string;
  status: TenantFormStatus;
  payload: Record<string, unknown>;
  attachments: TenantFormAttachment[];
  generatedDocumentId?: string;
  finalDocumentId?: string;
  clientApprovalId?: string;
  submittedAt: string;
  deliveredAt?: string;
  responseDueAt?: string;
  respondedAt?: string;
  responseOutcome?: string;
  serviceMethod?: 'portal' | 'email' | 'hand' | 'post' | 'bondsonline' | 'bonds_upload';
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SensitiveTenantFormRequest {
  id: string;
  reference: string;
  workflowType: 'family_violence_termination';
  formDefinitionId: string;
  formCode: '2';
  formName: string;
  officialSourceUrl: string;
  tenantUserId: string;
  tenancyId: string;
  propertyId: string;
  status: SensitiveTenantFormStatus;
  payload: Record<string, unknown>;
  evidence: TenantFormAttachment[];
  submittedAt: string;
  noticePreparedAt?: string;
  noticeServedAt?: string;
  completedAt?: string;
  restrictedNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantFormCreateInput {
  tenancyId: string;
  formDefinitionId: string;
  payload: Record<string, unknown>;
}

export interface TenantFormsDashboard {
  definitions: TenantFormDefinition[];
  requests: TenantFormRequest[];
  sensitiveRequests: Array<Pick<
    SensitiveTenantFormRequest,
    'id' | 'reference' | 'workflowType' | 'formCode' | 'formName' | 'status' | 'submittedAt' | 'createdAt' | 'updatedAt'
  >>;
}
