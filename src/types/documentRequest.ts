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
