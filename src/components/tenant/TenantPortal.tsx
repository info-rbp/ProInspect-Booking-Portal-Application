import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { TenantStatutoryForms } from './TenantStatutoryForms';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Send,
  Upload,
  UserPlus,
  Wrench,
} from 'lucide-react';
import type {
  TenantPortalDashboard,
  TenantRequest,
  TenantRequestPriority,
  TenantRequestType,
} from '../../types/tenant';
import {
  fetchTenantDashboard,
  getTenantAttachmentDownloadUrl,
  markTenantNotificationRead,
  getTenantDocumentDownloadUrl,
  submitTenantRequest,
  uploadTenantRequestAttachment,
  verifyTenantSession,
} from '../../services/api';
import {
  completeTenantSignIn,
  logoutTenant,
  sendTenantSignInLink,
  tenantEmailLinkIsActive,
} from '../../services/firebase';

type TenantTab = 'overview' | 'forms' | 'requests' | 'documents' | 'inspections' | 'tenancy';

interface TenantPortalProps {
  authUser: User | null;
  onAuthenticated: (user: User) => void;
  onLoggedOut: () => void;
  onBack: () => void;
}

const REQUEST_OPTIONS: Array<{
  type: TenantRequestType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    type: 'maintenance',
    label: 'Report Maintenance',
    description: 'Report repairs, damage or an issue requiring attention.',
    icon: Wrench,
  },
  {
    type: 'occupant',
    label: 'Occupant / Tenant Change',
    description: 'Request an additional occupant or tenancy change.',
    icon: UserPlus,
  },
  {
    type: 'inspection_access',
    label: 'Inspection & Access',
    description: 'Send access information or raise an inspection query.',
    icon: KeyRound,
  },
  {
    type: 'vacate',
    label: 'Moving Out / Key Return',
    description: 'Request non-statutory moving assistance or key-return arrangements. This does not serve a termination notice.',
    icon: Home,
  },
  {
    type: 'complaint',
    label: 'Report a Problem',
    description: 'Raise a tenancy, privacy, neighbour or other concern.',
    icon: MessageSquareWarning,
  },
  {
    type: 'other',
    label: 'Other Request',
    description: 'Send another tenancy-related request to ProInspect.',
    icon: ClipboardList,
  },
];

const REQUEST_LABELS: Record<TenantRequestType, string> = {
  maintenance: 'Maintenance',
  emergency_maintenance: 'Emergency maintenance',
  pet: 'Pet request',
  modification: 'Modification request',
  occupant: 'Occupant / tenant change',
  inspection_access: 'Inspection & access',
  lease: 'Lease request',
  vacate: 'Moving out / key return',
  complaint: 'Problem / complaint',
  keys_access: 'Keys / access',
  other: 'Other request',
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Perth',
  }).format(date);
}

function statusClass(status: TenantRequest['status']): string {
  if (['approved', 'completed', 'closed'].includes(status)) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (['declined', 'action_required'].includes(status)) {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  if (status === 'in_progress') {
    return 'bg-sky-50 text-sky-700 border-sky-200';
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export const TenantPortal: React.FC<TenantPortalProps> = ({
  authUser,
  onAuthenticated,
  onLoggedOut,
  onBack,
}) => {
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsCompletionEmail, setNeedsCompletionEmail] = useState(false);

  const [dashboard, setDashboard] = useState<TenantPortalDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TenantTab>('overview');

  const [composerType, setComposerType] = useState<TenantRequestType | null>(null);
  const [composerTenancyId, setComposerTenancyId] = useState('');
  const [composerTitle, setComposerTitle] = useState('');
  const [composerDetails, setComposerDetails] = useState('');
  const [composerPriority, setComposerPriority] = useState<TenantRequestPriority>('normal');
  const [composerAccess, setComposerAccess] = useState(false);
  const [composerAccessNotes, setComposerAccessNotes] = useState('');
  const [composerFiles, setComposerFiles] = useState<File[]>([]);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSuccess, setComposerSuccess] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setPortalError(null);
    try {
      await verifyTenantSession();
      const data = await fetchTenantDashboard();
      setDashboard(data);
      if (!composerTenancyId && data.tenancies[0]) {
        setComposerTenancyId(data.tenancies[0].tenancy.id);
      }
    } catch (error) {
      setDashboard(null);
      setPortalError(error instanceof Error ? error.message : 'Unable to load the tenant portal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authUser) {
      void loadDashboard();
    } else {
      setDashboard(null);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    if (authUser || !tenantEmailLinkIsActive()) return;

    setAuthBusy(true);
    setAuthError(null);
    completeTenantSignIn()
      .then(({ user }) => {
        onAuthenticated(user);
        window.history.replaceState({}, '', '/tenant');
      })
      .catch((error) => {
        setNeedsCompletionEmail(true);
        setAuthError(error instanceof Error ? error.message : 'Unable to complete sign in.');
      })
      .finally(() => setAuthBusy(false));
  }, []);

  const activeTenancy = useMemo(
    () => dashboard?.tenancies.find((item) => item.tenancy.id === composerTenancyId),
    [dashboard, composerTenancyId]
  );

  const beginRequest = (type: TenantRequestType) => {
    setComposerType(type);
    setComposerTitle(REQUEST_LABELS[type]);
    setComposerDetails('');
    setComposerPriority(type === 'emergency_maintenance' ? 'emergency' : 'normal');
    setComposerAccess(false);
    setComposerAccessNotes('');
    setComposerFiles([]);
    setComposerError(null);
    setComposerSuccess(null);
    if (!composerTenancyId && dashboard?.tenancies[0]) {
      setComposerTenancyId(dashboard.tenancies[0].tenancy.id);
    }
  };

  const resetComposer = () => {
    setComposerType(null);
    setComposerTitle('');
    setComposerDetails('');
    setComposerPriority('normal');
    setComposerAccess(false);
    setComposerAccessNotes('');
    setComposerFiles([]);
    setComposerError(null);
  };

  const handleSendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      await sendTenantSignInLink(email);
      setLinkSent(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to send the sign-in link.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCompleteWithEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { user } = await completeTenantSignIn(email);
      onAuthenticated(user);
      window.history.replaceState({}, '', '/tenant');
      setNeedsCompletionEmail(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to complete sign in.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSubmitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!composerType || !composerTenancyId) return;

    setComposerBusy(true);
    setComposerError(null);
    setComposerSuccess(null);

    try {
      let request = await submitTenantRequest({
        tenancyId: composerTenancyId,
        requestType: composerType,
        title: composerTitle,
        details: composerDetails,
        priority: composerPriority,
        accessPermission: composerAccess,
        preferredAccessNotes: composerAccessNotes || undefined,
      });

      for (const file of composerFiles) {
        request = await uploadTenantRequestAttachment(request.id, file);
      }

      setComposerSuccess(`Request ${request.reference} submitted successfully.`);
      await loadDashboard();
      setActiveTab('requests');
      setTimeout(() => resetComposer(), 1200);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'Unable to submit the request.');
    } finally {
      setComposerBusy(false);
    }
  };

  const handleLogout = async () => {
    await logoutTenant();
    setDashboard(null);
    onLoggedOut();
  };

  if (!authUser) {
    return (
      <div className="max-w-xl mx-auto py-8 sm:py-14">
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-[#006D70]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Client Hub
        </button>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-7 sm:p-9">
          <div className="w-12 h-12 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
            <Home className="w-6 h-6" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-[#007F82]">
            ProInspect Tenant Portal
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
            Access your tenancy
          </h1>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Sign in using the email address linked to your tenancy. A secure one-time link will be sent to that address.
          </p>

          {linkSent && !needsCompletionEmail ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-emerald-900">Check your email</p>
                  <p className="text-sm text-emerald-800 mt-1">
                    Open the ProInspect sign-in link on this device to continue.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkSent(false)}
                className="mt-4 text-sm font-bold text-emerald-800 hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form
              onSubmit={needsCompletionEmail ? handleCompleteWithEmail : handleSendLink}
              className="mt-6 space-y-4"
            >
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tenant email address
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tenant@example.com"
                  className="mt-2 w-full h-12 rounded-lg border border-slate-300 px-4 text-sm outline-none focus:ring-2 focus:ring-[#00B5B8]/30 focus:border-[#00B5B8]"
                />
              </label>

              {authError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full h-12 rounded-lg bg-[#007F82] hover:bg-[#006D70] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {authBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {needsCompletionEmail ? 'Complete Sign In' : 'Email Secure Sign-In Link'}
              </button>
            </form>
          )}

          <p className="mt-5 text-xs text-slate-500 leading-relaxed">
            Access is only granted when the email address has been linked to an active tenancy by ProInspect.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !dashboard) {
    return (
      <div className="py-20 flex items-center justify-center gap-3 text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-[#007F82]" />
        Loading tenant portal…
      </div>
    );
  }

  if (portalError || !dashboard) {
    return (
      <div className="max-w-xl mx-auto py-10">
        <div className="rounded-2xl bg-white border border-slate-200 p-7 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="mt-4 text-xl font-extrabold text-[#1A2B4A]">Tenant portal access unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{portalError || 'Unable to load your tenancy.'}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-700"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-sm font-bold text-slate-700"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const primary = dashboard.tenancies[0] || dashboard.pastTenancies[0];
  const allTenancyViews = [...dashboard.tenancies, ...dashboard.pastTenancies];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="rounded-2xl bg-[#1A2B4A] text-white p-6 sm:p-7 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              Tenant Portal
            </p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold">
              Welcome, {dashboard.tenant.displayName}
            </h1>
            {primary && (
              <p className="mt-2 text-sm text-slate-300">
                {primary.property.unit ? `${primary.property.unit}, ` : ''}
                {primary.property.streetAddress}, {primary.property.suburb} {primary.property.state} {primary.property.postcode}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-bold"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          ['overview', 'Overview'],
          ['forms', 'Forms & Bond'],
          ['requests', 'Requests'],
          ['documents', 'Documents'],
          ['inspections', 'Inspections'],
          ['tenancy', 'My Tenancy'],
        ] as Array<[TenantTab, string]>).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
              activeTab === tab
                ? 'bg-[#007F82] text-white border-[#007F82]'
                : 'bg-white text-slate-600 border-slate-200 hover:border-[#00B5B8]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {dashboard.tenancies.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {REQUEST_OPTIONS.slice(0, 8).map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => beginRequest(option.type)}
                  className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-[#00B5B8] hover:shadow-sm transition-all"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#F0FBFB] text-[#007F82] flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="mt-3 font-extrabold text-sm text-[#1A2B4A]">{option.label}</div>
                  <div className="mt-1 text-xs text-slate-500 leading-relaxed">{option.description}</div>
                </button>
              );
            })}
          </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              Your active tenancy has ended. Historical documents and eligible post-tenancy bond workflows remain available, but new general tenancy requests are disabled.
            </div>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('forms')}
            className="w-full text-left rounded-xl border-2 border-[#00B5B8]/30 bg-[#F0FBFB] p-5 hover:border-[#00B5B8] transition-colors"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white text-[#007F82] flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="font-extrabold text-[#1A2B4A]">Forms, Pet / Modification & Bond Requests</div>
                <div className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Submit Form 24, Form 25, Form 26, Form 27, bond variation/release, PCR responses and private tenancy support through guided online workflows.
                </div>
              </div>
            </div>
          </button>

          {dashboard.notifications.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-extrabold text-[#1A2B4A] flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#007F82]" />
                  Notifications
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {dashboard.notifications.slice(0, 5).map((notification) => (
                  <div key={notification.id} className="px-5 py-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{notification.title}</div>
                      <div className="text-xs text-slate-500 mt-1">{notification.message}</div>
                    </div>
                    {!notification.readAt && (
                      <button
                        type="button"
                        onClick={async () => {
                          await markTenantNotificationRead(notification.id);
                          await loadDashboard();
                        }}
                        className="shrink-0 text-[10px] uppercase font-black text-[#006D70]"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-extrabold text-[#1A2B4A]">Recent activity</h2>
                <p className="text-xs text-slate-500 mt-0.5">Your latest requests and updates.</p>
              </div>
              <button type="button" onClick={() => setActiveTab('requests')} className="text-xs font-bold text-[#006D70]">
                View all
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {dashboard.requests.slice(0, 5).map((request) => (
                <div key={request.id} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{request.title}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {request.reference} · {formatDateTime(request.createdAt)}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase font-black px-2 py-1 rounded-full border whitespace-nowrap ${statusClass(request.status)}`}>
                    {request.status.replaceAll('_', ' ')}
                  </span>
                </div>
              ))}
              {dashboard.requests.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  No tenant requests have been submitted yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'forms' && (
        <TenantStatutoryForms
          tenancies={dashboard.tenancies}
          pastTenancies={dashboard.pastTenancies}
          documents={dashboard.documents}
        />
      )}

      {activeTab === 'requests' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-[#1A2B4A]">Requests</h2>
              <p className="text-sm text-slate-500">Track maintenance and tenancy requests.</p>
            </div>
            {dashboard.tenancies.length > 0 && (
              <button
                type="button"
                onClick={() => beginRequest('other')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold"
              >
                <Plus className="w-4 h-4" />
                New Request
              </button>
            )}
          </div>

          {dashboard.requests.map((request) => (
            <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-[#1A2B4A]">{request.title}</h3>
                    <span className={`text-[10px] uppercase font-black px-2 py-1 rounded-full border ${statusClass(request.status)}`}>
                      {request.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{request.reference} · {REQUEST_LABELS[request.requestType]}</p>
                </div>
                <span className="text-xs text-slate-400">{formatDateTime(request.createdAt)}</span>
              </div>
              <p className="mt-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{request.details}</p>
              {request.attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {request.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={async () => {
                        const url = await getTenantAttachmentDownloadUrl(request.id, attachment.id);
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {attachment.fileName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {dashboard.requests.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <ClipboardList className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="mt-3 text-sm font-bold text-slate-700">No requests yet</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">Documents</h2>
            <p className="text-sm text-slate-500">Documents made available for your tenancy.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {dashboard.documents.map((document) => (
              <div key={document.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-slate-900 truncate">{document.title}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {document.category.replaceAll('_', ' ')} · {formatDate(document.uploadedAt)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const url = await getTenantDocumentDownloadUrl(document.id);
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-[#006D70] hover:bg-[#F0FBFB]"
                >
                  Open
                </button>
              </div>
            ))}
            {dashboard.documents.length === 0 && (
              <div className="p-10 text-center text-sm text-slate-500">No documents have been added yet.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'inspections' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">Inspections & Access</h2>
            <p className="text-sm text-slate-500">Upcoming and previous property attendances.</p>
          </div>
          {dashboard.inspections.map((inspection) => (
            <div key={inspection.id} className="rounded-xl border border-slate-200 bg-white p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <div className="font-extrabold text-[#1A2B4A] capitalize">{inspection.type.replaceAll('_', ' ')} inspection</div>
                <div className="text-sm text-slate-600 mt-1">{formatDateTime(inspection.scheduledStart)}</div>
                {inspection.notes && <div className="text-xs text-slate-500 mt-2">{inspection.notes}</div>}
              </div>
            </div>
          ))}
          {dashboard.inspections.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              No inspections are currently listed.
            </div>
          )}
        </div>
      )}

      {activeTab === 'tenancy' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">My Tenancy</h2>
            <p className="text-sm text-slate-500">Properties and tenancy details linked to your account.</p>
          </div>
          {allTenancyViews.map(({ tenancy, property }) => (
            <div key={tenancy.id} className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-[#007F82] mt-0.5" />
                <div>
                  <h3 className="font-extrabold text-[#1A2B4A]">
                    {property.unit ? `${property.unit}, ` : ''}{property.streetAddress}
                  </h3>
                  <p className="text-sm text-slate-500">{property.suburb} {property.state} {property.postcode}</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">Status</dt>
                  <dd className="mt-1 font-bold capitalize text-slate-800">{tenancy.status}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">Start</dt>
                  <dd className="mt-1 font-bold text-slate-800">{formatDate(tenancy.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">End</dt>
                  <dd className="mt-1 font-bold text-slate-800">{formatDate(tenancy.endDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase text-slate-400">Bond Ref</dt>
                  <dd className="mt-1 font-bold text-slate-800">{tenancy.bondReference || '—'}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      {composerType && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 overflow-y-auto">
          <div className="max-w-2xl mx-auto my-6 rounded-2xl bg-white shadow-xl border border-slate-200">
            <form onSubmit={handleSubmitRequest}>
              <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-[#007F82]">Tenant Request</p>
                  <h2 className="mt-1 text-xl font-extrabold text-[#1A2B4A]">{REQUEST_LABELS[composerType]}</h2>
                </div>
                <button type="button" onClick={resetComposer} className="text-sm font-bold text-slate-500 hover:text-slate-800">
                  Close
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-5">
                {dashboard.tenancies.length > 1 && (
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-500">Property</span>
                    <select
                      value={composerTenancyId}
                      onChange={(event) => setComposerTenancyId(event.target.value)}
                      className="mt-2 w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
                    >
                      {dashboard.tenancies.map(({ tenancy, property }) => (
                        <option key={tenancy.id} value={tenancy.id}>
                          {property.unit ? `${property.unit}, ` : ''}{property.streetAddress}, {property.suburb}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {activeTenancy && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
                    <strong className="text-slate-800">Property:</strong>{' '}
                    {activeTenancy.property.unit ? `${activeTenancy.property.unit}, ` : ''}
                    {activeTenancy.property.streetAddress}, {activeTenancy.property.suburb}
                  </div>
                )}

                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Request title</span>
                  <input
                    required
                    minLength={3}
                    maxLength={160}
                    value={composerTitle}
                    onChange={(event) => setComposerTitle(event.target.value)}
                    className="mt-2 w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Details</span>
                  <textarea
                    required
                    minLength={5}
                    maxLength={5000}
                    rows={6}
                    value={composerDetails}
                    onChange={(event) => setComposerDetails(event.target.value)}
                    placeholder="Describe what you need ProInspect to know."
                    className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm resize-y"
                  />
                </label>

                {(composerType === 'maintenance' || composerType === 'emergency_maintenance') && (
                  <>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-slate-500">Priority</span>
                      <select
                        value={composerPriority}
                        onChange={(event) => setComposerPriority(event.target.value as TenantRequestPriority)}
                        className="mt-2 w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
                      >
                        <option value="normal">Normal</option>
                        <option value="urgent">Urgent</option>
                        <option value="emergency">Emergency</option>
                      </select>
                    </label>

                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-4">
                      <input
                        type="checkbox"
                        checked={composerAccess}
                        onChange={(event) => setComposerAccess(event.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-bold text-slate-800">Contractor access permission</span>
                        <span className="block text-xs text-slate-500 mt-1">
                          Record that ProInspect may coordinate access in accordance with applicable notice and tenancy requirements.
                        </span>
                      </span>
                    </label>

                    {composerAccess && (
                      <label className="block">
                        <span className="text-xs font-bold uppercase text-slate-500">Access notes</span>
                        <textarea
                          rows={3}
                          maxLength={1000}
                          value={composerAccessNotes}
                          onChange={(event) => setComposerAccessNotes(event.target.value)}
                          className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm"
                          placeholder="Pets, preferred times, gate instructions or other access notes."
                        />
                      </label>
                    )}
                  </>
                )}

                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Attachments</span>
                  <div className="mt-2 rounded-lg border border-dashed border-slate-300 p-4">
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime"
                      onChange={(event) => setComposerFiles(Array.from(event.target.files || []))}
                      className="block w-full text-sm text-slate-600"
                    />
                    <p className="text-xs text-slate-400 mt-2">Images, PDF or video. Maximum 20 MB per file.</p>
                  </div>
                </label>

                {composerError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {composerError}
                  </div>
                )}

                {composerSuccess && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    {composerSuccess}
                  </div>
                )}
              </div>

              <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button type="button" onClick={resetComposer} className="px-4 py-2.5 rounded-lg text-sm font-bold text-slate-600">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={composerBusy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] hover:bg-[#006D70] text-white text-sm font-bold disabled:opacity-60"
                >
                  {composerBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
