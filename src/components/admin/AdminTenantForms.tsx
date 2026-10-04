import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import type { AdminTenantPortalSnapshot } from '../../types/tenant';
import type {
  SensitiveTenantFormStatus,
  TenantFormRequest,
  TenantFormStatus,
} from '../../types/tenantForms';
import {
  fetchAdminSensitiveTenantForms,
  fetchAdminTenantForms,
  fetchAdminTenantPortal,
  getAdminSensitiveEvidenceDownloadUrl,
  getAdminTenantFormAttachmentDownloadUrl,
  updateAdminSensitiveTenantForm,
  updateAdminTenantForm,
} from '../../services/api';

const ALL_STATUSES: TenantFormStatus[] = [
  'submitted',
  'delivered',
  'under_review',
  'action_required',
  'more_information_required',
  'approved',
  'approved_with_conditions',
  'declined',
  'commissioner_review_required',
  'response_period_elapsed',
  'ready_for_lodgement',
  'lodged',
  'awaiting_parties',
  'agreed',
  'disputed',
  'processed',
  'completed',
  'closed',
];

const SENSITIVE_STATUSES: SensitiveTenantFormStatus[] = [
  'submitted',
  'restricted_review',
  'notice_prepared',
  'notice_served',
  'tenancy_record_updating',
  'completed',
];

type SensitiveAdminRecord = {
  id: string;
  reference: string;
  formName: string;
  formCode: string;
  tenantUserId: string;
  tenancyId: string;
  propertyId: string;
  status: SensitiveTenantFormStatus;
  payload?: Record<string, unknown>;
  evidence?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  }>;
  submittedAt: string;
  restrictedNotes?: string;
  createdAt: string;
  updatedAt: string;
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Perth',
  }).format(date);
}

function payloadRows(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 30);
}

export const AdminTenantForms: React.FC = () => {
  const [requests, setRequests] = useState<TenantFormRequest[]>([]);
  const [sensitive, setSensitive] = useState<SensitiveAdminRecord[]>([]);
  const [snapshot, setSnapshot] = useState<AdminTenantPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [forms, portal, restricted] = await Promise.all([
        fetchAdminTenantForms(),
        fetchAdminTenantPortal(),
        fetchAdminSensitiveTenantForms(),
      ]);
      setRequests(forms);
      setSnapshot(portal);
      setSensitive(restricted as SensitiveAdminRecord[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tenant forms.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const propertyById = useMemo(
    () => new Map(snapshot?.properties.map((property) => [property.id, property]) || []),
    [snapshot]
  );
  const tenantById = useMemo(
    () => new Map(snapshot?.tenantUsers.map((tenant) => [tenant.id, tenant]) || []),
    [snapshot]
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 flex justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading statutory forms…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-[#1A2B4A]">Statutory Forms</h3>
          <p className="mt-1 text-xs text-slate-500">
            Process tenant-initiated prescribed forms, bond workflows and PCR responses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="space-y-4">
        {requests.map((request) => {
          const property = propertyById.get(request.propertyId);
          const tenant = tenantById.get(request.tenantUserId);
          return (
            <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText className="w-4 h-4 text-[#007F82]" />
                    <span className="font-mono text-xs font-bold text-[#007F82]">{request.reference}</span>
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {request.formCode.startsWith('BOND') ? request.formCode.replaceAll('-', ' ') : `Form ${request.formCode}`}
                    </span>
                  </div>
                  <h4 className="mt-2 font-extrabold text-[#1A2B4A]">{request.formName}</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    {tenant?.displayName || request.tenantUserId} · {property ? `${property.streetAddress}, ${property.suburb}` : request.propertyId}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Submitted: {formatDate(request.submittedAt)}</span>
                    {request.responseDueAt && <span>Response/action: {formatDate(request.responseDueAt)}</span>}
                    {request.serviceMethod && <span>Method: {request.serviceMethod.replaceAll('_', ' ')}</span>}
                  </div>

                  <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <div className="text-[10px] uppercase font-black text-slate-400">Submitted information</div>
                    <dl className="mt-2 grid sm:grid-cols-2 gap-x-5 gap-y-2 text-xs">
                      {payloadRows(request.payload).map(([key, value]) => (
                        <div key={key}>
                          <dt className="font-bold text-slate-500">{key.replaceAll('_', ' ')}</dt>
                          <dd className="text-slate-800 break-words">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {request.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.attachments.map((attachment) => (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={async () => {
                            const url = await getAdminTenantFormAttachmentDownloadUrl(request.id, attachment.id);
                            window.open(url, '_blank', 'noopener,noreferrer');
                          }}
                          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-[#006D70]"
                        >
                          {attachment.fileName}
                        </button>
                      ))}
                    </div>
                  )}

                  <a
                    href={request.officialSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-xs font-bold text-[#006D70] underline"
                  >
                    Open official Consumer Protection source
                  </a>
                </div>

                <div className="w-full xl:w-72 space-y-3">
                  <select
                    value={request.status}
                    disabled={busy}
                    onChange={(event) => {
                      const status = event.target.value as TenantFormStatus;
                      void run(async () => {
                        await updateAdminTenantForm(request.id, { status });
                        setMessage(`${request.reference} updated to ${status.replaceAll('_', ' ')}.`);
                      });
                    }}
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold"
                  >
                    {ALL_STATUSES.map((status) => (
                      <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                    ))}
                  </select>

                  <select
                    value={request.serviceMethod || ''}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value as TenantFormRequest['serviceMethod'] | '';
                      if (!value) return;
                      void run(async () => {
                        await updateAdminTenantForm(request.id, { serviceMethod: value });
                        setMessage(`${request.reference} service/lodgement method saved.`);
                      });
                    }}
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs"
                  >
                    <option value="">Service / lodgement method</option>
                    <option value="portal">Portal</option>
                    <option value="email">Email</option>
                    <option value="hand">Hand delivery</option>
                    <option value="post">Post</option>
                    <option value="bondsonline">BondsOnline</option>
                    <option value="bonds_upload">Bonds Upload</option>
                  </select>

                  <textarea
                    defaultValue={request.adminNotes || ''}
                    rows={4}
                    placeholder="Internal processing notes"
                    onBlur={(event) => {
                      const adminNotes = event.target.value;
                      void run(async () => {
                        await updateAdminTenantForm(request.id, { adminNotes });
                        setMessage(`${request.reference} notes saved.`);
                      });
                    }}
                    className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {requests.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No statutory form requests have been submitted.
          </div>
        )}
      </div>

      {sensitive.length > 0 && (
        <section className="rounded-xl border-2 border-slate-400 bg-slate-50 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-slate-700 mt-0.5" />
            <div>
              <h3 className="font-extrabold text-[#1A2B4A]">Restricted Tenancy Workflows</h3>
              <p className="mt-1 text-xs text-slate-600">
                This section only appears to staff accounts with the sensitive-tenancy permission.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {sensitive.map((request) => {
              const property = propertyById.get(request.propertyId);
              const tenant = tenantById.get(request.tenantUserId);
              return (
                <div key={request.id} className="rounded-lg border border-slate-300 bg-white p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-bold text-slate-700">{request.reference}</div>
                      <div className="mt-1 font-bold text-[#1A2B4A]">Private tenancy workflow</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {tenant?.displayName || request.tenantUserId} · {property ? `${property.streetAddress}, ${property.suburb}` : request.propertyId}
                      </div>
                      <div className="mt-3 text-xs text-slate-600">
                        Evidence type: {String(request.payload?.evidenceType || 'Not recorded').replaceAll('_', ' ')}
                      </div>
                      {request.evidence && request.evidence.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {request.evidence.map((evidence) => (
                            <button
                              key={evidence.id}
                              type="button"
                              onClick={async () => {
                                const url = await getAdminSensitiveEvidenceDownloadUrl(request.id, evidence.id);
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700"
                            >
                              {evidence.fileName}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="w-full lg:w-72 space-y-2">
                      <select
                        value={request.status}
                        disabled={busy}
                        onChange={(event) => {
                          const status = event.target.value as SensitiveTenantFormStatus;
                          void run(async () => {
                            await updateAdminSensitiveTenantForm(request.id, { status });
                            setMessage('Restricted workflow status updated.');
                          });
                        }}
                        className="w-full h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold"
                      >
                        {SENSITIVE_STATUSES.map((status) => (
                          <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                      <textarea
                        defaultValue={request.restrictedNotes || ''}
                        rows={4}
                        placeholder="Restricted notes"
                        onBlur={(event) => {
                          const restrictedNotes = event.target.value;
                          void run(async () => {
                            await updateAdminSensitiveTenantForm(request.id, { restrictedNotes });
                            setMessage('Restricted notes saved.');
                          });
                        }}
                        className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
