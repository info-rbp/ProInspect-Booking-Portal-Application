import type {
  DocumentWorkflowAnswer,
  DocumentWorkflowDefinition,
  DocumentWorkflowField,
} from '../types/documentRequest';

const yesNo = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const paymentMethods = [
  { value: 'bank-transfer', label: 'Bank transfer' },
  { value: 'direct-debit', label: 'Direct debit' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export const DOCUMENT_WORKFLOW_DEFINITIONS: Record<
  string,
  DocumentWorkflowDefinition
> = {
  'residential-tenancy-lease-agreement-form-1aa': {
    documentId: 'residential-tenancy-lease-agreement-form-1aa',
    version: 1,
    title: 'Residential Tenancy Agreement (Form 1AA)',
    intro:
      'Complete the tenancy details once and ProInspect will use them to prepare the current WA Form 1AA. The prescribed standard terms are not edited by this workflow.',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'agreement',
        title: 'Agreement and premises',
        description: 'Tell us the tenancy type, dates and what is included with the premises.',
        fields: [
          {
            id: 'agreementType',
            label: 'Agreement type',
            type: 'radio',
            required: true,
            options: [
              { value: 'periodic', label: 'Periodic tenancy' },
              { value: 'fixed', label: 'Fixed-term tenancy' },
            ],
          },
          {
            id: 'tenancyStartDate',
            label: 'Tenancy start date',
            type: 'date',
            required: true,
          },
          {
            id: 'tenancyEndDate',
            label: 'Tenancy end date',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'agreementType', equals: 'fixed' },
          },
          {
            id: 'premisesInclusions',
            label: 'Items or areas included with the premises',
            type: 'textarea',
            placeholder:
              'For example: car bay, garage, storeroom, furniture, appliances or garden areas.',
          },
          {
            id: 'premisesExclusions',
            label: 'Items or areas excluded from the tenancy',
            type: 'textarea',
            placeholder: 'For example: locked shed or owner storage area.',
          },
          {
            id: 'maximumOccupants',
            label: 'Maximum number of occupants',
            type: 'number',
            required: true,
            min: 1,
            max: 30,
          },
          {
            id: 'propertyManagerIncluded',
            label: 'Is a property manager named on this agreement?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'propertyManagerName',
            label: 'Property manager name / business',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerAddress',
            label: 'Property manager contact address',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerPhone',
            label: 'Property manager telephone',
            type: 'phone',
            required: true,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerEmail',
            label: 'Property manager email',
            type: 'email',
            required: true,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerEmailNotice',
            label: 'Property manager agrees to notices by email?',
            type: 'radio',
            required: true,
            options: yesNo,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerFaxNotice',
            label: 'Property manager agrees to notices by fax?',
            type: 'radio',
            required: true,
            options: yesNo,
            showWhen: { fieldId: 'propertyManagerIncluded', equals: 'yes' },
          },
          {
            id: 'propertyManagerFaxNumber',
            label: 'Property manager fax number',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'propertyManagerFaxNotice', equals: 'yes' },
          },
          {
            id: 'electronicNoticeConsents',
            label: 'Electronic notice preferences for lessors and tenants',
            type: 'party-electronic-consents',
            required: true,
            help:
              'Record whether each lessor and tenant agrees to receive notices and information by email or fax. If fax is selected, provide the fax number.',
          },
        ],
      },
      {
        id: 'rent-bond',
        title: 'Rent and bond',
        description: 'Provide the rent, payment and bond arrangements.',
        fields: [
          {
            id: 'rentBasis',
            label: 'How is rent calculated?',
            type: 'radio',
            required: true,
            options: [
              { value: 'fixed', label: 'Fixed weekly rent' },
              { value: 'income', label: 'Calculated by reference to tenant income' },
            ],
          },
          {
            id: 'weeklyRent',
            label: 'Weekly rent',
            type: 'currency',
            required: true,
            showWhen: { fieldId: 'rentBasis', equals: 'fixed' },
          },
          {
            id: 'incomeRentCalculation',
            label: 'Income-based rent calculation',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'rentBasis', equals: 'income' },
            placeholder: 'Describe the calculation used to determine the rent.',
          },
          {
            id: 'rentPaymentFrequency',
            label: 'Rent payment frequency',
            type: 'radio',
            required: true,
            options: [
              { value: 'weekly', label: 'Weekly in advance' },
              { value: 'fortnightly', label: 'Fortnightly in advance' },
            ],
          },
          {
            id: 'firstRentPaymentDate',
            label: 'First rent payment date',
            type: 'date',
            required: true,
          },
          {
            id: 'rentPaymentMethod',
            label: 'Rent payment method',
            type: 'select',
            required: true,
            options: paymentMethods,
          },
          {
            id: 'rentBankBsb',
            label: 'Rent account BSB',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'rentPaymentMethod', equals: 'bank-transfer' },
            placeholder: '000-000',
          },
          {
            id: 'rentBankAccountNumber',
            label: 'Rent account number',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'rentPaymentMethod', equals: 'bank-transfer' },
          },
          {
            id: 'rentBankAccountName',
            label: 'Rent account name',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'rentPaymentMethod', equals: 'bank-transfer' },
          },
          {
            id: 'rentPaymentReference',
            label: 'Preferred payment reference',
            type: 'text',
            showWhen: { fieldId: 'rentPaymentMethod', equals: 'bank-transfer' },
          },
          {
            id: 'rentOtherMethod',
            label: 'Other rent payment instructions',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'rentPaymentMethod', equals: 'other' },
          },
          {
            id: 'securityBondAmount',
            label: 'Security bond amount',
            type: 'currency',
            required: true,
          },
          {
            id: 'petBondAmount',
            label: 'Pet bond amount',
            type: 'currency',
            required: true,
            help: 'Enter 0 if no pet bond applies.',
          },
          {
            id: 'fixedTermRentIncrease',
            label: 'Fixed-term rent increase or calculation method',
            type: 'textarea',
            showWhen: { fieldId: 'agreementType', equals: 'fixed' },
            placeholder: 'For example: no increase, CPI, percentage or fixed amount.',
          },
        ],
      },
      {
        id: 'utilities',
        title: 'Water and utilities',
        description: 'Record water arrangements and whether utilities are separately metered.',
        fields: [
          {
            id: 'schemeWaterConnected',
            label: 'Is scheme water connected?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'waterUsagePercent',
            label: 'Percentage of scheme water consumption payable by tenant',
            type: 'number',
            required: true,
            min: 0,
            max: 100,
          },
          {
            id: 'waterProviderPermission',
            label: 'May the tenant contact the water service provider about consumption accounts, concessions and supply faults?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'electricityMetered',
            label: 'Electricity separately metered?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'electricityCalculation',
            label: 'How will electricity consumption be calculated?',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'electricityMetered', equals: 'no' },
          },
          {
            id: 'gasMetered',
            label: 'Gas separately metered?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'gasCalculation',
            label: 'How will gas consumption be calculated?',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'gasMetered', equals: 'no' },
          },
          {
            id: 'waterMetered',
            label: 'Water separately metered?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'waterCalculation',
            label: 'How will water consumption be calculated?',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'waterMetered', equals: 'no' },
          },
          {
            id: 'otherUtilityName',
            label: 'Other utility, if applicable',
            type: 'text',
          },
          {
            id: 'otherUtilityMetered',
            label: 'Other utility separately metered?',
            type: 'radio',
            options: yesNo,
            showWhen: { fieldId: 'otherUtilityName', notEquals: '' },
          },
          {
            id: 'otherUtilityCalculation',
            label: 'How will the other utility consumption be calculated?',
            type: 'textarea',
            showWhen: { fieldId: 'otherUtilityMetered', equals: 'no' },
          },
        ],
      },
      {
        id: 'rules',
        title: 'By-laws, pets and permissions',
        fields: [
          {
            id: 'strataBylawsApplicable',
            label: 'Are strata by-laws applicable to the premises?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'strataBylawsAttached',
            label: 'Will a copy of the strata by-laws be attached?',
            type: 'radio',
            required: true,
            options: yesNo,
            showWhen: { fieldId: 'strataBylawsApplicable', equals: 'yes' },
          },
          {
            id: 'communityBylawsApplicable',
            label: 'Are community title scheme by-laws applicable?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'communityBylawsAttached',
            label: 'Will a copy of the community title scheme by-laws be attached?',
            type: 'radio',
            required: true,
            options: yesNo,
            showWhen: { fieldId: 'communityBylawsApplicable', equals: 'yes' },
          },
          {
            id: 'petsPermitted',
            label: 'Are pets permitted?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'petDetails',
            label: 'Pet type and number',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'petsPermitted', equals: 'yes' },
            placeholder: 'For example: 1 dog; 2 cats.',
          },
          {
            id: 'petConditions',
            label: 'Pet conditions',
            type: 'textarea',
            showWhen: { fieldId: 'petsPermitted', equals: 'yes' },
            placeholder: 'Cleaning, maintenance, fumigation or other agreed conditions.',
          },
          {
            id: 'assignmentRule',
            label: 'Assignment or subletting',
            type: 'radio',
            required: true,
            options: [
              { value: 'allowed', label: 'Tenant may assign or sublet' },
              { value: 'not-allowed', label: 'Tenant may not assign or sublet' },
              {
                value: 'written-consent',
                label: 'Only with the lessor’s written consent',
              },
            ],
          },
          {
            id: 'otherModificationsWithoutConsent',
            label: 'Other modifications the tenant may make without further consent',
            type: 'textarea',
            placeholder: 'Leave blank if none are specifically agreed.',
          },
          {
            id: 'otherModificationRule',
            label: 'Rule for other modifications',
            type: 'radio',
            required: true,
            options: [
              {
                value: 'with-consent',
                label: 'Other modifications may be made with lessor consent',
              },
              {
                value: 'not-permitted',
                label: 'Other modifications are not permitted, subject to statutory rights',
              },
            ],
          },
          {
            id: 'additionalTerms',
            label: 'Additional terms requested',
            type: 'textarea',
            placeholder:
              'Optional. ProInspect will review requested additional terms before inclusion.',
            help:
              'Additional terms must not conflict with the prescribed standard terms or applicable law.',
          },
        ],
      },
    ],
  },

  'lodgement-security-bond-money-form-preparation': {
    documentId: 'lodgement-security-bond-money-form-preparation',
    version: 1,
    title: 'Lodgement of Security Bond Money',
    intro:
      'Provide the bond, tenancy and payment details required for the current WA bond lodgement form.',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    reviewNotice:
      'The current Bonds Administration form requires physical signatures in pen or by stylus; standard eSignature software is not accepted.',
    sections: [
      {
        id: 'bond',
        title: 'Bond details',
        fields: [
          {
            id: 'tenancyStartDate',
            label: 'Tenancy start date',
            type: 'date',
            required: true,
          },
          {
            id: 'dateBondPaid',
            label: 'Date bond money was paid by the tenant',
            type: 'date',
            required: true,
          },
          {
            id: 'weeklyRent',
            label: 'Weekly rent',
            type: 'currency',
            required: true,
          },
          {
            id: 'securityBondAmount',
            label: 'Security bond amount',
            type: 'currency',
            required: true,
          },
          {
            id: 'petBondAmount',
            label: 'Pet bond amount',
            type: 'currency',
            required: true,
            help: 'Enter 0 if no pet bond applies.',
          },
          {
            id: 'housingBondAssistance',
            label: 'Housing bond assistance loan amount',
            type: 'currency',
            help: 'Leave blank if not applicable.',
          },
          {
            id: 'bondPaymentMethod',
            label: 'Bond lodgement payment method',
            type: 'select',
            required: true,
            options: [
              { value: 'direct-debit', label: 'Direct debit' },
              { value: 'cheque', label: 'Cheque' },
              { value: 'cash', label: 'Cash' },
              { value: 'other', label: 'Other' },
            ],
          },
          {
            id: 'debitAccountName',
            label: 'Direct debit account name',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'bondPaymentMethod', equals: 'direct-debit' },
          },
          {
            id: 'debitBsb',
            label: 'Direct debit BSB',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'bondPaymentMethod', equals: 'direct-debit' },
          },
          {
            id: 'debitAccountNumber',
            label: 'Direct debit account number',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'bondPaymentMethod', equals: 'direct-debit' },
          },
          {
            id: 'debitFinancialInstitution',
            label: 'Australian financial institution',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'bondPaymentMethod', equals: 'direct-debit' },
          },
          {
            id: 'agentName',
            label: 'Property manager / agent name',
            type: 'text',
          },
          {
            id: 'rebaLicenceNumber',
            label: 'REBA licence number',
            type: 'text',
            help: 'Licensed agents only.',
          },
        ],
      },
    ],
  },

  'variation-security-bond-money-form': {
    documentId: 'variation-security-bond-money-form',
    version: 1,
    title: 'Variation of Security Bond',
    intro:
      'Use this workflow to prepare changes to tenants, landlords, agents or the bond amount.',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    reviewNotice:
      'The current Bonds Administration variation form requires physical signatures in pen or by stylus.',
    sections: [
      {
        id: 'variation',
        title: 'Variation details',
        fields: [
          {
            id: 'bondReference',
            label: 'Rental bond reference number',
            type: 'text',
            required: true,
          },
          {
            id: 'dateOfChange',
            label: 'Date of change',
            type: 'date',
            required: true,
          },
          {
            id: 'variationTypes',
            label: 'What is changing?',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'tenant', label: 'Tenant details' },
              { value: 'agent', label: 'Property manager / agent' },
              { value: 'lessor', label: 'Owner / landlord' },
              { value: 'bond-increase', label: 'Bond amount' },
            ],
          },
          {
            id: 'tenantChanges',
            label: 'Tenant changes',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'variationTypes', includes: 'tenant' },
            placeholder:
              'Identify vacating tenants and any new tenants, including contact details where known.',
          },
          {
            id: 'agentChanges',
            label: 'Agent changes',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'variationTypes', includes: 'agent' },
            placeholder: 'Former agent and new agent details, including REBA licence number if applicable.',
          },
          {
            id: 'lessorChanges',
            label: 'Owner / landlord changes',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'variationTypes', includes: 'lessor' },
            placeholder: 'Former and new owner / landlord details.',
          },
          {
            id: 'weeklyRentIncrease',
            label: 'Increase to weekly rent amount',
            type: 'currency',
            showWhen: { fieldId: 'variationTypes', includes: 'bond-increase' },
          },
          {
            id: 'petBondIncrease',
            label: 'Increase to pet bond',
            type: 'currency',
            showWhen: { fieldId: 'variationTypes', includes: 'bond-increase' },
          },
          {
            id: 'totalBondIncrease',
            label: 'Total amount to be added to security bond',
            type: 'currency',
            required: true,
            showWhen: { fieldId: 'variationTypes', includes: 'bond-increase' },
          },
          {
            id: 'dateIncreasePaid',
            label: 'Date bond increase was paid',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'variationTypes', includes: 'bond-increase' },
          },
          {
            id: 'bondIncreasePaymentMethod',
            label: 'Payment method for bond increase',
            type: 'select',
            required: true,
            options: [
              { value: 'direct-debit', label: 'Direct debit' },
              { value: 'cheque', label: 'Cheque' },
              { value: 'cash', label: 'Cash' },
              { value: 'other', label: 'Other' },
            ],
            showWhen: { fieldId: 'variationTypes', includes: 'bond-increase' },
          },
          {
            id: 'variationDebitAccountName',
            label: 'Direct debit account name',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: {
              fieldId: 'bondIncreasePaymentMethod',
              equals: 'direct-debit',
            },
          },
          {
            id: 'variationDebitBsb',
            label: 'Direct debit BSB',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: {
              fieldId: 'bondIncreasePaymentMethod',
              equals: 'direct-debit',
            },
          },
          {
            id: 'variationDebitAccountNumber',
            label: 'Direct debit account number',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: {
              fieldId: 'bondIncreasePaymentMethod',
              equals: 'direct-debit',
            },
          },
          {
            id: 'variationDebitInstitution',
            label: 'Australian financial institution',
            type: 'text',
            required: true,
            showWhen: {
              fieldId: 'bondIncreasePaymentMethod',
              equals: 'direct-debit',
            },
          },
        ],
      },
    ],
  },

  'joint-application-disposal-security-bond': {
    documentId: 'joint-application-disposal-security-bond',
    version: 1,
    title: 'Security Bond Release Application',
    intro:
      'Provide the current bond details, proposed payments and any landlord claim so ProInspect can prepare the bond release application.',
    allowedRequesterRoles: ['lessor', 'property-manager', 'tenant', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    reviewNotice:
      'The current Security Bond Release Application requires physical signatures in pen or by stylus. Bank payment details are encrypted separately from the normal request record.',
    sections: [
      {
        id: 'bond-release',
        title: 'Bond and release details',
        fields: [
          {
            id: 'bondReference',
            label: 'Rental bond reference number',
            type: 'text',
            required: true,
          },
          {
            id: 'partialRelease',
            label: 'Is this a partial release?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'tenancyEndDate',
            label: 'Tenancy end date',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'partialRelease', equals: 'no' },
          },
          {
            id: 'totalBondAmount',
            label: 'Total bond amount',
            type: 'currency',
            required: true,
          },
          {
            id: 'partyPayouts',
            label: 'Payments to tenants and lessors',
            type: 'party-payouts',
            required: true,
            sensitive: true,
            help:
              'Enter the amount and Australian bank account for each party receiving bond money. Enter 0 for a party receiving no payment.',
          },
          {
            id: 'agentPayoutRequired',
            label: 'Is any bond money to be paid to a licensed property agent?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'agentPayoutAmount',
            label: 'Amount to be paid to the property agent',
            type: 'currency',
            required: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutName',
            label: 'Property agent / business name',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutRebaLicence',
            label: 'REBA licence number',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutAccountName',
            label: 'Agent bank account name',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutBsb',
            label: 'Agent BSB',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutAccountNumber',
            label: 'Agent account number',
            type: 'text',
            required: true,
            sensitive: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
          {
            id: 'agentPayoutInstitution',
            label: 'Australian financial institution',
            type: 'text',
            required: true,
            showWhen: { fieldId: 'agentPayoutRequired', equals: 'yes' },
          },
        ],
      },
      {
        id: 'claim',
        title: 'Landlord / agent claim',
        description: 'Enter only actual financial losses being claimed from the bond.',
        fields: [
          {
            id: 'claimRepairDamage',
            label: 'Repairing tenant or pet-caused damage',
            type: 'currency',
          },
          {
            id: 'claimGarden',
            label: 'Garden repair and maintenance',
            type: 'currency',
          },
          {
            id: 'claimCarpet',
            label: 'Carpet cleaning',
            type: 'currency',
          },
          {
            id: 'claimGeneralCleaning',
            label: 'General cleaning',
            type: 'currency',
          },
          {
            id: 'claimPetFumigation',
            label: 'Pet fumigation',
            type: 'currency',
          },
          {
            id: 'claimLocks',
            label: 'Locks, keys and security devices',
            type: 'currency',
          },
          {
            id: 'claimUnpaidRent',
            label: 'Unpaid rent',
            type: 'currency',
          },
          {
            id: 'claimUtilities',
            label: 'Unpaid utilities',
            type: 'currency',
          },
          {
            id: 'claimOther',
            label: 'Other breaches of the agreement',
            type: 'currency',
          },
          {
            id: 'claimOtherDescription',
            label: 'Describe other financial loss',
            type: 'textarea',
            showWhen: { fieldId: 'claimOther', notEquals: '' },
          },
          {
            id: 'transferToNewLodgement',
            label: 'Amount to transfer to a new bond lodgement',
            type: 'currency',
          },
          {
            id: 'bondAssistanceRepayment',
            label: 'Bond assistance loan repayment amount',
            type: 'currency',
          },
        ],
      },
    ],
  },

  'notice-rent-increase-form-10': {
    documentId: 'notice-rent-increase-form-10',
    version: 1,
    title: 'Notice to Tenant of Rent Increase (Form 10)',
    intro:
      'Provide the current and new rent details. The workflow records dates used to check the notice before preparation.',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'rent-increase',
        title: 'Rent increase details',
        fields: [
          {
            id: 'currentWeeklyRent',
            label: 'Current weekly rent',
            type: 'currency',
            required: true,
          },
          {
            id: 'increasePerWeek',
            label: 'Increase per week',
            type: 'currency',
            required: true,
          },
          {
            id: 'newWeeklyRent',
            label: 'New weekly rent',
            type: 'currency',
            required: true,
          },
          {
            id: 'increaseEffectiveDate',
            label: 'Date increased rent takes effect',
            type: 'date',
            required: true,
          },
          {
            id: 'firstIncreasedPaymentDate',
            label: 'Date first increased payment is due',
            type: 'date',
            required: true,
          },
          {
            id: 'firstIncreasedPaymentAmount',
            label: 'Total rent payable on that first payment date',
            type: 'currency',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Proposed date of notice',
            type: 'date',
            required: true,
          },
          {
            id: 'lastRentIncreaseDate',
            label: 'Date of last rent increase',
            type: 'date',
            help: 'Leave blank if this is the first increase in the tenancy.',
          },
          {
            id: 'tenancyStartDate',
            label: 'Tenancy commencement date',
            type: 'date',
            required: true,
          },
          {
            id: 'agreementType',
            label: 'Current tenancy type',
            type: 'radio',
            required: true,
            options: [
              { value: 'periodic', label: 'Periodic' },
              { value: 'fixed', label: 'Fixed term' },
            ],
          },
          {
            id: 'fixedAgreementIncreaseClause',
            label: 'Fixed-term rent increase clause or calculation method',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'agreementType', equals: 'fixed' },
          },
        ],
      },
    ],
  },

  'notice-rent-increase-income-form-11': {
    documentId: 'notice-rent-increase-income-form-11',
    version: 1,
    title: 'Notice of Variation of Rent Calculated by Tenant Income (Form 11)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'income-rent',
        title: 'Income-based rent calculation',
        fields: [
          {
            id: 'currentCalculation',
            label: 'Current rent calculation',
            type: 'textarea',
            required: true,
          },
          {
            id: 'currentFortnightlyRent',
            label: 'Current rent per fortnight',
            type: 'currency',
            required: true,
          },
          {
            id: 'newCalculation',
            label: 'New rent calculation',
            type: 'textarea',
            required: true,
          },
          {
            id: 'newFortnightlyRent',
            label: 'New rent per fortnight',
            type: 'currency',
            required: true,
          },
          {
            id: 'increaseEffectiveDate',
            label: 'Date the increased rent will take effect',
            type: 'date',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Proposed date of notice',
            type: 'date',
            required: true,
          },
          {
            id: 'tenancyStartDate',
            label: 'Tenancy commencement date',
            type: 'date',
            required: true,
          },
          {
            id: 'lastCalculationChangeDate',
            label: 'Date the rent calculation method was last changed',
            type: 'date',
            help: 'Leave blank if it has not previously changed.',
          },
        ],
      },
    ],
  },

  'notice-proposed-entry-form-19': {
    documentId: 'notice-proposed-entry-form-19',
    version: 1,
    title: 'Notice of Proposed Entry to Premises (Form 19)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'entry',
        title: 'Proposed entry',
        fields: [
          {
            id: 'entryDate',
            label: 'Proposed entry date',
            type: 'date',
            required: true,
          },
          {
            id: 'entryPeriod',
            label: 'Proposed time period',
            type: 'radio',
            required: true,
            options: [
              { value: 'before-noon', label: 'Before 12 noon' },
              { value: 'after-noon', label: 'After 12 noon' },
              { value: 'agreed-time', label: 'Another agreed time' },
            ],
          },
          {
            id: 'entryReason',
            label: 'Reason for proposed entry',
            type: 'select',
            required: true,
            options: [
              {
                value: 'routine-inspection',
                label: 'Routine inspection — 7 to 14 days written notice',
              },
              {
                value: 'repairs-maintenance',
                label: 'Repairs, maintenance or modification — at least 72 hours written notice',
              },
              {
                value: 'prospective-tenants',
                label: 'Show premises to prospective tenants',
              },
              {
                value: 'prospective-purchasers',
                label: 'Show premises to prospective purchasers',
              },
              {
                value: 'family-violence-form2',
                label: 'Inspection after receiving family violence Form 2 — at least 3 days',
              },
              {
                value: 'family-violence-hearing',
                label: 'Inspection before family violence court hearing — at least 3 days',
              },
              {
                value: 'other',
                label: 'Other purpose — generally 7 to 14 days written notice',
              },
            ],
          },
          {
            id: 'otherEntryPurpose',
            label: 'Other purpose for entry',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'entryReason', equals: 'other' },
          },
          {
            id: 'noticeDate',
            label: 'Date the notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'negotiationContact',
            label: 'Contact number for negotiating an alternative entry time',
            type: 'text',
            required: true,
          },
          {
            id: 'issuedBy',
            label: 'Notice issued by',
            type: 'radio',
            required: true,
            options: [
              { value: 'lessor', label: 'Lessor' },
              { value: 'property-manager', label: 'Property manager' },
            ],
          },
        ],
      },
    ],
  },

  'notice-breach-agreement-form-20': {
    documentId: 'notice-breach-agreement-form-20',
    version: 1,
    title: 'Notice to Tenant of Breach of Agreement (Form 20)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'breach',
        title: 'Breach details',
        notice: 'Form 20 is for breaches other than failure to pay rent.',
        fields: [
          {
            id: 'agreementDate',
            label: 'Date the residential tenancy agreement was made',
            type: 'date',
            required: true,
          },
          {
            id: 'breachDetails',
            label: 'Describe the breach',
            type: 'textarea',
            required: true,
            placeholder:
              'State the relevant conduct or obligation clearly and factually.',
          },
          {
            id: 'noticeDate',
            label: 'Date the breach notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'remedyRequired',
            label: 'What must the tenant do to remedy the breach?',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },

  'breach-non-payment-rent-form-21': {
    documentId: 'breach-non-payment-rent-form-21',
    version: 1,
    title: 'Breach Notice for Non-payment of Rent (Form 21)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'arrears',
        title: 'Rent arrears',
        fields: [
          {
            id: 'rentArrearsAmount',
            label: 'Current rent arrears',
            type: 'currency',
            required: true,
          },
          {
            id: 'arrearsCalculatedTo',
            label: 'Arrears calculated to',
            type: 'date',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Date the breach notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorServiceAddress',
            label: 'Lessor address shown on the notice',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },

  'termination-family-violence-form-2': {
    documentId: 'termination-family-violence-form-2',
    version: 1,
    title: 'Termination of Tenant Interest on Grounds of Family Violence (Form 2)',
    intro:
      'This is a tenant-originated notice. The tenant giving the notice must provide qualifying supporting evidence and the information must be handled confidentially.',
    allowedRequesterRoles: ['tenant', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    reviewNotice:
      'Supporting evidence must accompany Form 2. This workflow records the evidence type but does not upload the supporting document yet; ProInspect must obtain it securely before the form can be issued.',
    sections: [
      {
        id: 'family-violence',
        title: 'Tenant notice details',
        fields: [
          {
            id: 'terminatingTenant',
            sensitive: true,
            label: 'Tenant giving this notice',
            type: 'tenant-select',
            required: true,
          },
          {
            id: 'lastTenancyDay',
            sensitive: true,
            label: 'Last day of the tenant’s interest in the tenancy',
            type: 'date',
            required: true,
          },
          {
            id: 'noticeDate',
            sensitive: true,
            label: 'Date the notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'evidenceTypes',
            sensitive: true,
            label: 'Supporting evidence available',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'dvo', label: 'Domestic violence order' },
              {
                value: 'family-court',
                label: 'Family Court injunction or application',
              },
              {
                value: 'prosecution',
                label: 'Prosecution notice, indictment or court conviction record',
              },
              {
                value: 'family-violence-report',
                label: 'Approved family violence evidence report',
              },
            ],
          },
          {
            id: 'evidenceReady',
            sensitive: true,
            label: 'I understand qualifying evidence must accompany the Form 2 and can be supplied securely to ProInspect',
            type: 'checkbox',
            required: true,
          },
        ],
      },
    ],
  },

  'termination-non-payment-rent-form-1a': {
    documentId: 'termination-non-payment-rent-form-1a',
    version: 1,
    title: 'Notice of Termination for Non-payment of Rent (Form 1A)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'termination',
        title: 'Termination after Form 21 breach notice',
        notice:
          'Form 1A is only used where a Form 21 breach notice was given at least 14 days earlier.',
        fields: [
          {
            id: 'form21Issued',
            label: 'Was Form 21 previously given to the tenant?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'form21Date',
            label: 'Date Form 21 was given',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'form21Issued', equals: 'yes' },
          },
          {
            id: 'rentStillOutstanding',
            label: 'Does rent remain unpaid?',
            type: 'radio',
            required: true,
            options: yesNo,
          },
          {
            id: 'outstandingRentAmount',
            label: 'Outstanding rent amount',
            type: 'currency',
            required: true,
            showWhen: { fieldId: 'rentStillOutstanding', equals: 'yes' },
          },
          {
            id: 'noticeDate',
            label: 'Date the termination notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'vacantPossessionDate',
            label: 'Date vacant possession is required',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorServiceAddress',
            label: 'Lessor / property manager address for the notice',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },

  'termination-non-payment-rent-form-1b': {
    documentId: 'termination-non-payment-rent-form-1b',
    version: 1,
    title: 'Notice of Termination for Non-payment of Rent (Form 1B)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'termination',
        title: 'Termination without prior Form 21',
        notice:
          'Form 1B is only used where a breach notice for non-payment of rent has not been given.',
        fields: [
          {
            id: 'priorForm21',
            label: 'Confirm that Form 21 has not already been given',
            type: 'radio',
            required: true,
            options: [
              { value: 'not-issued', label: 'Form 21 has not been issued' },
              {
                value: 'issued',
                label: 'Form 21 has already been issued — Form 1A should be considered instead',
              },
            ],
          },
          {
            id: 'outstandingRentAmount',
            label: 'Current outstanding rent',
            type: 'currency',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Date the termination notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'vacantPossessionDate',
            label: 'Date vacant possession is required',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorServiceAddress',
            label: 'Lessor / property manager address for the notice',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },

  'termination-other-than-non-payment-form-1c': {
    documentId: 'termination-other-than-non-payment-form-1c',
    version: 1,
    title: 'Notice of Termination (Form 1C)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'termination',
        title: 'Termination ground',
        notice:
          'Form 1C is not used for non-payment of rent. Only one statutory ground is selected on the final form.',
        fields: [
          {
            id: 'terminationGround',
            label: 'Ground for termination',
            type: 'select',
            required: true,
            options: [
              {
                value: 'unremedied-breach',
                label: 'Unremedied breach — at least 7 days notice after required breach process',
              },
              {
                value: 'sale-vacant-possession',
                label: 'Contract for sale requiring vacant possession — at least 30 days',
              },
              {
                value: 'no-ground-periodic',
                label: 'Periodic tenancy, no ground specified — at least 60 days',
              },
              {
                value: 'premises-unusable',
                label: 'Premises destroyed, uninhabitable, unlawful as residence or compulsorily acquired — at least 7 days',
              },
              {
                value: 'fixed-term-expiry',
                label: 'End fixed-term tenancy on expiry date — at least 30 days',
              },
              {
                value: 'social-housing-ineligible',
                label: 'Social housing eligibility ground — at least 60 days',
              },
              {
                value: 'alternative-social-housing',
                label: 'Alternative social housing offered — at least 60 days',
              },
            ],
          },
          {
            id: 'breachParticulars',
            label: 'Particulars of the unremedied breach',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'terminationGround', equals: 'unremedied-breach' },
          },
          {
            id: 'breachNoticeDate',
            label: 'Date the breach notice was given',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'terminationGround', equals: 'unremedied-breach' },
          },
          {
            id: 'premisesUnusableType',
            label: 'What happened to the premises?',
            type: 'select',
            required: true,
            options: [
              { value: 'destroyed', label: 'Destroyed' },
              { value: 'uninhabitable', label: 'Rendered uninhabitable' },
              {
                value: 'unlawful-residence',
                label: 'Ceased to be lawfully usable as a residence',
              },
              {
                value: 'compulsory-acquisition',
                label: 'Appropriated or acquired by compulsory process',
              },
            ],
            showWhen: { fieldId: 'terminationGround', equals: 'premises-unusable' },
          },
          {
            id: 'premisesUnusableReason',
            label: 'Why does this ground apply?',
            type: 'textarea',
            required: true,
            showWhen: { fieldId: 'terminationGround', equals: 'premises-unusable' },
          },
          {
            id: 'fixedTermExpiryDate',
            label: 'Fixed-term expiry date',
            type: 'date',
            required: true,
            showWhen: { fieldId: 'terminationGround', equals: 'fixed-term-expiry' },
          },
          {
            id: 'noticeDate',
            label: 'Date the termination notice will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'vacantPossessionDate',
            label: 'Date vacant possession is required',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorServiceAddress',
            label: 'Lessor / property manager address for the notice',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },

  'former-tenant-disposal-goods-form-cp2': {
    documentId: 'former-tenant-disposal-goods-form-cp2',
    version: 1,
    title: 'Notice to Former Tenant as to Disposal of Goods (Form CP2)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'goods',
        title: 'Goods left at the premises',
        fields: [
          {
            id: 'formerTenantForwardingAddress',
            label: 'Former tenant forwarding address',
            type: 'textarea',
            required: true,
          },
          {
            id: 'tenancyTerminationDate',
            label: 'Date the tenancy ended',
            type: 'date',
            required: true,
          },
          {
            id: 'goodsDescription',
            label: 'Describe the goods left at the premises',
            type: 'textarea',
            required: true,
          },
          {
            id: 'storageDate',
            label: 'Date the goods were put into storage',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorContactForGoods',
            label: 'Lessor postal or email address for reclaiming the goods',
            type: 'textarea',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Date of notice',
            type: 'date',
            required: true,
          },
        ],
      },
    ],
  },

  'disposal-goods-form-3': {
    documentId: 'disposal-goods-form-3',
    version: 1,
    title: 'Notice as to Disposal of Goods (Form 3)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'goods',
        title: 'Goods and storage',
        fields: [
          {
            id: 'tenancyTerminationDate',
            label: 'Date the tenancy ended',
            type: 'date',
            required: true,
          },
          {
            id: 'goodsDescription',
            label: 'Describe the goods left at the premises',
            type: 'textarea',
            required: true,
          },
          {
            id: 'storageDate',
            label: 'Date the goods were put into storage',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorContactForGoods',
            label: 'Lessor postal or email address',
            type: 'textarea',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Date of notice',
            type: 'date',
            required: true,
          },
        ],
      },
    ],
  },

  'abandonment-premises-form-12': {
    documentId: 'abandonment-premises-form-12',
    version: 1,
    title: 'Notice to Tenant of Abandonment of Premises (Form 12)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'abandonment',
        title: 'Basis for suspected abandonment',
        fields: [
          {
            id: 'rentUnpaid',
            label: 'Rent is unpaid',
            type: 'checkbox',
            required: true,
          },
          {
            id: 'additionalAbandonmentGrounds',
            label: 'Other observed grounds',
            type: 'multiselect',
            required: true,
            options: [
              {
                value: 'uncollected-mail',
                label: 'Uncollected mail, newspapers or other material',
              },
              {
                value: 'reports',
                label: 'Reports from neighbours or others indicating abandonment',
              },
              {
                value: 'no-household-goods',
                label: 'Absence of household goods',
              },
              {
                value: 'services-disconnected',
                label: 'Gas, electricity, telephone or other services disconnected',
              },
            ],
          },
          {
            id: 'supportingObservations',
            label: 'Supporting observations',
            type: 'textarea',
            required: true,
            placeholder:
              'Record the factual observations, dates and contact attempts supporting the suspected abandonment.',
          },
          {
            id: 'noticeDate',
            label: 'Date the Form 12 will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorContactAddress',
            label: 'Lessor / property manager address',
            type: 'textarea',
            required: true,
          },
          {
            id: 'lessorContactPhone',
            label: 'Lessor / property manager phone number',
            type: 'text',
            required: true,
          },
        ],
      },
    ],
  },

  'termination-premises-abandoned-form-13': {
    documentId: 'termination-premises-abandoned-form-13',
    version: 1,
    title: 'Notice of Termination if Premises Abandoned (Form 13)',
    allowedRequesterRoles: ['lessor', 'property-manager', 'other'],
    minimumLessors: 1,
    minimumTenants: 1,
    sections: [
      {
        id: 'abandonment',
        title: 'Abandonment termination details',
        fields: [
          {
            id: 'form12PreviouslyIssued',
            label: 'Was Form 12 previously issued?',
            type: 'radio',
            required: true,
            options: yesNo,
            help:
              'The official Form 13 itself does not require a Form 12 reference, but recording the prior action helps ProInspect review the request.',
          },
          {
            id: 'form12Date',
            label: 'Date Form 12 was given',
            type: 'date',
            showWhen: { fieldId: 'form12PreviouslyIssued', equals: 'yes' },
          },
          {
            id: 'rentUnpaid',
            label: 'Rent remains unpaid',
            type: 'checkbox',
            required: true,
          },
          {
            id: 'additionalAbandonmentGrounds',
            label: 'Other observed grounds',
            type: 'multiselect',
            required: true,
            options: [
              {
                value: 'uncollected-mail',
                label: 'Uncollected mail, newspapers or other material',
              },
              {
                value: 'reports',
                label: 'Reports from neighbours or others indicating abandonment',
              },
              {
                value: 'no-household-goods',
                label: 'Absence of household goods',
              },
              {
                value: 'services-disconnected',
                label: 'Services disconnected',
              },
            ],
          },
          {
            id: 'supportingObservations',
            label: 'Supporting observations',
            type: 'textarea',
            required: true,
          },
          {
            id: 'noticeDate',
            label: 'Date the Form 13 will be given',
            type: 'date',
            required: true,
          },
          {
            id: 'lessorServiceAddress',
            label: 'Lessor / property manager address for the notice',
            type: 'textarea',
            required: true,
          },
        ],
      },
    ],
  },
};

export function getDocumentWorkflowDefinition(
  documentId: string
): DocumentWorkflowDefinition | undefined {
  return DOCUMENT_WORKFLOW_DEFINITIONS[documentId];
}

export function isWorkflowFieldVisible(
  field: DocumentWorkflowField,
  answers: Record<string, DocumentWorkflowAnswer>
): boolean {
  if (!field.showWhen) return true;

  const value = answers[field.showWhen.fieldId];
  const condition = field.showWhen;

  if (condition.equals !== undefined) {
    return value === condition.equals;
  }

  if (condition.notEquals !== undefined) {
    return (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      value !== condition.notEquals
    );
  }

  if (condition.includes !== undefined) {
    return Array.isArray(value) && value.includes(condition.includes);
  }

  return true;
}

export function isWorkflowAnswerPresent(
  field: DocumentWorkflowField,
  value: DocumentWorkflowAnswer | undefined
): boolean {
  if (field.type === 'checkbox') return value === true;
  if (field.type === 'multiselect') return Array.isArray(value) && value.length > 0;
  if (
    field.type === 'party-electronic-consents' ||
    field.type === 'party-payouts'
  ) {
    return Boolean(value && typeof value === 'object');
  }

  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

export function sensitiveWorkflowFieldIds(
  definition: DocumentWorkflowDefinition
): Set<string> {
  return new Set(
    definition.sections
      .flatMap((section) => section.fields)
      .filter((field) => field.sensitive)
      .map((field) => field.id)
  );
}
