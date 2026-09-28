import type { ServiceCategory } from './booking';

export interface DocumentProduct {
  id: string;
  name: string;
  publicDescription: string;
  categories: ServiceCategory[];
  priceExGst: number;
  active: boolean;
  publiclyRequestable: boolean;
  order: number;
  formCode?: string;
  badge?: string;
}

export interface DocumentRequestDetails {
  streetAddress: string;
  unit?: string;
  suburb: string;
  state: string;
  postcode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  clientName?: string;
  clientReference?: string;
  notes?: string;
}

export interface DocumentParty {
  id: string;
  name: string;
  address?: string;
  postcode?: string;
  email?: string;
  phone?: string;
}

export type DocumentRequesterRole =
  | 'lessor'
  | 'property-manager'
  | 'tenant'
  | 'other';

export type DocumentWorkflowAnswer =
  | string
  | number
  | boolean
  | string[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | null;

export interface DocumentWorkflowData {
  version: 1;
  requesterRole: DocumentRequesterRole;
  lessors: DocumentParty[];
  tenants: DocumentParty[];
  answers: Record<string, DocumentWorkflowAnswer>;
}

export type DocumentWorkflowFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'currency'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'multiselect'
  | 'tenant-select'
  | 'party-electronic-consents'
  | 'party-payouts';

export interface DocumentWorkflowOption {
  value: string;
  label: string;
}

export interface DocumentWorkflowCondition {
  fieldId: string;
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
  includes?: string;
}

export interface DocumentWorkflowField {
  id: string;
  label: string;
  type: DocumentWorkflowFieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: DocumentWorkflowOption[];
  showWhen?: DocumentWorkflowCondition;
  sensitive?: boolean;
  min?: number;
  max?: number;
  step?: string;
}

export interface DocumentWorkflowSection {
  id: string;
  title: string;
  description?: string;
  notice?: string;
  fields: DocumentWorkflowField[];
}

export interface DocumentWorkflowDefinition {
  documentId: string;
  version: 1;
  title: string;
  intro?: string;
  allowedRequesterRoles?: DocumentRequesterRole[];
  minimumLessors?: number;
  minimumTenants?: number;
  reviewNotice?: string;
  sections: DocumentWorkflowSection[];
}

export type DocumentRequestStatus =
  | 'submitted'
  | 'in_review'
  | 'completed'
  | 'cancelled';

export interface DocumentRequestRecord {
  id: string;
  requestReference: string;
  documentId: string;
  documentName: string;
  documentCategory: ServiceCategory;
  priceExGst: number;
  details: DocumentRequestDetails;
  workflow: DocumentWorkflowData;
  status: DocumentRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDocumentRequestSummary {
  requestReference: string;
  documentName: string;
  documentCategory: ServiceCategory;
  priceExGst: number;
  status: DocumentRequestStatus;
  details: Pick<
    DocumentRequestDetails,
    | 'streetAddress'
    | 'unit'
    | 'suburb'
    | 'state'
    | 'postcode'
    | 'customerName'
    | 'customerEmail'
  >;
}
