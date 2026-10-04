import React, { useState, useEffect } from 'react';
import { BookingRecord, BookingStatus, InspectionService, BusinessSettings, ServiceAdminInput } from '../../types/booking';
import {
  createAdminService,
  fetchAdminBookings,
  fetchAdminServices,
  fetchAdminSettings,
  reorderAdminServices,
  updateAdminBooking,
  updateAdminService,
  verifyAdminSession,
} from '../../services/api';
import { logoutAdmin } from '../../services/firebase';
import { AdminWorkOrderDetail } from './AdminWorkOrderDetail';
import { AdminServiceEditor } from './AdminServiceEditor';
import { AdminTenantPortal } from './AdminTenantPortal';
import { AdminClientArchitecture } from './AdminClientArchitecture';
import { AdminOperations } from './AdminOperations';
import { getPerthDateKey } from '../../utils/dateTime';
import {
  Calendar,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  LogOut,
  ChevronRight,
  Settings,
  Layers,
  CalendarCheck,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building,
  Plus,
  Pencil,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Power,
} from 'lucide-react';
import { User } from '../../services/session';

interface AdminDashboardProps {
  currentUser: User | null;
  onLogout: () => void;
  onBackToBooking: () => void;
  onServicesChanged?: (services: InspectionService[]) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onLogout,
  onBackToBooking,
  onServicesChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'bookings' | 'services' | 'operations' | 'tenants' | 'clients' | 'settings'>('bookings');
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [services, setServices] = useState<InspectionService[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');

  // Selected work order for modal
  const [selectedBooking, setSelectedBooking] = useState<BookingRecord | null>(null);

  // Service management
  const [isServiceEditorOpen, setIsServiceEditorOpen] = useState(false);
  const [editingService, setEditingService] = useState<InspectionService | null>(null);
  const [serviceActionId, setServiceActionId] = useState<string | null>(null);
  const [serviceActionError, setServiceActionError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const session = await verifyAdminSession();
      setPermissions(session.permissions);
      const can = (permission: string) => session.permissions.includes(permission as any);

      const [bkList, srvList, stData] = await Promise.all([
        can('bookings.read') ? fetchAdminBookings() : Promise.resolve([] as BookingRecord[]),
        can('services.read') ? fetchAdminServices() : Promise.resolve([] as InspectionService[]),
        can('settings.read') ? fetchAdminSettings() : Promise.resolve(null),
      ]);

      setBookings(bkList);
      setServices(srvList);
      onServicesChanged?.(
        srvList.filter((service) => service.active && service.publiclyBookable)
      );
      setSettings(stData);

      const allowedTabs: Array<typeof activeTab> = [
        ...(can('bookings.read') ? ['bookings' as const] : []),
        ...(can('maintenance.read') ? ['operations' as const] : []),
        ...(can('tenants.read') ? ['tenants' as const] : []),
        ...(can('clients.read') ? ['clients' as const] : []),
        ...(can('services.read') ? ['services' as const] : []),
        ...(can('settings.read') ? ['settings' as const] : []),
      ];
      if (!allowedTabs.includes(activeTab) && allowedTabs[0]) {
        setActiveTab(allowedTabs[0]);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const canAccess = (permission: string) =>
    permissions.includes('*') || permissions.includes(permission);

  const handleUpdateBookingStatus = async (id: string, status: BookingStatus, notes?: string) => {
    const updated = await updateAdminBooking(id, { status, adminNotes: notes });
    setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    if (selectedBooking && selectedBooking.id === id) {
      setSelectedBooking(updated);
    }
  };

  const applyServices = (nextServices: InspectionService[]) => {
    const ordered = [...nextServices].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    setServices(ordered);
    onServicesChanged?.(
      ordered.filter((service) => service.active && service.publiclyBookable)
    );
  };

  const handleSaveService = async (input: ServiceAdminInput) => {
    setServiceActionError(null);

    if (editingService) {
      const updated = await updateAdminService(editingService.id, input);
      applyServices(
        services.map((service) =>
          service.id === updated.id ? updated : service
        )
      );
      return;
    }

    const created = await createAdminService(input);
    applyServices([...services, created]);
  };

  const handleServicePatch = async (
    service: InspectionService,
    updates: Partial<ServiceAdminInput>
  ) => {
    setServiceActionId(service.id);
    setServiceActionError(null);

    try {
      const updated = await updateAdminService(service.id, updates);
      applyServices(
        services.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      setServiceActionError(
        error instanceof Error ? error.message : 'Unable to update service.'
      );
    } finally {
      setServiceActionId(null);
    }
  };

  const handleMoveService = async (
    serviceId: string,
    direction: -1 | 1
  ) => {
    const ordered = [...services].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    const currentIndex = ordered.findIndex((service) => service.id === serviceId);
    const nextIndex = currentIndex + direction;

    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= ordered.length
    ) {
      return;
    }

    const next = [...ordered];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];

    setServiceActionId(serviceId);
    setServiceActionError(null);

    try {
      const reordered = await reorderAdminServices(
        next.map((service) => service.id)
      );
      applyServices(reordered);
    } catch (error) {
      setServiceActionError(
        error instanceof Error ? error.message : 'Unable to reorder services.'
      );
    } finally {
      setServiceActionId(null);
    }
  };

  const orderedServices = [...services].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name)
  );

  // Metrics calculations
  const todayKey = getPerthDateKey(new Date());
  const tomorrowKey = getPerthDateKey(new Date(Date.now() + 24 * 60 * 60_000));

  const todaysBookings = bookings.filter(
    (b) => b.appointment.dateKey === todayKey && b.status !== 'cancelled'
  );
  const tomorrowsBookings = bookings.filter(
    (b) => b.appointment.dateKey === tomorrowKey && b.status !== 'cancelled'
  );
  const upcomingBookings = bookings.filter(
    (b) => b.appointment.dateKey >= todayKey && b.status === 'confirmed'
  );
  const cancelledBookings = bookings.filter((b) => b.status === 'cancelled');

  // Filtered Bookings Table
  const filteredBookings = bookings.filter((b) => {
    const matchesSearch =
      b.bookingReference.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.property.streetAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.property.suburb.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.property.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.property.clientName && b.property.clientName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    const matchesService = serviceFilter === 'all' || b.serviceId === serviceFilter;

    return matchesSearch && matchesStatus && matchesService;
  });

  return (
    <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto">
      {/* Top Admin Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1A2B4A] text-white flex items-center justify-center font-black">
            PI
          </div>
          <div>
            <h1 className="text-xl font-black text-[#1A2B4A] leading-tight">
              ProInspect Operational Portal
            </h1>
            <p className="text-xs text-slate-500">
              Logged in as: <span className="font-semibold text-slate-700">{currentUser?.email || 'Administrator'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={onBackToBooking}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            &larr; Public Hub
          </button>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Admin Nav Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
        {canAccess('bookings') && (
        <button
          onClick={() => setActiveTab('bookings')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'bookings'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Work Orders &amp; Bookings ({bookings.length})</span>
        </button>
        )}

        {canAccess('services') && (
        <button
          onClick={() => setActiveTab('services')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'services'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Booking Services ({services.length})</span>
        </button>
        )}

        {canAccess('tenants') && (
        <button
          onClick={() => setActiveTab('tenants')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'tenants'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Tenant Portal</span>
        </button>
        )}

        {canAccess('operations') && (
        <button
          onClick={() => setActiveTab('operations')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'operations'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Operations</span>
        </button>
        )}

        {canAccess('clients') && (
        <button
          onClick={() => setActiveTab('clients')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'clients'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Clients &amp; Properties</span>
        </button>
        )}

        {canAccess('settings') && (
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-[#007F82] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Calendar &amp; Hours</span>
        </button>
        )}
      </div>

      {/* TAB 1: WORK ORDERS & BOOKINGS */}
      {canAccess('bookings') && activeTab === 'bookings' && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                Today's Bookings
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-[#1A2B4A]">
                  {todaysBookings.length}
                </span>
                <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded">
                  AWST
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                Tomorrow's Bookings
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-[#1A2B4A]">
                  {tomorrowsBookings.length}
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  Upcoming
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                Confirmed Total
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-emerald-700">
                  {upcomingBookings.length}
                </span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  Active
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                Cancelled
              </span>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl sm:text-3xl font-black text-rose-600">
                  {cancelledBookings.length}
                </span>
                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                  Archived
                </span>
              </div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-center gap-3 justify-between">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search reference, address, customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-9 pr-3 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:bg-white focus:border-[#00B5B8]"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 px-3 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg outline-none text-slate-700"
              >
                <option value="all">All Statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="h-10 px-3 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg outline-none text-slate-700 max-w-[180px]"
              >
                <option value="all">All Services</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bookings Table */}
          <div className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1A2B4A] text-slate-200 uppercase tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Reference</th>
                    <th className="py-3 px-4">Date / Time</th>
                    <th className="py-3 px-4">Property</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Client / Contact</th>
                    <th className="py-3 px-4">Access</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No bookings matching the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredBookings.map((b) => (
                      <tr
                        key={b.id}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                        onClick={() => setSelectedBooking(b)}
                      >
                        <td className="py-3.5 px-4 font-mono font-bold text-[#1A2B4A]">
                          {b.bookingReference}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {b.appointment.timeString}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {b.appointment.dateString}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-[200px]">
                          <div className="font-medium text-slate-900 truncate">
                            {b.property.unit ? `${b.property.unit}, ` : ''}{b.property.streetAddress}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {b.property.suburb} {b.property.state} {b.property.postcode}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="font-semibold text-[#006D70]">{b.serviceName}</span>
                          <span className="text-[10px] text-slate-400 block">
                            {b.appointment.durationMinutes} mins
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900">
                            {b.property.customerName}
                          </div>
                          {b.property.clientName && (
                            <div className="text-[11px] text-slate-500 truncate max-w-[130px]">
                              {b.property.clientName}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap capitalize text-slate-700">
                          {b.access.method.replace('_', ' ')}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full ${
                              b.status === 'confirmed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : b.status === 'completed'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBooking(b);
                            }}
                            className="text-xs font-bold text-[#006D70] hover:underline"
                          >
                            View Order &rarr;
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BOOKING SERVICES */}
      {canAccess('services') && activeTab === 'services' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-base text-[#1A2B4A]">Booking Services</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Firestore is the source of truth. Active public services appear immediately in the booking hub.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingService(null);
                setServiceActionError(null);
                setIsServiceEditorOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#007F82] hover:bg-[#006D70] text-white text-sm font-bold shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Add Service</span>
            </button>
          </div>

          {serviceActionError && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700">
              {serviceActionError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orderedServices.map((srv, index) => {
              const isWorking = serviceActionId === srv.id;

              return (
                <div
                  key={srv.id}
                  className={`bg-white border rounded-xl p-5 shadow-xs space-y-4 ${
                    srv.active ? 'border-slate-200/90' : 'border-slate-200 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-base text-[#1A2B4A]">
                          {srv.name}
                        </h4>
                        {srv.badge && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-sky-50 text-[#006D70]">
                            {srv.badge}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(srv.categories || []).map((category) => (
                          <span
                            key={category}
                            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600"
                          >
                            {category === 'strata-building'
                              ? 'Strata / Building'
                              : category.charAt(0).toUpperCase() + category.slice(1)}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        {srv.publicDescription}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono mt-2">
                        {srv.id}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          srv.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {srv.active ? 'Active' : 'Inactive'}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          srv.publiclyBookable
                            ? 'bg-cyan-50 text-[#006D70]'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {srv.publiclyBookable ? 'Public' : 'Internal'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400 block">Duration</span>
                      <strong className="text-slate-800">{srv.duration}m</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Notice</span>
                      <strong className="text-slate-800">{srv.minimumNoticeHours}h</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Buffers</span>
                      <strong className="text-slate-800">
                        {srv.bufferBefore}/{srv.bufferAfter}m
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Horizon</span>
                      <strong className="text-slate-800">
                        {srv.maxFutureBookingDays}d
                      </strong>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isWorking || index === 0}
                      onClick={() => handleMoveService(srv.id, -1)}
                      className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-35"
                      title="Move service up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={isWorking || index === orderedServices.length - 1}
                      onClick={() => handleMoveService(srv.id, 1)}
                      className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-35"
                      title="Move service down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() =>
                        handleServicePatch(srv, {
                          publiclyBookable: !srv.publiclyBookable,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {srv.publiclyBookable ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {srv.publiclyBookable ? 'Make Internal' : 'Make Public'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() =>
                        handleServicePatch(srv, { active: !srv.active })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-bold disabled:opacity-50 ${
                        srv.active
                          ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{srv.active ? 'Deactivate' : 'Activate'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => {
                        setEditingService(srv);
                        setServiceActionError(null);
                        setIsServiceEditorOpen(true);
                      }}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#1A2B4A] disabled:opacity-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {orderedServices.length === 0 && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
              <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No services configured</p>
              <p className="text-xs text-slate-500 mt-1">
                Add the first bookable service to start building the catalogue.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TENANT PORTAL */}
      {canAccess('tenants') && activeTab === 'tenants' && <AdminTenantPortal />}

      {/* TAB 4: OPERATIONS */}
      {canAccess('operations') && activeTab === 'operations' && <AdminOperations />}

      {/* TAB 5: CLIENTS & PROPERTIES */}
      {canAccess('clients') && activeTab === 'clients' && <AdminClientArchitecture />}

      {/* TAB 5: CALENDAR & SETTINGS */}
      {canAccess('settings') && activeTab === 'settings' && (
        <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="font-bold text-base text-[#1A2B4A]">
              ProInspect calendar &amp; Operating Settings
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Scheduling engine parameters for Western Australia
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Timezone &amp; Locale
              </span>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-xs">
                <div>Timezone: <strong>Australia/Perth (AWST UTC+8)</strong></div>
                <div>Locale: <strong>en-AU</strong></div>
                <div>Date Format: <strong>Monday, 5 October 2026</strong></div>
                <div>Time Format: <strong>9:00 am</strong></div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                ProInspect calendar Engine
              </span>
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 space-y-1 text-xs text-emerald-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{settings?.calendarConnected ? 'ProInspect calendar integration configured' : 'ProInspect calendar configuration required'}</span>
                </div>
                <div>Availability is calculated server-side from ProInspect calendar and service rules.</div>
                <div>The server rechecks availability immediately before confirmation.</div>
              </div>
            </div>

            <div className="sm:col-span-2 space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Operating Hours
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {([
                  ['monday', 'Monday'],
                  ['tuesday', 'Tuesday'],
                  ['wednesday', 'Wednesday'],
                  ['thursday', 'Thursday'],
                  ['friday', 'Friday'],
                  ['saturday', 'Saturday'],
                  ['sunday', 'Sunday'],
                ] as const).map(([dayKey, label]) => {
                  const day = settings?.operatingHours[dayKey];
                  return (
                    <div key={dayKey} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="font-bold text-[#1A2B4A] block">{label}</span>
                      <span className={day?.active ? 'text-slate-600' : 'text-slate-400'}>
                        {day?.active ? `${day.open} - ${day.close}` : 'Unavailable / Off'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {isServiceEditorOpen && (
        <AdminServiceEditor
          service={editingService}
          suggestedOrder={
            orderedServices.reduce(
              (highest, service) => Math.max(highest, service.order || 0),
              0
            ) + 1
          }
          onClose={() => {
            setIsServiceEditorOpen(false);
            setEditingService(null);
          }}
          onSave={handleSaveService}
        />
      )}

      {/* Work Order Detail Modal */}
      {selectedBooking && (
        <AdminWorkOrderDetail
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onUpdateStatus={handleUpdateBookingStatus}
        />
      )}
    </div>
  );
};
