import type { ServiceCategory } from './booking';
import type { DocumentRequest, DocumentRequestStatus as CanonicalDocumentRequestStatus } from './platform';

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

export type DocumentRequestStatus = CanonicalDocumentRequestStatus;
export type DocumentRequestRecord = DocumentRequest;

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
