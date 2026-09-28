import React, { useState, useEffect } from 'react';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { WizardProgress, WizardStepId } from './components/wizard/WizardProgress';
import { Step0ServiceType } from './components/wizard/Step0ServiceType';
import { Step1Service } from './components/wizard/Step1Service';
import { Step2Property } from './components/wizard/Step2Property';
import { Step3Access } from './components/wizard/Step3Access';
import { Step4Appointment } from './components/wizard/Step4Appointment';
import { Step5Review } from './components/wizard/Step5Review';
import { StepConfirmation } from './components/wizard/StepConfirmation';
import { AdminPortal } from './components/admin/AdminPortal';
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { PublicBookingManageModal } from './components/manage/PublicBookingManageModal';
import { ClientHub } from './components/hub/ClientHub';
import { PlaceholderPage } from './components/hub/PlaceholderPage';
import { DocumentRequestFlow } from './components/documents/DocumentRequestFlow';
import {
  InspectionService,
  ServiceCategory,
  PropertyDetails,
  AccessDetails,
  AppointmentSlot,
  PublicBookingSummary,
} from './types/booking';
import { fetchServices, submitBooking, verifyAdminSession } from './services/api';
import { initAuthListener, logoutAdmin } from './services/firebase';
import { User } from 'firebase/auth';
import { Search } from 'lucide-react';

type PublicRoute = 'hub' | 'book' | 'request-document' | 'signin';
type PublicPath = '/' | '/book' | '/request-document' | '/signin';

function manageTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/manage\/(pi_[A-Za-z0-9_-]{24,})\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function publicRouteFromPath(): PublicRoute {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

  if (pathname.startsWith('/manage/')) return 'book';
  if (pathname === '/book') return 'book';
  if (pathname === '/request-document') return 'request-document';
  if (pathname === '/signin') return 'signin';
  return 'hub';
}

export default function App() {
  // Navigation / View State
  const [activeView, setActiveView] = useState<'booking' | 'admin'>('booking');
  const [publicRoute, setPublicRoute] = useState<PublicRoute>(() => publicRouteFromPath());
  const [currentStep, setCurrentStep] = useState<WizardStepId>('service-type');
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([]);

  // Services list
  const [services, setServices] = useState<InspectionService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  // Booking Form State
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [propertyData, setPropertyData] = useState<PropertyDetails>({
    streetAddress: '',
    unit: '',
    suburb: '',
    state: 'WA',
    postcode: '',
    propertyType: 'House',
    clientName: '',
    clientReference: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
  });

  const [accessData, setAccessData] = useState<AccessDetails>({
    method: 'tenant',
    tenant: {
      tenantName: '',
      tenantPhone: '',
      noticeIssued: 'yes',
    },
  });

  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlot | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<PublicBookingSummary | null>(null);

  // Submission & Conflict State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Admin & Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [directManageToken, setDirectManageToken] = useState<string | null>(
    () => manageTokenFromPath()
  );
  const [isManageModalOpen, setIsManageModalOpen] = useState(
    () => Boolean(manageTokenFromPath())
  );

  const navigatePublic = (path: PublicPath, replace = false) => {
    if (replace) {
      window.history.replaceState({}, '', path);
    } else if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }

    setActiveView('booking');
    setDirectManageToken(null);
    setIsManageModalOpen(false);
    setPublicRoute(publicRouteFromPath());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handlePopState = () => {
      const token = manageTokenFromPath();
      setActiveView('booking');
      setPublicRoute(publicRouteFromPath());
      setDirectManageToken(token);
      setIsManageModalOpen(Boolean(token));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load initial services on mount
  useEffect(() => {
    async function load() {
      setIsLoadingServices(true);
      try {
        const srvs = await fetchServices();
        setServices(srvs);
        // Service selection happens only after the customer selects a property category.
        if (selectedCategory) {
          const firstMatch = srvs.find((service) =>
            service.categories.includes(selectedCategory)
          );
          if (firstMatch && !selectedServiceId) {
            setSelectedServiceId(firstMatch.id);
          }
        }
      } catch (err) {
        console.error('Failed to load services:', err);
      } finally {
        setIsLoadingServices(false);
      }
    }
    load();
  }, []);

  // Listen to Firebase Auth state for Admin
  useEffect(() => {
    const unsubscribe = initAuthListener(
      (user) => {
        verifyAdminSession()
          .then(() => setCurrentUser(user))
          .catch(async () => {
            setCurrentUser(null);
            await logoutAdmin();
          });
      },
      () => {
        setCurrentUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Step transition helpers
  const markStepCompleted = (step: WizardStepId) => {
    setCompletedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
  };

  const filteredServices = selectedCategory
    ? services.filter((service) => service.categories.includes(selectedCategory))
    : [];

  const handleSelectCategory = (category: ServiceCategory) => {
    if (category !== selectedCategory) {
      setSelectedCategory(category);
      setSelectedServiceId(null);
      setSelectedSlot(null);
      setConflictError(null);
      setCompletedSteps((prev) =>
        prev.filter((step) => !['service', 'property', 'access', 'appointment', 'confirm'].includes(step))
      );
    }
  };

  const handleServiceTypeNext = () => {
    if (!selectedCategory) return;
    markStepCompleted('service-type');
    setCurrentStep('service');
  };

  const handleSelectService = (service: InspectionService) => {
    if (service.id !== selectedServiceId) {
      setSelectedSlot(null);
      setConflictError(null);
    }
    setSelectedServiceId(service.id);
  };

  const handleStep1Next = () => {
    markStepCompleted('service');
    setCurrentStep('property');
  };

  const handleStep2Next = () => {
    markStepCompleted('property');
    setCurrentStep('access');
  };

  const handleStep3Next = () => {
    markStepCompleted('access');
    setCurrentStep('appointment');
  };

  const handleStep4Next = () => {
    markStepCompleted('appointment');
    setCurrentStep('confirm');
  };

  const handleJumpToStep = (step: WizardStepId) => {
    setConflictError(null);
    setCurrentStep(step);
  };

  // Confirm and Submit Booking with Server-side Availability Conflict Recheck
  const handleConfirmBooking = async () => {
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (!selectedService || !selectedCategory || !selectedSlot) return;

    setIsSubmitting(true);
    setConflictError(null);

    try {
      const payload = {
        serviceId: selectedService.id,
        serviceCategory: selectedCategory,
        property: propertyData,
        access: accessData,
        appointment: {
          start: selectedSlot.start,
        },
      };

      const result = await submitBooking(payload);

      if (result.success && result.booking) {
        setConfirmedBooking(result.booking);
        markStepCompleted('confirm');
      }
    } catch (err: any) {
      console.error('Booking submission error:', err);
      if (err.conflict) {
        setConflictError(
          'That appointment has just become unavailable. Please select another time.'
        );
      } else {
        setConflictError(
          err.message || 'An error occurred while confirming your booking. Please try again.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset booking wizard to start a new booking
  const handleResetBooking = () => {
    setConfirmedBooking(null);
    setSelectedSlot(null);
    setConflictError(null);
    setCompletedSteps([]);
    setCurrentStep('service-type');
    setSelectedCategory(null);
    setSelectedServiceId(null);
    setPropertyData({
      streetAddress: '',
      unit: '',
      suburb: '',
      state: 'WA',
      postcode: '',
      propertyType: 'House',
      clientName: '',
      clientReference: '',
      customerName: '',
      customerEmail: '',
      customerPhone: '',
    });
    setAccessData({
      method: 'tenant',
      tenant: {
        tenantName: '',
        tenantPhone: '',
        noticeIssued: 'yes',
      },
    });
  };

  const handleCloseManageModal = () => {
    setIsManageModalOpen(false);
    setDirectManageToken(null);

    if (window.location.pathname.startsWith('/manage/')) {
      window.history.replaceState({}, '', '/book');
      setPublicRoute('book');
    }
  };

  const handleAdminLogout = async () => {
    await logoutAdmin();
    setCurrentUser(null);
    setActiveView('booking');
  };

  const handleAdminServicesChanged = (publicServices: InspectionService[]) => {
    setServices(publicServices);

    const currentServiceStillAvailable =
      Boolean(selectedServiceId) &&
      publicServices.some(
        (service) =>
          service.id === selectedServiceId &&
          (!selectedCategory || service.categories.includes(selectedCategory))
      );

    if (!currentServiceStillAvailable) {
      setSelectedServiceId(null);
      setSelectedSlot(null);
      setConflictError(null);
      setCompletedSteps([]);
      setCurrentStep(selectedCategory ? 'service' : 'service-type');
    }
  };

  const selectedService =
    services.find((s) => s.id === selectedServiceId) || undefined;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      {/* Top Application Header */}
      <Header
        activeView={activeView}
        setActiveView={setActiveView}
        onNavigate={navigatePublic}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        {activeView === 'admin' ? (
          // Internal Admin Operations Portal
          <AdminPortal
            currentUser={currentUser}
            onLogout={handleAdminLogout}
            onBackToBooking={() => navigatePublic('/book')}
            onServicesChanged={handleAdminServicesChanged}
          />
        ) : publicRoute === 'hub' ? (
          <ClientHub onNavigate={navigatePublic} />
        ) : publicRoute === 'request-document' ? (
          <DocumentRequestFlow onBackToHub={() => navigatePublic('/')} />
        ) : publicRoute === 'signin' ? (
          <PlaceholderPage type="signin" onBack={() => navigatePublic('/')} />
        ) : confirmedBooking ? (
          // Dedicated Booking Confirmation Screen
          <StepConfirmation
            booking={confirmedBooking}
            onReset={handleResetBooking}
          />
        ) : (
          // Customer Step-by-Step Booking Wizard
          <div className="space-y-6">
            {/* Quick Manage Lookup Link */}
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2">
              <span className="font-semibold text-slate-600">
                ProInspect Western Australia &bull; Online Booking Hub
              </span>
              <button
                type="button"
                onClick={() => {
                  setDirectManageToken(null);
                  setIsManageModalOpen(true);
                }}
                className="text-[#006D70] hover:underline flex items-center gap-1 font-semibold"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Existing booking? Use secure code</span>
              </button>
            </div>

            {/* Wizard Progress Indicator */}
            <WizardProgress
              currentStep={currentStep}
              onStepClick={handleJumpToStep}
              completedSteps={completedSteps}
            />

            {/* Wizard Stage Content */}
            <div className="bg-transparent">
              {currentStep === 'service-type' && (
                <Step0ServiceType
                  selectedCategory={selectedCategory}
                  onSelectCategory={handleSelectCategory}
                  onNext={handleServiceTypeNext}
                />
              )}

              {currentStep === 'service' && selectedCategory && (
                <Step1Service
                  services={filteredServices}
                  serviceCategory={selectedCategory}
                  selectedServiceId={selectedServiceId}
                  onSelectService={handleSelectService}
                  onBack={() => setCurrentStep('service-type')}
                  onNext={handleStep1Next}
                />
              )}

              {currentStep === 'property' && (
                <Step2Property
                  initialData={propertyData}
                  onUpdate={setPropertyData}
                  onNext={handleStep2Next}
                  onBack={() => setCurrentStep('service')}
                />
              )}

              {currentStep === 'access' && (
                <Step3Access
                  initialData={accessData}
                  onUpdate={setAccessData}
                  onNext={handleStep3Next}
                  onBack={() => setCurrentStep('property')}
                />
              )}

              {currentStep === 'appointment' && selectedService && (
                <Step4Appointment
                  service={selectedService}
                  selectedSlot={selectedSlot}
                  onSelectSlot={setSelectedSlot}
                  onNext={handleStep4Next}
                  onBack={() => setCurrentStep('access')}
                />
              )}

              {currentStep === 'confirm' && selectedService && selectedCategory && selectedSlot && (
                <Step5Review
                  service={selectedService}
                  serviceCategory={selectedCategory}
                  property={propertyData}
                  access={accessData}
                  appointment={selectedSlot}
                  onJumpToStep={handleJumpToStep}
                  onConfirm={handleConfirmBooking}
                  isSubmitting={isSubmitting}
                  conflictError={conflictError}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Staff Admin Login Modal */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setActiveView('admin');
        }}
      />

      {/* Public Self-service Booking Lookup Modal */}
      <PublicBookingManageModal
        isOpen={isManageModalOpen}
        onClose={handleCloseManageModal}
        initialToken={directManageToken}
      />

      {/* Website Consistent Footer */}
      <Footer
        onOpenAdmin={() => {
          if (currentUser) {
            setActiveView('admin');
          } else {
            setIsAdminLoginOpen(true);
          }
        }}
      />
    </div>
  );
}
