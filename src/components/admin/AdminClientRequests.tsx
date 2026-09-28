import React, { useMemo, useState } from 'react';
import { FileCheck2, FileText, Wrench } from 'lucide-react';
import type {
  ClientApproval,
  ClientDocumentSummary,
  ClientRequestSummary,
} from '../../types/clientPortal';
import type { DocumentRequestRecord } from '../../types/documentRequest';

export function AdminClientRequests({
  requests,
  approvals,
  documents,
  publicDocumentRequests,
  onUpdateStatus,
  onUpdatePublicDocumentStatus,
  onDownloadDocument,
}: {
  requests: ClientRequestSummary[];
  approvals: ClientApproval[];
  documents: ClientDocumentSummary[];
  publicDocumentRequests: DocumentRequestRecord[];
  onUpdateStatus: (
    requestId: string,
    status: ClientRequestSummary['status']
  ) => Promise<void>;
  onUpdatePublicDocumentStatus: (
    requestId: string,
    status: DocumentRequestRecord['status']
  ) => Promise<void>;
  onDownloadDocument: (documentId: string) => Promise<void>;
}) {
  const [typeFilter, setTypeFilter] = useState<'all' | ClientRequestSummary['type']>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const visibleClientRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          !(
            request.type === 'document' &&
            typeof request.details?.sourceDocumentRequestId === 'string'
          )
      ),
    [requests]
  );

  const filtered = useMemo(
    () =>
      visibleClientRequests.filter((request) =>
        typeFilter === 'all' ? true : request.type === typeFilter
      ),
    [visibleClientRequests, typeFilter]
  );

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Open requests', visibleClientRequests.filter((item) => !['completed','cancelled'].includes(item.status)).length + publicDocumentRequests.filter((item) => !['completed','cancelled'].includes(item.status)).length],
          ['Document requests', visibleClientRequests.filter((item) => item.type === 'document').length + publicDocumentRequests.length],
          ['Maintenance', visibleClientRequests.filter((item) => item.type === 'maintenance').length],
          ['Pending approvals', pendingApprovals.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-2xl font-black text-[#1A2B4A]">{value}</div>
            <div className="text-xs font-semibold text-slate-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-[#1A2B4A]">Client Portal Requests</h2>
          <p className="text-xs text-slate-500 mt-1">Requests submitted through authenticated client accounts.</p>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="h-10 px-3 text-xs font-semibold border border-slate-300 rounded-lg"
        >
          <option value="all">All request types</option>
          <option value="document">Documents</option>
          <option value="maintenance">Maintenance</option>
          <option value="general">General</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.map((request) => (
          <div key={request.id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0">
                  {request.type === 'maintenance' ? <Wrench className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase rounded bg-slate-100 px-2 py-1 text-slate-600">{request.type}</span>
                    {request.priority && <span className="text-[10px] font-black uppercase rounded bg-amber-50 px-2 py-1 text-amber-700">{request.priority}</span>}
                  </div>
                  <div className="mt-2 font-bold text-[#1A2B4A]">{request.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Request {request.id} · {new Date(request.createdAt).toLocaleDateString('en-AU')}
                  </div>
                  {(request.organisationName ||
                    request.propertyAddress ||
                    request.submittedByEmail) && (
                    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1">
                      {request.organisationName && (
                        <div><span className="font-semibold">Organisation:</span> {request.organisationName}</div>
                      )}
                      {request.propertyAddress && (
                        <div><span className="font-semibold">Property:</span> {request.propertyAddress}</div>
                      )}
                      {request.submittedByEmail && (
                        <div>
                          <span className="font-semibold">Submitted by:</span>{' '}
                          {request.submittedByName || request.submittedByEmail}
                          {request.submittedByName ? ` · ${request.submittedByEmail}` : ''}
                        </div>
                      )}
                    </div>
                  )}
                  {request.details && (
                    <div className="mt-3 text-xs text-slate-600 space-y-1">
                      {Object.entries(request.details).slice(0, 6).map(([key, value]) => (
                        <div key={key}><span className="font-semibold capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span> {Array.isArray(value) ? value.join(', ') : String(value)}</div>
                      ))}
                    </div>
                  )}
                  {(request.attachmentDocumentIds || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(request.attachmentDocumentIds || []).map((documentId) => {
                        const document = documents.find((item) => item.id === documentId);
                        return (
                          <button
                            key={documentId}
                            type="button"
                            onClick={() => onDownloadDocument(documentId)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-[#006D70] hover:bg-[#F0FBFB]"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {document?.name || 'Request attachment'}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <select
                value={request.status}
                disabled={busy === request.id}
                onChange={async (e) => {
                  setBusy(request.id);
                  try {
                    await onUpdateStatus(
                      request.id,
                      e.target.value as ClientRequestSummary['status']
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
                className="h-10 px-3 text-xs font-bold border border-slate-300 rounded-lg"
              >
                <option value="submitted">Submitted</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_client">Waiting on client</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
            No client requests match this filter.
          </div>
        )}
      </div>

      {publicDocumentRequests.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#007F82]" />
            <div>
              <h2 className="font-bold text-[#1A2B4A]">Public Document Catalogue Requests</h2>
              <p className="text-xs text-slate-500 mt-1">
                Guided document requests submitted through the public Request a Document workflow.
              </p>
            </div>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {publicDocumentRequests.map((request) => (
              <div key={request.id} className="py-4">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] font-black uppercase rounded bg-[#F0FBFB] px-2 py-1 text-[#006D70]">
                        {request.requestReference}
                      </span>
                      <span className="text-[10px] font-black uppercase rounded bg-slate-100 px-2 py-1 text-slate-600">
                        {request.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-2 font-bold text-[#1A2B4A]">{request.documentName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {request.details.unit ? `${request.details.unit}, ` : ''}
                      {request.details.streetAddress}, {request.details.suburb} {request.details.state} {request.details.postcode}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {request.details.customerName} · {request.details.customerEmail} · {request.details.customerPhone}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold text-slate-600">
                      $ {request.priceExGst.toFixed(2)} + GST
                    </div>
                    <select
                      value={request.status}
                      disabled={busy === request.id}
                      onChange={async (e) => {
                        setBusy(request.id);
                        try {
                          await onUpdatePublicDocumentStatus(
                            request.id,
                            e.target.value as DocumentRequestRecord['status']
                          );
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="h-9 px-2 text-xs font-bold border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="submitted">Submitted</option>
                      <option value="in_review">In review</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-xs font-bold text-[#006D70]">
                    View guided workflow details
                  </summary>
                  <div className="mt-3 text-xs text-slate-600 space-y-3">
                    <div>
                      <span className="font-semibold">Requester role:</span>{' '}
                      {request.workflow.requesterRole.replace('-', ' ')}
                    </div>
                    {request.workflow.lessors.length > 0 && (
                      <div>
                        <div className="font-semibold mb-1">Landlord / lessor parties</div>
                        {request.workflow.lessors.map((party) => (
                          <div key={party.id} className="mb-1">
                            {party.name}
                            {party.email ? ` · ${party.email}` : ''}
                            {party.phone ? ` · ${party.phone}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {request.workflow.tenants.length > 0 && (
                      <div>
                        <div className="font-semibold mb-1">Tenant parties</div>
                        {request.workflow.tenants.map((party) => (
                          <div key={party.id} className="mb-1">
                            {party.name}
                            {party.email ? ` · ${party.email}` : ''}
                            {party.phone ? ` · ${party.phone}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    <div>
                      <div className="font-semibold mb-1">Workflow answers</div>
                      <pre className="whitespace-pre-wrap break-words rounded bg-white border border-slate-200 p-3 text-[11px] leading-relaxed overflow-x-auto">
                        {JSON.stringify(request.workflow.answers, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingApprovals.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-[#007F82]" />
            <h2 className="font-bold text-[#1A2B4A]">Pending client approvals</h2>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="py-3">
                <div className="font-semibold text-sm text-[#1A2B4A]">{approval.title}</div>
                <div className="text-xs text-slate-500 mt-1">{approval.summary || approval.type}</div>
                {approval.documentId && (
                  <button
                    type="button"
                    onClick={() => onDownloadDocument(approval.documentId!)}
                    className="mt-2 text-xs font-bold text-[#006D70]"
                  >
                    Download draft
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
