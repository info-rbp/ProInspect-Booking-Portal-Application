import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import type { UnifiedClientDashboard } from '../../types/platform';
import {
  createClientPropertySelf,
  createClientRequest,
  createClientTeamUser,
  fetchClientDashboard,
  getClientDocumentDownloadUrl,
  markClientNotificationRead,
  respondClientApproval,
} from '../../services/api';

type Tab =
  | 'overview'
  | 'properties'
  | 'bookings'
  | 'requests'
  | 'documents'
  | 'approvals'
  | 'payments'
  | 'account';

export const ClientPortal: React.FC<{
  user: User;
  onLogout: () => void;
}> = ({ user, onLogout }) => {
  const [data, setData] = useState<UnifiedClientDashboard | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<'maintenance' | 'general' | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [priority, setPriority] = useState<'routine' | 'priority' | 'urgent'>('routine');
  const [busy, setBusy] = useState(false);
  const [showProperty, setShowProperty] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [approvalComments, setApprovalComments] = useState<Record<string, string>>({});
  const [propertyForm, setPropertyForm] = useState({
    streetAddress: '',
    unit: '',
    suburb: '',
    state: 'WA',
    postcode: '',
    propertyType: 'House',
    clientReference: '',
  });
  const [teamForm, setTeamForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    role: 'member' as 'admin' | 'member' | 'viewer',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchClientDashboard();
      setData(next);
      setSelectedClientId((current) =>
        current && next.clients.some((client) => client.id === current)
          ? current
          : next.clients[0]?.id || ''
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client portal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user.uid]);

  const selectedClient = useMemo(
    () => data?.clients.find((client) => client.id === selectedClientId) || data?.clients[0],
    [data, selectedClientId]
  );
  const selectedMembership = useMemo(
    () =>
      data?.clientUser.memberships.find(
        (membership) => membership.clientId === selectedClient?.id
      ),
    [data, selectedClient?.id]
  );
  const selectedPropertyIds = useMemo(
    () =>
      new Set(
        data?.propertyLinks
          .filter(
            (link) =>
              link.active &&
              link.clientId === selectedClient?.id
          )
          .map((link) => link.propertyId) || []
      ),
    [data, selectedClient?.id]
  );
  const selectedProperties = useMemo(
    () => data?.properties.filter((property) => selectedPropertyIds.has(property.id)) || [],
    [data, selectedPropertyIds]
  );

  useEffect(() => {
    if (!selectedProperties.length) {
      setPropertyId('');
      return;
    }
    if (!selectedProperties.some((property) => property.id === propertyId)) {
      setPropertyId(selectedProperties[0].id);
    }
  }, [selectedClient?.id, selectedProperties, propertyId]);

  const selectedRequests =
    data?.requests.filter((request) => request.clientId === selectedClient?.id) || [];
  const selectedApprovals =
    data?.approvals.filter((approval) => approval.clientId === selectedClient?.id) || [];
  const selectedPayments =
    data?.payments.filter((payment) => payment.clientId === selectedClient?.id) || [];
  const selectedDocuments =
    data?.documents.filter((document) =>
      selectedClient ? document.clientIds.includes(selectedClient.id) : false
    ) || [];
  const selectedBookings =
    data?.bookings.filter((booking) =>
      booking.propertyId
        ? selectedPropertyIds.has(booking.propertyId)
        : (data.clients.length === 1)
    ) || [];
  const selectedNotifications =
    data?.notifications.filter(
      (notification) =>
        !notification.clientId || notification.clientId === selectedClient?.id
    ) || [];

  const canManageAccount = selectedMembership
    ? ['owner', 'admin'].includes(selectedMembership.role)
    : false;
  const canAddProperty = canManageAccount;
  const canCreateRequest = selectedMembership
    ? selectedMembership.role !== 'viewer'
    : false;
  const canRespondApprovals = canManageAccount;
  const unread = selectedNotifications.filter((notification) => !notification.readAt).length;

  const submit = async () => {
    if (
      !data ||
      !composer ||
      !selectedClient ||
      !canCreateRequest ||
      !title.trim() ||
      !details.trim()
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createClientRequest({
        clientId: selectedClient.id,
        propertyId: propertyId || undefined,
        type: composer,
        title,
        details,
        priority,
      });
      setComposer(null);
      setTitle('');
      setDetails('');
      setPriority('routine');
      await load();
      setTab('requests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit request.');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (
    approvalId: string,
    status: 'approved' | 'approved_with_conditions' | 'changes_requested' | 'declined'
  ) => {
    const comment = (approvalComments[approvalId] || '').trim();
    if (status === 'approved_with_conditions' && !comment) {
      setError('Describe the proposed conditions before approving with conditions.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await respondClientApproval(approvalId, {
        status,
        comment: comment || undefined,
      });
      setApprovalComments((current) => ({ ...current, [approvalId]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save approval response.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 flex justify-center items-center gap-2 text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading client portal…
      </div>
    );
  }

  if (!data || !selectedClient) {
    return (
      <div className="max-w-xl mx-auto py-10 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        {error || 'Client portal unavailable.'}
      </div>
    );
  }

  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['properties', 'Properties'],
    ['bookings', 'Bookings'],
    ['requests', 'Requests'],
    ['documents', 'Documents'],
    ['approvals', 'Approvals'],
    ['payments', 'Payments'],
    ['account', 'Account'],
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#1A2B4A] text-white p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase font-bold tracking-[0.18em] text-cyan-200">
            Client Portal
          </p>
          <h1 className="mt-2 text-2xl font-extrabold">{data.clientUser.displayName}</h1>
          {data.clients.length > 1 ? (
            <select
              value={selectedClient.id}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="mt-3 h-10 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-bold text-white"
            >
              {data.clients.map((client) => (
                <option key={client.id} value={client.id} className="text-slate-900">
                  {client.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 text-sm text-slate-300">{selectedClient.name}</p>
          )}
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-2 rounded-lg bg-white/10 text-xs font-bold flex items-center gap-2">
            <Bell className="w-4 h-4" />
            {unread} unread
          </div>
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-lg bg-white/10 text-xs font-bold flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm font-bold border ${
              tab === id
                ? 'bg-[#007F82] text-white border-[#007F82]'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Properties', selectedProperties.length, Building2],
              ['Bookings', selectedBookings.length, CalendarDays],
              [
                'Open requests',
                selectedRequests.filter(
                  (request) => !['completed', 'cancelled'].includes(request.status)
                ).length,
                Wrench,
              ],
              ['Documents', selectedDocuments.length, FileText],
            ].map(([label, value, Icon]: any) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <Icon className="w-5 h-5 text-[#007F82]" />
                <div className="mt-3 text-2xl font-black text-[#1A2B4A]">{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {canCreateRequest ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setComposer('maintenance');
                  setTitle('Maintenance request');
                }}
                className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#00B5B8]"
              >
                <Wrench className="w-5 h-5 text-[#007F82]" />
                <div className="mt-3 font-extrabold text-[#1A2B4A]">Request Maintenance</div>
                <div className="mt-1 text-xs text-slate-500">
                  Create a property maintenance request for ProInspect operations.
                </div>
              </button>
              <button
                onClick={() => {
                  setComposer('general');
                  setTitle('Property operations request');
                }}
                className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-[#00B5B8]"
              >
                <CheckCircle2 className="w-5 h-5 text-[#007F82]" />
                <div className="mt-3 font-extrabold text-[#1A2B4A]">Make a Request</div>
                <div className="mt-1 text-xs text-slate-500">
                  Send an instruction or operational request linked to a property.
                </div>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Your viewer role is read-only. Contact a client owner or administrator to submit instructions or approvals.
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex justify-between">
              <h2 className="font-extrabold text-[#1A2B4A]">Recent notifications</h2>
              <button onClick={() => void load()}>
                <RefreshCw className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {selectedNotifications.slice(0, 5).map((notification) => (
                <div key={notification.id} className="py-3 flex justify-between gap-3">
                  <div>
                    <div className="font-bold text-sm text-slate-800">{notification.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{notification.message}</div>
                  </div>
                  {!notification.readAt && (
                    <button
                      type="button"
                      onClick={async () => {
                        await markClientNotificationRead(notification.id);
                        await load();
                      }}
                      className="shrink-0 text-[10px] uppercase font-black text-[#006D70]"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
              {!selectedNotifications.length && (
                <div className="py-6 text-sm text-slate-500">No notifications.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-[#1A2B4A]">Properties</h2>
              <p className="text-sm text-slate-500">
                Canonical properties linked to {selectedClient.name}.
              </p>
            </div>
            {canAddProperty && (
              <button
                onClick={() => setShowProperty(true)}
                className="px-4 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold"
              >
                Add Property
              </button>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {selectedProperties.map((property) => (
              <div key={property.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <Building2 className="w-5 h-5 text-[#007F82]" />
                <h3 className="mt-3 font-extrabold text-[#1A2B4A]">
                  {property.unit ? `${property.unit}, ` : ''}
                  {property.streetAddress}
                </h3>
                <p className="text-sm text-slate-500">
                  {property.suburb} {property.state} {property.postcode}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {property.propertyType || 'Property'} · {property.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {selectedBookings.map((booking) => (
            <div key={booking.id} className="p-4 flex justify-between gap-4">
              <div>
                <div className="font-bold text-sm text-[#1A2B4A]">{booking.serviceName}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {booking.property.streetAddress}, {booking.property.suburb}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                {booking.appointment.dateString}
                <br />
                {booking.appointment.timeString}
              </div>
            </div>
          ))}
          {!selectedBookings.length && (
            <div className="p-8 text-sm text-center text-slate-500">No linked bookings yet.</div>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-3">
          {selectedRequests.map((request) => (
            <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex justify-between gap-3">
                <div>
                  <div className="font-bold text-[#1A2B4A]">{request.title}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {request.reference} · {request.type}
                  </div>
                </div>
                <span className="text-[10px] uppercase font-bold text-slate-600">
                  {request.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-700">{request.details}</p>
            </div>
          ))}
          {!selectedRequests.length && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No requests yet.
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {selectedDocuments.map((document) => (
            <div key={document.id} className="p-4 flex justify-between items-center gap-4">
              <div>
                <div className="font-bold text-sm text-slate-800">{document.title}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {document.category.replaceAll('_', ' ')}
                </div>
              </div>
              <button
                onClick={async () =>
                  window.open(
                    await getClientDocumentDownloadUrl(document.id),
                    '_blank',
                    'noopener,noreferrer'
                  )
                }
                className="text-xs font-bold text-[#006D70]"
              >
                Open
              </button>
            </div>
          ))}
          {!selectedDocuments.length && (
            <div className="p-8 text-center text-sm text-slate-500">
              No client-visible documents.
            </div>
          )}
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-3">
          {selectedApprovals.map((approval) => (
            <div key={approval.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="font-extrabold text-[#1A2B4A]">{approval.title}</div>
              <div className="text-xs text-slate-500 mt-1">
                {approval.reference} · {approval.status.replaceAll('_', ' ')}
              </div>
              {approval.summary && (
                <p className="mt-3 text-sm text-slate-700">{approval.summary}</p>
              )}
              {approval.amountExGst !== undefined && (
                <p className="mt-2 text-sm font-bold text-slate-800">
                  ${approval.amountExGst.toFixed(2)} + GST
                </p>
              )}
              {approval.responseComment && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  Response: {approval.responseComment}
                </div>
              )}
              {approval.status === 'pending' && canRespondApprovals && (
                <div className="mt-4 space-y-3">
                  <textarea
                    rows={3}
                    value={approvalComments[approval.id] || ''}
                    onChange={(event) =>
                      setApprovalComments((current) => ({
                        ...current,
                        [approval.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                    placeholder="Optional comments. Required when approving with conditions."
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void respond(approval.id, 'approved')}
                      className="px-3 py-2 rounded-lg bg-[#007F82] text-white text-xs font-bold disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void respond(approval.id, 'approved_with_conditions')}
                      className="px-3 py-2 rounded-lg border border-[#00B5B8] text-[#006D70] text-xs font-bold disabled:opacity-50"
                    >
                      Approve with conditions
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void respond(approval.id, 'changes_requested')}
                      className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold disabled:opacity-50"
                    >
                      Request changes
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void respond(approval.id, 'declined')}
                      className="px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold disabled:opacity-50"
                    >
                      Decline / refer for review
                    </button>
                  </div>
                </div>
              )}
              {approval.status === 'pending' && !canRespondApprovals && (
                <p className="mt-3 text-xs text-slate-500">
                  Only a client owner or administrator can respond to this approval.
                </p>
              )}
            </div>
          ))}
          {!selectedApprovals.length && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No approvals.
            </div>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {selectedPayments.map((payment) => (
            <div key={payment.id} className="p-4 flex justify-between items-center gap-4">
              <div>
                <div className="font-bold text-sm text-slate-800">{payment.description}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {payment.reference} · {payment.status.replaceAll('_', ' ')}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-[#1A2B4A]">
                  ${payment.totalAmount.toFixed(2)}
                </div>
                {payment.checkoutUrl && payment.status === 'payment_required' && (
                  <a href={payment.checkoutUrl} className="text-xs font-bold text-[#006D70]">
                    Pay now
                  </a>
                )}
              </div>
            </div>
          ))}
          {!selectedPayments.length && (
            <div className="p-8 text-center text-sm text-slate-500">No payments recorded.</div>
          )}
        </div>
      )}

      {tab === 'account' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-extrabold text-[#1A2B4A]">Client account</h2>
            <div className="mt-3 text-sm text-slate-700">{selectedClient.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              Your role: {selectedMembership?.role || 'member'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-[#1A2B4A]">Portal users</h3>
                <p className="text-xs text-slate-500 mt-1">
                  People with access to this client account.
                </p>
              </div>
              {canManageAccount && (
                <button
                  onClick={() => setShowTeam(true)}
                  className="px-3 py-2 rounded-lg bg-[#007F82] text-white text-xs font-bold"
                >
                  Add User
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {data.teamUsers
                .filter((member) => member.clientRoles[selectedClient.id])
                .map((member) => (
                  <div key={member.id} className="px-5 py-4 flex justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm text-slate-800">{member.displayName}</div>
                      <div className="text-xs text-slate-500">{member.email}</div>
                    </div>
                    <div className="text-xs font-bold text-slate-500">
                      {member.clientRoles[selectedClient.id]}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {showProperty && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 overflow-y-auto">
          <div className="max-w-xl mx-auto my-8 rounded-2xl bg-white p-6">
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">Add Property</h2>
            <p className="mt-1 text-xs text-slate-500">{selectedClient.name}</p>
            <div className="mt-5 grid sm:grid-cols-2 gap-3">
              <input className="sm:col-span-2 h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Street address" value={propertyForm.streetAddress} onChange={(event) => setPropertyForm({ ...propertyForm, streetAddress: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Unit / lot" value={propertyForm.unit} onChange={(event) => setPropertyForm({ ...propertyForm, unit: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Suburb" value={propertyForm.suburb} onChange={(event) => setPropertyForm({ ...propertyForm, suburb: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" value={propertyForm.state} onChange={(event) => setPropertyForm({ ...propertyForm, state: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Postcode" value={propertyForm.postcode} onChange={(event) => setPropertyForm({ ...propertyForm, postcode: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Property type" value={propertyForm.propertyType} onChange={(event) => setPropertyForm({ ...propertyForm, propertyType: event.target.value })} />
              <input className="h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Client reference" value={propertyForm.clientReference} onChange={(event) => setPropertyForm({ ...propertyForm, clientReference: event.target.value })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowProperty(false)} className="px-4 py-2 text-sm font-bold text-slate-600">
                Cancel
              </button>
              <button
                disabled={busy || !propertyForm.streetAddress || !propertyForm.suburb || !propertyForm.postcode}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await createClientPropertySelf({
                      clientId: selectedClient.id,
                      ...propertyForm,
                    });
                    setShowProperty(false);
                    setPropertyForm({
                      streetAddress: '',
                      unit: '',
                      suburb: '',
                      state: 'WA',
                      postcode: '',
                      propertyType: 'House',
                      clientReference: '',
                    });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Unable to add property.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50"
              >
                Add Property
              </button>
            </div>
          </div>
        </div>
      )}

      {showTeam && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 p-4">
          <div className="max-w-md mx-auto mt-20 rounded-2xl bg-white p-6">
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">Add Portal User</h2>
            <p className="mt-1 text-xs text-slate-500">{selectedClient.name}</p>
            <div className="mt-5 space-y-3">
              <input className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Name" value={teamForm.displayName} onChange={(event) => setTeamForm({ ...teamForm, displayName: event.target.value })} />
              <input type="email" className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Email" value={teamForm.email} onChange={(event) => setTeamForm({ ...teamForm, email: event.target.value })} />
              <input className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Phone" value={teamForm.phone} onChange={(event) => setTeamForm({ ...teamForm, phone: event.target.value })} />
              <select className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm" value={teamForm.role} onChange={(event) => setTeamForm({ ...teamForm, role: event.target.value as 'admin' | 'member' | 'viewer' })}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowTeam(false)} className="px-4 py-2 text-sm font-bold text-slate-600">
                Cancel
              </button>
              <button
                disabled={busy || !teamForm.displayName || !teamForm.email}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await createClientTeamUser({
                      clientId: selectedClient.id,
                      ...teamForm,
                    });
                    setShowTeam(false);
                    setTeamForm({
                      displayName: '',
                      email: '',
                      phone: '',
                      role: 'member',
                    });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Unable to add portal user.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50"
              >
                Add User
              </button>
            </div>
          </div>
        </div>
      )}

      {composer && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 p-4 overflow-y-auto">
          <div className="max-w-xl mx-auto my-8 rounded-2xl bg-white p-6">
            <h2 className="text-xl font-extrabold text-[#1A2B4A]">
              {composer === 'maintenance' ? 'Maintenance Request' : 'Property Operations Request'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{selectedClient.name}</p>
            <div className="mt-5 space-y-4">
              <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm">
                <option value="">No property selected</option>
                {selectedProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.streetAddress}, {property.suburb}
                  </option>
                ))}
              </select>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Request title" />
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={6} className="w-full rounded-lg border border-slate-300 p-3 text-sm" placeholder="Describe what you need." />
              <select value={priority} onChange={(event) => setPriority(event.target.value as 'routine' | 'priority' | 'urgent')} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm">
                <option value="routine">Routine</option>
                <option value="priority">Priority</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setComposer(null)} className="px-4 py-2 text-sm font-bold text-slate-600">
                Cancel
              </button>
              <button disabled={busy} onClick={() => void submit()} className="px-5 py-2 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50">
                {busy ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
