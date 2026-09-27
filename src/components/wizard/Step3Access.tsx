import React, { useState } from 'react';
import { AccessDetails, AccessMethod } from '../../types/booking';
import {
  isValidAustralianPhone,
  isValidEmail,
} from '../../utils/australianValidation';
import {
  KeyRound,
  UserCheck,
  Building,
  ShieldAlert,
  Lock,
  DoorOpen,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
} from 'lucide-react';

interface Step3AccessProps {
  initialData: AccessDetails;
  onUpdate: (data: AccessDetails) => void;
  onNext: () => void;
  onBack: () => void;
}

interface MethodOption {
  id: AccessMethod;
  title: string;
  description: string;
  icon: React.ElementType;
}

const ACCESS_METHODS: MethodOption[] = [
  {
    id: 'tenant',
    title: 'Tenant will provide access',
    description: 'Current resident or tenant will be at the property to grant entry.',
    icon: UserCheck,
  },
  {
    id: 'meet_onsite',
    title: 'Meet someone onsite',
    description: 'Property manager, owner, tradesperson or representative will meet inspector.',
    icon: UserCheck,
  },
  {
    id: 'keys_agency',
    title: 'Keys held at agency',
    description: 'Inspector collects keys from managing real estate agency office prior to inspection.',
    icon: Building,
  },
  {
    id: 'keys_proinspect',
    title: 'Keys held by ProInspect',
    description: 'ProInspect already holds management keys or secure agency key fob.',
    icon: KeyRound,
  },
  {
    id: 'lockbox',
    title: 'Lockbox on site',
    description: 'Keys located in secure on-site key safe or lockbox.',
    icon: Lock,
  },
  {
    id: 'vacant',
    title: 'Property is vacant / open access',
    description: 'Unoccupied property with unlocked side gate or open perimeter access.',
    icon: DoorOpen,
  },
  {
    id: 'other',
    title: 'Other arrangement',
    description: 'Custom security guard, building concierge, or unique access requirements.',
    icon: HelpCircle,
  },
];

export const Step3Access: React.FC<Step3AccessProps> = ({
  initialData,
  onUpdate,
  onNext,
  onBack,
}) => {
  const [method, setMethod] = useState<AccessMethod>(initialData.method || 'tenant');

  // Conditional form states
  const [tenant, setTenant] = useState({
    tenantName: initialData.tenant?.tenantName || '',
    tenantPhone: initialData.tenant?.tenantPhone || '',
    tenantEmail: initialData.tenant?.tenantEmail || '',
    noticeIssued: initialData.tenant?.noticeIssued || 'yes',
    noticeDate: initialData.tenant?.noticeDate || '',
    accessRestrictions: initialData.tenant?.accessRestrictions || '',
  });

  const [meetOnsite, setMeetOnsite] = useState({
    contactName: initialData.meetOnsite?.contactName || '',
    contactPhone: initialData.meetOnsite?.contactPhone || '',
    relationship: initialData.meetOnsite?.relationship || 'Property Manager',
    specialInstructions: initialData.meetOnsite?.specialInstructions || '',
  });

  const [agencyKeys, setAgencyKeys] = useState({
    agencyName: initialData.agencyKeys?.agencyName || '',
    collectionAddress: initialData.agencyKeys?.collectionAddress || '',
    keyReference: initialData.agencyKeys?.keyReference || '',
    keyInstructions: initialData.agencyKeys?.keyInstructions || '',
    returnInstructions: initialData.agencyKeys?.returnInstructions || '',
  });

  const [proInspectKeys, setProInspectKeys] = useState({
    keyReference: initialData.proInspectKeys?.keyReference || '',
    additionalInstructions: initialData.proInspectKeys?.additionalInstructions || '',
  });

  const [lockbox, setLockbox] = useState({
    location: initialData.lockbox?.location || '',
    instructions: initialData.lockbox?.instructions || '',
    code: initialData.lockbox?.code || '',
  });

  const [vacant, setVacant] = useState({
    accessInstructions: initialData.vacant?.accessInstructions || '',
    securityAlarm: initialData.vacant?.securityAlarm || '',
  });

  const [other, setOther] = useState({
    instructions: initialData.other?.instructions || '',
  });

  const [specialInstructions, setSpecialInstructions] = useState(
    initialData.specialInstructions || ''
  );

  const [showLockboxCode, setShowLockboxCode] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (method === 'tenant') {
      if (!tenant.tenantName.trim()) errs.tenantName = 'Tenant name is required.';
      if (!tenant.tenantPhone.trim()) {
        errs.tenantPhone = 'Tenant mobile number is required.';
      } else if (!isValidAustralianPhone(tenant.tenantPhone)) {
        errs.tenantPhone = 'Enter a valid Australian mobile number.';
      }
      if (tenant.tenantEmail.trim() && !isValidEmail(tenant.tenantEmail)) {
        errs.tenantEmail = 'Enter a valid tenant email address.';
      }
      if (tenant.noticeIssued === 'yes' && !tenant.noticeDate) {
        errs.noticeDate = 'Enter the date the tenant entry notice was issued.';
      }
    } else if (method === 'meet_onsite') {
      if (!meetOnsite.contactName.trim()) errs.meetName = 'Contact name is required.';
      if (!meetOnsite.contactPhone.trim()) {
        errs.meetPhone = 'Contact mobile number is required.';
      } else if (!isValidAustralianPhone(meetOnsite.contactPhone)) {
        errs.meetPhone = 'Enter a valid Australian mobile number.';
      }
    } else if (method === 'keys_agency') {
      if (!agencyKeys.agencyName.trim()) errs.agencyName = 'Agency name is required.';
      if (!agencyKeys.collectionAddress.trim()) errs.collectionAddress = 'Collection address is required.';
    } else if (method === 'lockbox') {
      if (!lockbox.location.trim()) errs.lockboxLocation = 'Lockbox location is required.';
      if (!lockbox.code.trim()) errs.lockboxCode = 'Lockbox combination code is required.';
    } else if (method === 'other') {
      if (!other.instructions.trim()) errs.otherInstructions = 'Please provide access instructions.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveAndProceed = () => {
    if (!validate()) return;

    const payload: AccessDetails = {
      method,
      tenant: method === 'tenant' ? tenant : undefined,
      meetOnsite: method === 'meet_onsite' ? meetOnsite : undefined,
      agencyKeys: method === 'keys_agency' ? agencyKeys : undefined,
      proInspectKeys: method === 'keys_proinspect' ? proInspectKeys : undefined,
      lockbox: method === 'lockbox' ? lockbox : undefined,
      vacant: method === 'vacant' ? vacant : undefined,
      other: method === 'other' ? other : undefined,
      specialInstructions: specialInstructions.trim() || undefined,
    };

    onUpdate(payload);
    onNext();
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A] tracking-tight">
          Property access
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-slate-600">
          Tell us how our inspector will access the property.
        </p>
      </div>

      {/* Access Method Cards */}
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
          Access Method <span className="text-rose-500">*</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACCESS_METHODS.map((opt) => {
            const isSelected = method === opt.id;
            const Icon = opt.icon;
            return (
              <div
                key={opt.id}
                onClick={() => setMethod(opt.id)}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between group ${
                  isSelected
                    ? 'border-[#00B5B8] bg-[#F0F9FF] shadow-xs ring-1 ring-[#00B5B8]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-[#007F82] text-white'
                        : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected
                        ? 'border-[#00B5B8] bg-[#007F82] text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-sm text-[#1A2B4A]">{opt.title}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-normal">{opt.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dynamic Conditional Sub-Form */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
        {/* Method 1: Tenant */}
        {method === 'tenant' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Tenant Contact &amp; Notice Details</h3>
              <p className="text-xs text-slate-500">Provide tenant details for entry notification</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Tenant Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Smith"
                  value={tenant.tenantName}
                  onChange={(e) => setTenant({ ...tenant, tenantName: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.tenantName && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.tenantName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Tenant Mobile <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 0411 111 111"
                  value={tenant.tenantPhone}
                  onChange={(e) => setTenant({ ...tenant, tenantPhone: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.tenantPhone && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.tenantPhone}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Tenant Email <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={tenant.tenantEmail}
                  onChange={(e) => setTenant({ ...tenant, tenantEmail: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.tenantEmail && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.tenantEmail}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Has Entry Notice Been Issued? <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      name="noticeIssued"
                      value="yes"
                      checked={tenant.noticeIssued === 'yes'}
                      onChange={() => setTenant({ ...tenant, noticeIssued: 'yes' })}
                      className="text-[#006D70] focus:ring-[#00B5B8]"
                    />
                    <span>Yes, notice issued</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      name="noticeIssued"
                      value="pending"
                      checked={tenant.noticeIssued === 'pending'}
                      onChange={() => setTenant({ ...tenant, noticeIssued: 'pending', noticeDate: '' })}
                      className="text-[#006D70] focus:ring-[#00B5B8]"
                    />
                    <span>Notice pending</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      name="noticeIssued"
                      value="no"
                      checked={tenant.noticeIssued === 'no'}
                      onChange={() => setTenant({ ...tenant, noticeIssued: 'no', noticeDate: '' })}
                      className="text-[#006D70] focus:ring-[#00B5B8]"
                    />
                    <span>No notice issued</span>
                  </label>
                </div>
              </div>
            </div>

            {tenant.noticeIssued === 'yes' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Date Entry Notice Was Issued <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={tenant.noticeDate}
                  onChange={(e) => setTenant({ ...tenant, noticeDate: e.target.value })}
                  className="w-full sm:w-64 h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.noticeDate && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.noticeDate}
                  </p>
                )}
              </div>
            )}

            {tenant.noticeIssued !== 'yes' && (
              <div
                className={`p-3 rounded-lg border text-xs font-medium ${
                  tenant.noticeIssued === 'pending'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {tenant.noticeIssued === 'pending'
                  ? 'The appointment can be reserved, but it will be flagged as Pending Tenant Notice until the notice is issued.'
                  : 'The appointment can be reserved, but it will be flagged Access Action Required before attendance.'}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Access Restrictions or Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Shift worker sleeping in morning, call 10 mins prior to arrival"
                value={tenant.accessRestrictions}
                onChange={(e) => setTenant({ ...tenant, accessRestrictions: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Method 2: Meet onsite */}
        {method === 'meet_onsite' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Onsite Contact Person</h3>
              <p className="text-xs text-slate-500">Who will be meeting the inspector at the property?</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Contact Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. David Miller"
                  value={meetOnsite.contactName}
                  onChange={(e) => setMeetOnsite({ ...meetOnsite, contactName: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.meetName && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.meetName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mobile Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 0422 333 444"
                  value={meetOnsite.contactPhone}
                  onChange={(e) => setMeetOnsite({ ...meetOnsite, contactPhone: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.meetPhone && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.meetPhone}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Relationship to Property
                </label>
                <select
                  value={meetOnsite.relationship}
                  onChange={(e) => setMeetOnsite({ ...meetOnsite, relationship: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all font-medium"
                >
                  <option value="Property Manager">Property Manager</option>
                  <option value="Owner / Landlord">Owner / Landlord</option>
                  <option value="Strata Representative">Strata Representative</option>
                  <option value="Trade / Contractor">Trade / Contractor</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Meeting Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Meet in front driveway or main foyer"
                value={meetOnsite.specialInstructions}
                onChange={(e) => setMeetOnsite({ ...meetOnsite, specialInstructions: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Method 3: Keys held at agency */}
        {method === 'keys_agency' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Agency Key Collection</h3>
              <p className="text-xs text-slate-500">Provide the agency office location where keys will be collected</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Agency Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ray White Victoria Park"
                  value={agencyKeys.agencyName}
                  onChange={(e) => setAgencyKeys({ ...agencyKeys, agencyName: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.agencyName && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.agencyName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Key Reference / Tag <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tag #104 or Key Safe Box 3"
                  value={agencyKeys.keyReference}
                  onChange={(e) => setAgencyKeys({ ...agencyKeys, keyReference: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Key Collection Address <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 340 Albany Highway, Victoria Park WA 6100"
                value={agencyKeys.collectionAddress}
                onChange={(e) => setAgencyKeys({ ...agencyKeys, collectionAddress: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
              {errors.collectionAddress && (
                <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {errors.collectionAddress}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Key Availability Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ask for receptionist or property manager"
                  value={agencyKeys.keyInstructions}
                  onChange={(e) => setAgencyKeys({ ...agencyKeys, keyInstructions: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Required Return Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Return to agency letterbox before 5pm"
                  value={agencyKeys.returnInstructions}
                  onChange={(e) => setAgencyKeys({ ...agencyKeys, returnInstructions: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Method 4: Keys held by ProInspect */}
        {method === 'keys_proinspect' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Keys Held by ProInspect</h3>
              <p className="text-xs text-slate-500">Inspector will bring keys from the ProInspect secure key register</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  ProInspect Key Reference / Fob ID <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. PI-KEY-408"
                  value={proInspectKeys.keyReference}
                  onChange={(e) => setProInspectKeys({ ...proInspectKeys, keyReference: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Additional Key Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Master fob includes basement garage access"
                  value={proInspectKeys.additionalInstructions}
                  onChange={(e) => setProInspectKeys({ ...proInspectKeys, additionalInstructions: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Method 5: Lockbox */}
        {method === 'lockbox' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Onsite Lockbox</h3>
              <p className="text-xs text-slate-500">
                Lockbox codes are encrypted and restricted to operational inspector access only.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Lockbox Location <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Attached to gas meter box on left side of house"
                  value={lockbox.location}
                  onChange={(e) => setLockbox({ ...lockbox, location: e.target.value })}
                  className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
                />
                {errors.lockboxLocation && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.lockboxLocation}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Lockbox Code <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showLockboxCode ? 'text' : 'password'}
                    placeholder="e.g. 4821 or 1234"
                    value={lockbox.code}
                    onChange={(e) => setLockbox({ ...lockbox, code: e.target.value })}
                    className="w-full h-11 pl-3.5 pr-11 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none font-mono transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLockboxCode(!showLockboxCode)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showLockboxCode ? 'Hide code' : 'Show code'}
                  >
                    {showLockboxCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.lockboxCode && (
                  <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errors.lockboxCode}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Lockbox Instructions <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Scramble dials after replacing keys in safe"
                value={lockbox.instructions}
                onChange={(e) => setLockbox({ ...lockbox, instructions: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Method 6: Vacant */}
        {method === 'vacant' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Vacant / Open Property</h3>
              <p className="text-xs text-slate-500">Unrestricted or open perimeter access instructions</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Access Instructions
              </label>
              <input
                type="text"
                placeholder="e.g. Side gate unlocked, rear sliding door unlocked"
                value={vacant.accessInstructions}
                onChange={(e) => setVacant({ ...vacant, accessInstructions: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Security Alarm Details <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Alarm disarmed, or code 9988 upon entry"
                value={vacant.securityAlarm}
                onChange={(e) => setVacant({ ...vacant, securityAlarm: e.target.value })}
                className="w-full h-11 px-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Method 7: Other */}
        {method === 'other' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="font-bold text-base text-[#1A2B4A]">Custom Access Arrangement</h3>
              <p className="text-xs text-slate-500">Specify details for this custom access arrangement</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Access Instructions <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Explain the access procedure for the inspector..."
                value={other.instructions}
                onChange={(e) => setOther({ instructions: e.target.value })}
                className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
              />
              {errors.otherInstructions && (
                <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {errors.otherInstructions}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Global Multi-line Text Area: Additional Attendance Instructions */}
        <div className="pt-4 border-t border-slate-100 space-y-2">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
            Additional property or attendance instructions
          </label>
          <p className="text-xs text-slate-500">
            Examples: Pets at the property, parking instructions, security gates, access restrictions, or contact on arrival.
          </p>
          <textarea
            rows={3}
            placeholder="e.g. Dog secured in rear laundry. Visitor parking in driveway. Call tenant when arriving."
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            className="w-full p-3.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-[#0F172A] focus:bg-white focus:border-[#00B5B8] outline-none transition-all"
          />
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="pt-4 flex items-center justify-between border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-[#1A2B4A] hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Property Details</span>
        </button>

        <button
          type="button"
          onClick={handleSaveAndProceed}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-sm bg-[#007F82] hover:bg-[#006D70] text-white shadow-xs transition-colors cursor-pointer"
        >
          <span>Continue to Choose Appointment</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
