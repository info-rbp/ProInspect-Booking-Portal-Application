import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  FileText,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { ClientPortalDashboard } from '../../types/clientPortal';
import { fetchClientDashboard } from '../../services/api';

export type ClientPortalSection =
  | 'dashboard'
  | 'properties'
  | 'bookings'
  | 'requests'
  | 'documents';

interface ClientPortalProps {
  user: User;
  section: ClientPortalSection;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

const NAV_ITEMS: Array<{
  id: ClientPortalSection;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'properties', label: 'Properties', icon: Building2 },
  { id: 'bookings', label: 'Bookings', icon: CalendarDays },
  { id: 'requests', label: 'Requests', icon: Wrench },
  { id: 'documents', label: 'Documents', icon: FileText },
];

function routeFor(section: ClientPortalSection): string {
  return section === 'dashboard' ? '/portal' : `/portal/${section}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Perth',
  }).format(new Date(value));
}

export const ClientPortal: React.FC<ClientPortalProps> = ({
  user,
  section,
  onNavigate,
  onSignOut,
}) => {
  const [data, setData] = useState<ClientPortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <button
            type="button"
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 font-bold"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  const displayName =
    data.profile.displayName || user.displayName || data.profile.email;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 h-fit">
        <div className="px-2 pb-4 border-b border-slate-100">
          <p className="text-xs font-bold uppercase tracking-wider text-[#007F82]">
            Client Portal
          </p>
          <p className="mt-1 font-bold text-[#1A2B4A] truncate">{displayName}</p>
          <p className="text-xs text-slate-500 truncate">{data.profile.email}</p>
        </div>

        <nav className="mt-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
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
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 pt-4 border-t border-slate-100 w-full flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </aside>

      <section className="min-w-0">
        {section === 'dashboard' && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">
                ProInspect
              </p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
                Client Dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Your properties, ProInspect bookings and service activity in one place.
              </p>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                ['Properties', data.properties.length],
                ['Upcoming bookings', upcoming.length],
                ['Open requests', activeRequests.length],
                ['Documents', data.documents.length],
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
                  <button
                    type="button"
                    onClick={() => onNavigate('/book')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#006D70]"
                  >
                    <Plus className="w-4 h-4" /> Book service
                  </button>
                </div>

                <div className="mt-4 divide-y divide-slate-100">
                  {upcoming.slice(0, 5).map((booking) => (
                    <div key={booking.id} className="py-3">
                      <div className="font-semibold text-sm text-[#1A2B4A]">{booking.serviceName}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {booking.property.streetAddress}, {booking.property.suburb} · {booking.appointment.dateString} · {booking.appointment.timeString}
                      </div>
                    </div>
                  ))}
                  {upcoming.length === 0 && (
                    <p className="py-6 text-sm text-slate-500">No upcoming bookings.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="font-bold text-[#1A2B4A]">Quick actions</h2>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onNavigate('/book')}
                    className="rounded-xl border border-slate-200 p-4 text-left hover:border-[#00B5B8]"
                  >
                    <CalendarDays className="w-5 h-5 text-[#007F82]" />
                    <div className="mt-2 font-bold text-sm text-[#1A2B4A]">Book a Service</div>
                    <div className="text-xs text-slate-500 mt-1">Use the existing booking workflow.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/request-document')}
                    className="rounded-xl border border-slate-200 p-4 text-left hover:border-[#00B5B8]"
                  >
                    <FileText className="w-5 h-5 text-[#007F82]" />
                    <div className="mt-2 font-bold text-sm text-[#1A2B4A]">Request a Document</div>
                    <div className="text-xs text-slate-500 mt-1">Document workflow will connect here next.</div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'properties' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Properties</h1>
              <p className="mt-2 text-sm text-slate-600">
                Properties are linked from bookings made with your verified client email.
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {data.properties.map((property) => (
                <div key={property.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center shrink-0">
                      <Home className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-bold text-[#1A2B4A]">
                        {property.unit ? `${property.unit}, ` : ''}{property.streetAddress}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {property.suburb} {property.state} {property.postcode}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-[11px] font-semibold rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                          {property.propertyType}
                        </span>
                        {property.categories.map((category) => (
                          <span key={category} className="text-[11px] font-semibold rounded-full bg-[#F0FBFB] px-2 py-1 text-[#006D70]">
                            {category === 'strata-building' ? 'Strata / Building' : category.charAt(0).toUpperCase() + category.slice(1)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {data.properties.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  No properties are linked yet. A property will appear after a booking is made using this account's email address.
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'bookings' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Bookings</h1>
                <p className="mt-2 text-sm text-slate-600">Your ProInspect booking history.</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/book')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold hover:bg-[#006D70]"
              >
                <Plus className="w-4 h-4" /> Book a Service
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {data.bookings.map((booking) => (
                <div key={booking.id} className="p-4 sm:p-5 border-b last:border-b-0 border-slate-100">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[#1A2B4A]">{booking.serviceName}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        {booking.property.streetAddress}, {booking.property.suburb}
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <div className="text-sm font-semibold text-slate-700">{booking.appointment.dateString}</div>
                      <div className="text-xs text-slate-500">{booking.appointment.timeString} · {booking.bookingReference}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className="text-[11px] font-bold uppercase rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                      {booking.status}
                    </span>
                  </div>
                </div>
              ))}
              {data.bookings.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-500">No linked bookings yet.</div>
              )}
            </div>
          </div>
        )}

        {section === 'requests' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Requests</h1>
              <p className="mt-2 text-sm text-slate-600">
                This area is ready for maintenance, operational and document-request workflows.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              {data.requests.length > 0 ? (
                data.requests.map((request) => (
                  <div key={request.id} className="py-3 border-b last:border-b-0 border-slate-100">
                    <div className="font-semibold text-[#1A2B4A]">{request.title}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {request.status.replace('_', ' ')} · {formatDate(request.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">
                  No open requests. The detailed request workflows will be connected in a later stage.
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'documents' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">Documents</h1>
              <p className="mt-2 text-sm text-slate-600">
                Documents linked to your properties will appear here as the document workflow is introduced.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              {data.documents.length > 0 ? (
                data.documents.map((document) => (
                  <div key={document.id} className="py-3 border-b last:border-b-0 border-slate-100">
                    <div className="font-semibold text-[#1A2B4A]">{document.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {document.documentType} · {formatDate(document.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">
                  No documents are linked yet. This collection is ready for inspection reports, leases, notices and other client records.
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
