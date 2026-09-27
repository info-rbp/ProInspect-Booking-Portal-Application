import React, { useState, useEffect } from 'react';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { WizardProgress, WizardStepId } from './components/wizard/WizardProgress';
import { Step1Service } from './components/wizard/Step1Service';
import { Step2Property } from './components/wizard/Step2Property';
import { Step3Access } from './components/wizard/Step3Access';
import { Step4Appointment } from './components/wizard/Step4Appointment';
import { Step5Review } from './components/wizard/Step5Review';
import { StepConfirmation } from './components/wizard/StepConfirmation';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { PublicBookingManageModal } from './components/manage/PublicBookingManageModal';
import {
  InspectionService,
  PropertyDetails,
  AccessDetails,
  AppointmentSlot,
  PublicBookingSummary,
} from './types/booking';
import { fetchServices, submitBooking, verifyAdminSession } from './services/api';
import { initAuthListener, logoutAdmin } from './services/firebase';
import { User } from 'firebase/auth';
import { Search, ShieldAlert, CalendarClock } from 'lucide-react';

export default function App() {
  // Navigation / View State
  const [activeView, setActiveView] = useState<'booking' | 'admin'>('booking');
  const [currentStep, setCurrentStep] = useState<WizardStepId>('service');
  const [completedSteps, setCompletedSteps] = useState<WizardStepId[]>([]);

  // Services list
  const [services, setServices] = useState<InspectionService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);

  // Booking Form State
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
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  // Load initial services on mount
  useEffect(() => {
    async function load() {
      setIsLoadingServices(true);
      try {
        const srvs = await fetchServices();
        setServices(srvs);
        // Pre-select Routine Inspection as standard starting point if available
        if (srvs.length > 0 && !selectedServiceId) {
          setSelectedServiceId(srvs[0].id);
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
    if (!selectedService || !selectedSlot) return;

    setIsSubmitting(true);
    setConflictError(null);

    try {
      const payload = {
        serviceId: selectedService.id,
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
    setCurrentStep('service');
    setSelectedServiceId(services[0]?.id || null);
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

  const handleAdminLogout = async () => {
    await logoutAdmin();
    setCurrentUser(null);
    setActiveView('booking');
  };

  const handleAdminServicesChanged = (publicServices: InspectionService[]) => {
    setServices(publicServices);

    setSelectedServiceId((current) => {
      if (current && publicServices.some((service) => service.id === current)) {
        return current;
      }

      setSelectedSlot(null);
      setConflictError(null);
      setCompletedSteps([]);
      setCurrentStep('service');
      return publicServices[0]?.id || null;
    });
  };

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      {/* Top Application Header */}
      <Header
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        {activeView === 'admin' ? (
          // Internal Admin Operations Portal
          <AdminDashboard
            currentUser={currentUser}
            onLogout={handleAdminLogout}
            onBackToBooking={() => setActiveView('booking')}
            onServicesChanged={handleAdminServicesChanged}
          />
        ) : confirmedBooking ? (
          // Dedicated Booking Confirmation Screen
          <StepConfirmation
            booking={confirmedBooking}
            onReset={handleResetBooking}
          />
        ) : (
          // Customer Step-by-Step Wizard
          <div className="space-y-6">
            {/* Quick Manage Lookup Link */}
            <div className="flex items-center justify-between text-xs text-slate-500 pb-2">
              <span className="font-semibold text-slate-600">
                ProInspect Western Australia &bull; Online Booking Hub
              </span>
              <button
                type="button"
                onClick={() => setIsManageModalOpen(true)}
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
              {currentStep === 'service' && (
                <Step1Service
                  services={services}
                  selectedServiceId={selectedServiceId}
                  onSelectService={handleSelectService}
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

              {currentStep === 'confirm' && selectedService && selectedSlot && (
                <Step5Review
                  service={selectedService}
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
        onClose={() => setIsManageModalOpen(false)}
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
