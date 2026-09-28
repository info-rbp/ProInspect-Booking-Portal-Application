import type { DocumentProduct } from '../types/platform';

const standardResidential =
  'Preparation of the selected residential tenancy document for client review, issue and storage.';
const standardCommercial =
  'Preparation of a commercial property document from supplied instructions, subject to ProInspect review before issue.';
const standardStrata =
  'Preparation or collation of a strata / building document from supplied property and scheme information, subject to review before issue.';

export const DEFAULT_DOCUMENT_PRODUCTS: DocumentProduct[] = [
  { id:'residential-tenancy-agreement', name:'Residential Tenancy Agreement', formCode:'Form 1AA', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:250, active:true, publiclyRequestable:true, order:1, badge:'Lease agreement' },
  { id:'security-bond-lodgement', name:'Security Bond Lodgement Form Preparation', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:2 },
  { id:'security-bond-variation', name:'Security Bond Variation Form', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:3 },
  { id:'security-bond-disposal', name:'Joint Application for Disposal of Security Bond', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:4 },
  { id:'rent-increase-notice', name:'Notice of Rent Increase', formCode:'Form 10', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:5 },
  { id:'proposed-entry-notice', name:'Notice of Proposed Entry to Premises', formCode:'Form 19', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:6 },
  { id:'breach-notice', name:'Notice to Tenant of Breach of Agreement', formCode:'Form 20', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:7 },
  { id:'rent-breach-notice', name:'Breach Notice for Non-Payment of Rent', formCode:'Form 21', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:8 },
  { id:'termination-non-payment', name:'Termination Notice for Non-Payment of Rent', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:9 },
  { id:'termination-other', name:'Termination Notice – Other Grounds', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:10 },
  { id:'abandonment-notice', name:'Abandonment / Disposal Notice', publicDescription:standardResidential, categories:['residential'], pricingMode:'fixed', priceExGst:100, active:true, publiclyRequestable:true, order:11 },

  { id:'commercial-lease', name:'Commercial Lease', publicDescription:standardCommercial, categories:['commercial'], pricingMode:'quote', active:true, publiclyRequestable:true, order:100, badge:'Commercial' },
  { id:'commercial-lease-variation', name:'Commercial Lease Variation', publicDescription:standardCommercial, categories:['commercial'], pricingMode:'quote', active:true, publiclyRequestable:true, order:101 },
  { id:'commercial-lease-renewal', name:'Commercial Lease Renewal / Extension', publicDescription:standardCommercial, categories:['commercial'], pricingMode:'quote', active:true, publiclyRequestable:true, order:102 },
  { id:'commercial-notice-letter', name:'Commercial Notice / Formal Letter', publicDescription:standardCommercial, categories:['commercial'], pricingMode:'quote', active:true, publiclyRequestable:true, order:103 },
  { id:'commercial-authority-agreement', name:'Commercial Authority / Agreement', publicDescription:standardCommercial, categories:['commercial'], pricingMode:'quote', active:true, publiclyRequestable:true, order:104 },

  { id:'strata-owner-notice', name:'Strata Owner / Occupier Notice', publicDescription:standardStrata, categories:['strata-building'], pricingMode:'quote', active:true, publiclyRequestable:true, order:200, badge:'Strata / Building' },
  { id:'strata-bylaw-document', name:'By-law / Building Rule Document', publicDescription:standardStrata, categories:['strata-building'], pricingMode:'quote', active:true, publiclyRequestable:true, order:201 },
  { id:'strata-meeting-document', name:'Meeting / Resolution Document', publicDescription:standardStrata, categories:['strata-building'], pricingMode:'quote', active:true, publiclyRequestable:true, order:202 },
  { id:'strata-compliance-document', name:'Compliance / Contractor Document', publicDescription:standardStrata, categories:['strata-building'], pricingMode:'quote', active:true, publiclyRequestable:true, order:203 },
  { id:'strata-correspondence', name:'Strata / Building Correspondence', publicDescription:standardStrata, categories:['strata-building'], pricingMode:'quote', active:true, publiclyRequestable:true, order:204 },
];
