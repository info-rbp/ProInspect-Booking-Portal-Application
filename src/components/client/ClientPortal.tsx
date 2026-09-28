import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  FileCheck2,
  FileText,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Users,
  Wrench,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  ClientApproval,
  ClientPortalDashboard,
  ClientProperty,
} from '../../types/clientPortal';
import {
  claimClientBooking,
  downloadClientDocument,
  fetchClientDashboard,
  generateClientDocumentDraft,
  respondClientApproval,
} from '../../services/api';
import {
  AddPropertyForm,
  ClientOnboardingWizard,
  EditPropertyForm,
  DocumentRequestForm,
  MaintenanceRequestForm,
} from './ClientForms';
import { ClientAccount } from './ClientAccount';

export type ClientPortalSection =
  | 'dashboard'
  | 'properties'
  | 'property'
  | 'bookings'
  | 'requests'
  | 'documents'
  | 'approvals'
  | 'account'
  | 'onboarding'
  | 'maintenance-request'
  | 'document-request';

interface ClientPortalProps {
  user: User;
  section: ClientPortalSection;
  propertyId?: string;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  onBookProperty?: (property: ClientProperty) => void;
}

const NAV_ITEMS: Array<{
  id: Exclude<ClientPortalSection, 'property' | 'onboarding' | 'maintenance-request' | 'document-request'>;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'properties', label: 'Properties', icon: Building2 },
  { id: 'bookings', label: 'Bookings', icon: CalendarDays },
  { id: 'requests', label: 'Requests', icon: Wrench },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'approvals', label: 'Approvals', icon: FileCheck2 },
  { id: 'account', label: 'Account', icon: Users },
];

function routeFor(section: ClientPortalSection): string {
  if (section === 'dashboard') return '/portal';
  if (section === 'maintenance-request') return '/portal/requests/maintenance';
  if (section === 'document-request') return '/portal/requests/document';
  return `/portal/${section}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  }).format(new Date(value));
}

function propertyLabel(property: ClientProperty): string {
  return [
    property.nickname || (property.unit ? `${property.unit}, ${property.streetAddress}` : property.streetAddress),
    property.nickname ? `${property.streetAddress}, ${property.suburb}` : property.suburb,
  ].join(' · ');
}

export const ClientPortal: React.FC<ClientPortalProps> = ({
  user,
  section,
  propertyId,
  onNavigate,
  onSignOut,
  onBookProperty,
}) => {
  const [data, setData] = useState<ClientPortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [editingProperty, setEditingProperty] = useState(false);
  const [bookingClaimToken, setBookingClaimToken] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [approvalComments, setApprovalComments] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchClientDashboard());
    } catch (err: any) {
      setError(err?.message || 'The client portal could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.uid]);

  const upcoming = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    return data.bookings
      .filter(
        (booking) =>
          booking.status === 'confirmed' &&
          new Date(booking.appointment.start).getTime() >= now
      )
      .sort(
        (a, b) =>
          new Date(a.appointment.start).getTime() -
          new Date(b.appointment.start).getTime()
      );
  }, [data]);

  const activeRequests = useMemo(
    () =>
      data?.requests.filter(
        (request) =>
          request.status !== 'completed' && request.status !== 'cancelled'
      ) || [],
    [data]
  );

  const pendingApprovals = useMemo(
    () => data?.approvals.filter((approval) => approval.status === 'pending') || [],
    [data]
  );

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading your client portal…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto py-12">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          {error || 'The client portal is unavailable.'}
          <button type="button" onClick={load} className="mt-4 inline-flex items-center gap-2 font-bold">
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (section === 'onboarding') {
    return (
      <ClientOnboardingWizard
        dashboard={data}
        onComplete={async () => {
          await load();
          onNavigate('/portal');
        }}
        onCancel={() => onNavigate('/portal')}
      />
    );
  }

  if (section === 'document-request') {
    return (
      <DocumentRequestForm
        dashboard={data}
        initialPropertyId={new URLSearchParams(window.location.search).get('propertyId') || undefined}
        onSubmitted={async () => {
          await load();
          onNavigate('/portal/requests');
        }}
        onCancel={() => onNavigate('/portal/requests')}
      />
    );
  }

  if (section === 'maintenance-request') {
    return (
      <MaintenanceRequestForm
        dashboard={data}
        initialPropertyId={new URLSearchParams(window.location.search).get('propertyId') || undefined}
        onSubmitted={async () => {
          await load();
          onNavigate('/portal/requests');
        }}
        onCancel={() => onNavigate('/portal/requests')}
      />
    );
  }

  const displayName = data.profile.displayName || user.displayName || data.profile.email;
  const selectedProperty =
    section === 'property'
      ? data.properties.find((property) => property.id === propertyId)
      : undefined;

  const download = async (documentId: string) => {
    setActionId(documentId);
    try {
      const { blob, fileName } = await downloadClientDocument(documentId);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Unable to download document.');
    } finally {
      setActionId(null);
    }
  };

  const generateDraft = async (requestId: string) => {
    setActionId(requestId);
    try {
      await generateClientDocumentDraft(requestId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to generate draft.');
    } finally {
      setActionId(null);
    }
  };

  const respondApproval = async (
    approval: ClientApproval,
    status: 'approved' | 'changes_requested' | 'declined'
  ) => {
    setActionId(approval.id);
    try {
      await respondClientApproval(approval.id, {
        status,
        comment: approvalComments[approval.id] || undefined,
      });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to save approval response.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 h-fit">
        <div className="px-2 pb-4 border-b border-slate-100">
          <p className="text-xs font-bold uppercase tracking-wider text-[#007F82]">Client Portal</p>
          <p className="mt-1 font-bold text-[#1A2B4A] truncate">{displayName}</p>
          <p className="text-xs text-slate-500 truncate">{data.organisation.name}</p>
          <p className="mt-1 text-[11px] text-slate-400 capitalize">{data.membership.role}</p>
        </div>

        <nav className="mt-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.id === section ||
              (item.id === 'properties' && section === 'property');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(routeFor(item.id))}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-[#F0FBFB] text-[#006D70]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-[#1A2B4A]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
                {item.id === 'approvals' && pendingApprovals.length > 0 && (
                  <span className="ml-auto text-[10px] font-black rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                    {pendingApprovals.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 pt-4 border-t border-slate-100 w-full flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </aside>

      <section className="min-w-0">
        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {section === 'dashboard' && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">ProInspect</p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Client Dashboard</h1>
              <p className="mt-2 text-sm text-slate-600">Your properties, bookings, requests, documents and approvals in one place.</p>
            </div>

            {data.profile.onboardingStatus !== 'complete' &&
              ['owner', 'admin'].includes(data.membership.role) && (
              <div className="rounded-2xl border border-[#00B5B8]/40 bg-[#F0FBFB] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-[#1A2B4A]">Complete your client onboarding</div>
                  <div className="text-sm text-slate-600 mt-1">Confirm your organisation details and add your first property so the portal can be used as your ongoing property workspace.</div>
                </div>
                <button type="button" onClick={() => onNavigate('/portal/onboarding')} className="shrink-0 px-4 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold">Continue Onboarding</button>
              </div>
            )}

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                ['Properties', data.properties.length],
                ['Upcoming bookings', upcoming.length],
                ['Open requests', activeRequests.length],
                ['Pending approvals', pendingApprovals.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-2xl font-extrabold text-[#1A2B4A]">{value}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-[#1A2B4A]">Upcoming bookings</h2>
                    <p className="text-xs text-slate-500 mt-1">Confirmed ProInspect attendances.</p>
                  </div>
                  <button type="button" onClick={() => onNavigate('/book')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#006D70]"><Plus className="w-4 h-4" /> Book service</button>
                </div>
                <div className="mt-4 divide-y divide-slate-100">
                  {upcoming.slice(0, 5).map((booking) => (
                    <div key={booking.id} className="py-3">
                      <div className="font-semibold text-sm text-[#1A2B4A]">{booking.serviceName}</div>
                      <div className="text-xs text-slate-500 mt-1">{booking.property.streetAddress}, {booking.property.suburb} · {booking.appointment.dateString} · {booking.appointment.timeString}</div>
                    </div>
                  ))}
                  {upcoming.length === 0 && <p className="py-6 text-sm text-slate-500">No upcoming bookings.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="font-bold text-[#1A2B4A]">Quick actions</h2>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    ['/book', CalendarDays, 'Book a Service', 'Use the current ProInspect scheduling workflow.'],
                    ['/portal/requests/document', FileText, 'Request a Document', 'Submit detailed instructions, files and prepare a review summary.'],
                    ['/portal/requests/maintenance', Wrench, 'Maintenance Request', 'Create a trackable property maintenance request.'],
                    ['/portal/properties', Home, 'Manage Properties', 'Add and review saved client properties.'],
                  ].map(([path, Icon, title, copy]) => {
                    const IconComponent = Icon as React.ElementType;
                    return (
                      <button key={String(path)} type="button" onClick={() => onNavigate(String(path))} className="rounded-xl border border-slate-200 p-4 text-left hover:border-[#00B5B8]">
                        <IconComponent className="w-5 h-5 text-[#007F82]" />
                        <div className="mt-2 font-bold text-sm text-[#1A2B4A]">{String(title)}</div>
                        <div className="text-xs text-slate-500 mt-1">{String(copy)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'properties' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Properties</h1>
                <p className="mt-2 text-sm text-slate-600">Saved properties connect bookings, requests and documents.</p>
              </div>
              {data.membership.role !== 'viewer' && (
                <button type="button" onClick={() => setAddingProperty(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Add Property</button>
              )}
            </div>

            {addingProperty && (
              <AddPropertyForm
                onCreated={async () => {
                  setAddingProperty(false);
                  await load();
                }}
                onCancel={() => setAddingProperty(false)}
              />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {data.properties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => onNavigate(`/portal/properties/${encodeURIComponent(property.id)}`)}
                  className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-[#00B5B8] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0"><Home className="w-5 h-5" /></div>
                    <div className="min-w-0">
                      <h2 className="font-bold text-[#1A2B4A]">{propertyLabel(property)}</h2>
                      <p className="text-sm text-slate-500">{property.state} {property.postcode}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-[11px] font-semibold rounded-full bg-slate-100 px-2 py-1 text-slate-600">{property.propertyType}</span>
                        {property.categories.map((category) => (
                          <span key={category} className="text-[11px] font-semibold rounded-full bg-[#F0FBFB] px-2 py-1 text-[#006D70]">{category === 'strata-building' ? 'Strata / Building' : category.charAt(0).toUpperCase() + category.slice(1)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {data.properties.length === 0 && !addingProperty && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No properties are linked yet. Add one manually or complete a booking using this client account.</div>
              )}
            </div>
          </div>
        )}

        {section === 'property' && (
          selectedProperty ? (
            <div className="space-y-6">
              <button type="button" onClick={() => onNavigate('/portal/properties')} className="text-sm font-semibold text-[#006D70]">← All properties</button>
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#007F82]">Property Workspace</p>
                    <h1 className="mt-2 text-2xl font-extrabold text-[#1A2B4A]">{selectedProperty.nickname || (selectedProperty.unit ? `${selectedProperty.unit}, ${selectedProperty.streetAddress}` : selectedProperty.streetAddress)}</h1>
                    <p className="mt-1 text-sm text-slate-500">{selectedProperty.streetAddress}, {selectedProperty.suburb} {selectedProperty.state} {selectedProperty.postcode}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onBookProperty ? onBookProperty(selectedProperty) : onNavigate('/book')} className="px-3 py-2 rounded-lg bg-[#007F82] text-white text-xs font-bold">Book Service</button>
                    <button type="button" onClick={() => onNavigate(`/portal/requests/maintenance?propertyId=${encodeURIComponent(selectedProperty.id)}`)} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700">Maintenance</button>
                    <button type="button" onClick={() => onNavigate(`/portal/requests/document?propertyId=${encodeURIComponent(selectedProperty.id)}`)} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700">Request Document</button>
                    {data.membership.role !== 'viewer' && (
                      <button type="button" onClick={() => setEditingProperty((current) => !current)} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700">
                        {editingProperty ? 'Close Edit' : 'Edit Property'}
                      </button>
                    )}
                  </div>
                </div>
                {selectedProperty.notes && <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{selectedProperty.notes}</div>}
              </div>

              {editingProperty && data.membership.role !== 'viewer' && (
                <EditPropertyForm
                  property={selectedProperty}
                  onSaved={async () => {
                    setEditingProperty(false);
                    await load();
                  }}
                  onArchived={async () => {
                    setEditingProperty(false);
                    await load();
                    onNavigate('/portal/properties');
                  }}
                  onCancel={() => setEditingProperty(false)}
                />
              )}

              {[
                ['Bookings', data.bookings.filter((item) => item.propertyId === selectedProperty.id), (item: any) => `${item.serviceName} · ${item.appointment.dateString} ${item.appointment.timeString}`],
                ['Requests', data.requests.filter((item) => item.propertyId === selectedProperty.id), (item: any) => `${item.title} · ${item.status.replace('_', ' ')}`],
                ['Documents', data.documents.filter((item) => item.propertyId === selectedProperty.id), (item: any) => `${item.name} · ${item.status}`],
              ].map(([title, items, format]) => (
                <div key={String(title)} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h2 className="font-bold text-[#1A2B4A]">{String(title)}</h2>
                  <div className="mt-3 divide-y divide-slate-100">
                    {(items as any[]).slice(0, 8).map((item) => <div key={item.id} className="py-3 text-sm text-slate-600">{(format as (item:any)=>string)(item)}</div>)}
                    {(items as any[]).length === 0 && <div className="py-4 text-sm text-slate-500">No {String(title).toLowerCase()} linked yet.</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Property not found.</div>
          )
        )}

        {section === 'bookings' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div><h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Bookings</h1><p className="mt-2 text-sm text-slate-600">Your ProInspect booking history.</p></div>
              <button type="button" onClick={() => onNavigate('/book')} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Book a Service</button>
            </div>
            {['owner', 'admin'].includes(data.membership.role) && (
              <form className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" onSubmit={async event => {
                event.preventDefault(); setActionId('booking-claim'); setError(null);
                try { await claimClientBooking(bookingClaimToken.trim()); setBookingClaimToken(''); await load(); }
                catch (err: any) { setError(err?.message || 'Unable to link booking.'); }
                finally { setActionId(null); }
              }}>
                <label htmlFor="booking-claim" className="block font-semibold text-sm">Link an existing booking</label>
                <p className="text-sm text-slate-600">Use the secure management code from a booking made with your verified email. This will share the booking with this organisation.</p>
                <input id="booking-claim" type="password" autoComplete="off" required minLength={20} maxLength={200} value={bookingClaimToken} onChange={event => setBookingClaimToken(event.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                <button type="submit" disabled={actionId === 'booking-claim'} className="rounded-lg bg-[#007F82] text-white px-4 py-2 disabled:opacity-50">{actionId === 'booking-claim' ? 'Linking...' : 'Link Booking'}</button>
              </form>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {data.bookings.map((booking) => (
                <div key={booking.id} className="p-4 sm:p-5 border-b last:border-b-0 border-slate-100">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div><div className="font-bold text-[#1A2B4A]">{booking.serviceName}</div><div className="text-xs text-slate-500 mt-1">{booking.property.streetAddress}, {booking.property.suburb}</div></div>
                    <div className="sm:text-right"><div className="text-sm font-semibold text-slate-700">{booking.appointment.dateString}</div><div className="text-xs text-slate-500">{booking.appointment.timeString} · {booking.bookingReference}</div></div>
                  </div>
                  <div className="mt-3"><span className="text-[11px] font-bold uppercase rounded-full bg-slate-100 px-2 py-1 text-slate-600">{booking.status}</span></div>
                </div>
              ))}
              {data.bookings.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No linked bookings yet.</div>}
            </div>
          </div>
        )}

        {section === 'requests' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div><h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Requests</h1><p className="mt-2 text-sm text-slate-600">Maintenance, document and general property requests.</p></div>
              {data.membership.role !== 'viewer' && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => onNavigate('/portal/requests/maintenance')} className="px-3 py-2.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700">Maintenance</button>
                  <button type="button" onClick={() => onNavigate('/portal/requests/document')} className="px-3 py-2.5 rounded-lg bg-[#007F82] text-white text-xs font-bold">Document Request</button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {data.requests.map((request) => (
                <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2"><span className="text-[10px] font-black uppercase rounded bg-slate-100 px-2 py-1 text-slate-600">{request.type}</span><span className="text-[10px] font-black uppercase rounded bg-[#F0FBFB] px-2 py-1 text-[#006D70]">{request.status.replace('_', ' ')}</span></div>
                      <div className="mt-2 font-bold text-[#1A2B4A]">{request.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(request.createdAt)}</div>
                    </div>
                    {request.type === 'document' &&
                      typeof request.details?.documentType === 'string' &&
                      !request.generatedDocumentId &&
                      data.membership.role !== 'viewer' && (
                      <button type="button" disabled={actionId === request.id} onClick={() => generateDraft(request.id)} className="text-xs font-bold text-[#006D70]">{actionId === request.id ? 'Generating…' : 'Generate Preparation Summary'}</button>
                    )}
                  </div>
                </div>
              ))}
              {data.requests.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No requests yet.</div>}
            </div>
          </div>
        )}

        {section === 'documents' && (
          <div className="space-y-5">
            <div><h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Documents</h1><p className="mt-2 text-sm text-slate-600">Uploaded files, generated drafts and client documents.</p></div>
            <div className="space-y-3">
              {data.documents.map((document) => (
                <div key={document.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div><div className="font-bold text-[#1A2B4A]">{document.name}</div><div className="text-xs text-slate-500 mt-1">{document.documentType} · {document.status} · {formatDate(document.createdAt)}</div></div>
                  <button type="button" disabled={actionId === document.id} onClick={() => download(document.id)} className="text-xs font-bold text-[#006D70]">{actionId === document.id ? 'Preparing…' : 'Download'}</button>
                </div>
              ))}
              {data.documents.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No documents are linked yet.</div>}
            </div>
          </div>
        )}

        {section === 'approvals' && (
          <div className="space-y-5">
            <div><h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Approvals</h1><p className="mt-2 text-sm text-slate-600">Review draft documents and other client decisions requiring a recorded response.</p></div>
            <div className="space-y-3">
              {data.approvals.map((approval) => (
                <div key={approval.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="font-bold text-[#1A2B4A]">{approval.title}</div><div className="mt-1 text-sm text-slate-500">{approval.summary}</div></div>
                    <span className={`text-[10px] font-black uppercase rounded-full px-2 py-1 ${approval.status === 'pending' ? 'bg-amber-100 text-amber-800' : approval.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{approval.status.replace('_', ' ')}</span>
                  </div>
                  {approval.documentId && <button type="button" onClick={() => download(approval.documentId!)} className="mt-3 text-xs font-bold text-[#006D70]">Download document for review</button>}
                  {approval.status === 'pending' && data.membership.role !== 'viewer' && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <textarea rows={2} value={approvalComments[approval.id] || ''} onChange={(e) => setApprovalComments({ ...approvalComments, [approval.id]: e.target.value })} placeholder="Optional comment or requested changes" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-[#00B5B8]" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={actionId === approval.id} onClick={() => respondApproval(approval, 'approved')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold"><CheckCircle2 className="w-4 h-4" /> Approve</button>
                        <button type="button" disabled={actionId === approval.id} onClick={() => respondApproval(approval, 'changes_requested')} className="px-3 py-2 rounded-lg border border-amber-300 text-amber-800 text-xs font-bold">Request Changes</button>
                        <button type="button" disabled={actionId === approval.id} onClick={() => respondApproval(approval, 'declined')} className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-bold">Decline</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {data.approvals.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No approvals are waiting or recorded yet.</div>}
            </div>
          </div>
        )}

        {section === 'account' && <ClientAccount dashboard={data} onRefresh={load} />}
      </section>
    </div>
  );
};
