import type { OpportunityType, ProviderType, CustomFieldDefinition, DocumentTypeId, ConditionalDocumentRule } from '../../../types';

// ─── Opportunity Types ────────────────────────────────────────────────────────

const LOAN_STAGES = [
  'New', 'Contacted', 'Documents Collected', 'Submitted to Bank',
  'Under Review', 'Sanctioned', 'Disbursed',
];
const WEALTH_STAGES = [
  'New', 'Discovery', 'Risk Profiling', 'Proposal', 'KYC', 'Invested', 'Active',
];
const INSURANCE_STAGES = [
  'New', 'Needs Assessment', 'Quote', 'Proposal', 'Medical / Docs',
  'Underwriting', 'Policy Issued', 'Renewal Due',
];

interface SeedOpportunityType {
  name: string;
  businessLine: OpportunityType;
  stages: string[];
  active: boolean;
  customFieldsSchema?: Record<string, CustomFieldDefinition>;
  requiredDocuments?: DocumentTypeId[];
  conditionalDocuments?: ConditionalDocumentRule[];
  // NOTE: eligibleProviderIds here contain provider NAMES used as lookup keys during seed.
  // After seeding, seedCrmConfig resolves these to actual Firestore IDs.
  eligibleProviderIds?: string[];
}

export const SEED_OPPORTUNITY_TYPES: SeedOpportunityType[] = [
  // ─── Loans ─────────────────────────────────────────────────────────────────
  {
    name: 'Home Loan',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      propertyType:      { type: 'enum',   label: 'Property Type',        required: true,  options: ['apartment', 'villa', 'plot', 'under_construction', 'ready_to_move'] },
      propertyAddress:   { type: 'text',   label: 'Property Address',     required: true  },
      propertyValue:     { type: 'number', label: 'Property Value (₹)',   required: true  },
      propertyAgeYears:  { type: 'number', label: 'Property Age (years)', required: true  },
      builderName:       { type: 'text',   label: 'Builder Name',         required: false },
      tenureMonths:      { type: 'number', label: 'Tenure (months)',       required: true,  min: 60, max: 360 },
      loanToValuePct:    { type: 'number', label: 'LTV %',                required: false, min: 50, max: 90 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'photo_applicant', 'address_proof',
      'income_proof', 'bank_statement_6m', 'sale_agreement', 'title_deed',
      'encumbrance_certificate', 'khata_extract', 'approved_building_plan',
      'noc_builder', 'property_tax_receipts',
    ],
    conditionalDocuments: [],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'LIC Housing Finance', 'PNB Housing Finance', 'Aditya Birla Housing',
      'Tata Capital', 'IDFC First Bank',
    ],
  },
  {
    name: 'LAP',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      propertyType:        { type: 'enum',    label: 'Property Type',       required: true,  options: ['residential', 'commercial', 'industrial'] },
      propertyAddress:     { type: 'text',    label: 'Property Address',    required: true  },
      propertyValue:       { type: 'number',  label: 'Property Value (₹)',  required: true  },
      existingEncumbrance: { type: 'boolean', label: 'Existing Encumbrance',required: true  },
      loanPurpose:         { type: 'text',    label: 'Loan Purpose',        required: true  },
      tenureMonths:        { type: 'number',  label: 'Tenure (months)',     required: true,  min: 60, max: 180 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'photo_applicant', 'address_proof',
      'income_proof', 'bank_statement_6m', 'title_deed', 'encumbrance_certificate',
      'khata_extract', 'property_tax_receipts',
    ],
    conditionalDocuments: [],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'LIC Housing Finance', 'Bajaj Finserv', 'Tata Capital',
    ],
  },
  {
    name: 'Personal Loan',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      employmentType:        { type: 'enum',   label: 'Employment Type',          required: true,  options: ['salaried', 'self_employed'] },
      employerName:          { type: 'text',   label: 'Employer Name',            required: true  },
      monthlyIncome:         { type: 'number', label: 'Monthly Income (₹)',       required: true  },
      totalExperienceYears:  { type: 'number', label: 'Total Experience (years)', required: true  },
      currentEmployerYears:  { type: 'number', label: 'Current Employer (years)', required: true  },
      tenureMonths:          { type: 'number', label: 'Tenure (months)',          required: true,  min: 12, max: 60 },
      purpose:               { type: 'text',   label: 'Purpose',                  required: false },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'photo_applicant', 'address_proof',
      'salary_slips_3m', 'form_16', 'bank_statement_3m', 'employment_letter',
    ],
    conditionalDocuments: [],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'IDFC First Bank', 'IndusInd Bank', 'Bajaj Finserv', 'Tata Capital',
      'Aditya Birla Housing',
    ],
  },
  {
    name: 'Business Loan',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      businessName:         { type: 'text',   label: 'Business Name',          required: true  },
      businessType:         { type: 'enum',   label: 'Business Type',          required: true,  options: ['proprietorship', 'partnership', 'pvt_ltd', 'llp'] },
      businessVintageYears: { type: 'number', label: 'Business Vintage (years)',required: true  },
      annualTurnover:       { type: 'number', label: 'Annual Turnover (₹)',    required: true  },
      gstNumber:            { type: 'text',   label: 'GST Number',             required: true  },
      collateralType:       { type: 'enum',   label: 'Collateral Type',        required: true,  options: ['property', 'machinery', 'inventory', 'fd', 'other'] },
      collateralValue:      { type: 'number', label: 'Collateral Value (₹)',   required: true  },
      loanPurpose:          { type: 'text',   label: 'Loan Purpose',           required: true  },
      tenureMonths:         { type: 'number', label: 'Tenure (months)',        required: true,  min: 12, max: 84 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'business_pan', 'business_registration',
      'gst_certificate', 'gst_returns_12m', 'itr_3y', 'bank_statement_12m',
      'audited_financials', 'collateral_docs', 'collateral_valuation_report',
    ],
    conditionalDocuments: [],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'Bajaj Finserv', 'Tata Capital', 'IIFL Finance',
    ],
  },
  {
    name: 'Business Loan (Unsecured)',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      businessName:            { type: 'text',   label: 'Business Name',              required: true  },
      businessType:            { type: 'enum',   label: 'Business Type',              required: true,  options: ['proprietorship', 'partnership', 'pvt_ltd', 'llp'] },
      businessVintageYears:    { type: 'number', label: 'Business Vintage (years)',   required: true  },
      monthlyGstTurnover:      { type: 'number', label: 'Monthly GST Turnover (₹)',   required: true  },
      bankingMonthlyTurnover:  { type: 'number', label: 'Monthly Banking Turnover (₹)',required: true },
      gstNumber:               { type: 'text',   label: 'GST Number',                 required: true  },
      loanPurpose:             { type: 'text',   label: 'Loan Purpose',               required: true  },
      tenureMonths:            { type: 'number', label: 'Tenure (months)',            required: true,  min: 12, max: 48 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'business_pan', 'business_registration',
      'gst_certificate', 'gst_returns_12m', 'itr_3y', 'bank_statement_12m',
    ],
    conditionalDocuments: [],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'Bajaj Finserv', 'IIFL Finance', 'Tata Capital', 'IDFC First Bank',
      'Aditya Birla Housing',
    ],
  },
  {
    name: 'Education Loan',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      studentName:          { type: 'text',   label: 'Student Name',          required: true  },
      studentRelation:      { type: 'enum',   label: 'Student Relation',      required: true,  options: ['self', 'son', 'daughter', 'spouse', 'other'] },
      instituteName:        { type: 'text',   label: 'Institute Name',        required: true  },
      courseName:           { type: 'text',   label: 'Course Name',           required: true  },
      courseDurationMonths: { type: 'number', label: 'Course Duration (months)',required: true },
      studyLocation:        { type: 'enum',   label: 'Study Location',        required: true,  options: ['india', 'abroad'] },
      studyCountry:         { type: 'text',   label: 'Study Country',         required: false },
      totalFeeAmount:       { type: 'number', label: 'Total Fee Amount (₹)',  required: true  },
      coBorrowerName:       { type: 'text',   label: 'Co-Borrower Name',      required: true  },
      coBorrowerRelation:   { type: 'enum',   label: 'Co-Borrower Relation',  required: true,  options: ['parent', 'spouse', 'sibling', 'other'] },
      moratoriumMonths:     { type: 'number', label: 'Moratorium (months)',   required: true  },
      tenureMonths:         { type: 'number', label: 'Tenure (months)',       required: true,  min: 60, max: 180 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'photo_applicant', 'marksheets_10_12',
      'admission_letter', 'fee_structure', 'coborrower_pan', 'coborrower_aadhaar',
      'coborrower_income_proof', 'coborrower_bank_statement',
    ],
    conditionalDocuments: [
      { when: { field: 'studyLocation', equals: 'abroad' },       addDocuments: ['entrance_test_score', 'student_visa_docs'] },
      { when: { field: 'courseLevel',   equals: 'postgraduate' }, addDocuments: ['graduation_degree'] },
    ],
    eligibleProviderIds: [
      'SBI', 'ICICI Bank', 'Axis Bank', 'HDFC Credila', 'Avanse',
      'Auxilo', 'PNB', 'Bank of Baroda', 'Canara Bank',
    ],
  },
  {
    name: 'Auto Loan',
    businessLine: 'loan',
    stages: LOAN_STAGES,
    active: true,
    customFieldsSchema: {
      vehicleType:       { type: 'enum',   label: 'Vehicle Type',     required: true,  options: ['new', 'used'] },
      vehicleUseType:    { type: 'enum',   label: 'Vehicle Use',      required: true,  options: ['personal', 'commercial'] },
      vehicleMake:       { type: 'text',   label: 'Vehicle Make',     required: true  },
      vehicleModel:      { type: 'text',   label: 'Vehicle Model',    required: true  },
      vehicleVariant:    { type: 'text',   label: 'Vehicle Variant',  required: false },
      vehicleYear:       { type: 'number', label: 'Vehicle Year',     required: true  },
      onRoadPrice:       { type: 'number', label: 'On-Road Price (₹)',required: true  },
      downPaymentAmount: { type: 'number', label: 'Down Payment (₹)', required: true  },
      dealerName:        { type: 'text',   label: 'Dealer Name',      required: true  },
      dealerLocation:    { type: 'text',   label: 'Dealer Location',  required: false },
      tenureMonths:      { type: 'number', label: 'Tenure (months)',  required: true,  min: 12, max: 84 },
    },
    requiredDocuments: [
      'pan_applicant', 'aadhaar_applicant', 'photo_applicant', 'address_proof',
      'income_proof', 'bank_statement_3m', 'vehicle_quotation',
    ],
    conditionalDocuments: [
      { when: { field: 'vehicleType', equals: 'used' }, addDocuments: ['rc_book_copy', 'vehicle_valuation_cert'] },
    ],
    eligibleProviderIds: [
      'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
      'Bajaj Finserv', 'Tata Capital', 'Mahindra Finance',
      'Sundaram Finance', 'Cholamandalam',
    ],
  },
  // Deactivated loan products — kept for data integrity (existing records may reference them)
  { name: 'Two-Wheeler Loan', businessLine: 'loan',      stages: LOAN_STAGES, active: false },
  { name: 'Gold Loan',        businessLine: 'loan',      stages: LOAN_STAGES, active: false },
  { name: 'Credit Card',      businessLine: 'loan',      stages: LOAN_STAGES, active: false },
  { name: 'Balance Transfer', businessLine: 'loan',      stages: LOAN_STAGES, active: false },

  // ─── Wealth (10) ────────────────────────────────────────────────────────────
  { name: 'Mutual Fund SIP',        businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'Mutual Fund Lumpsum',    businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'PMS',                    businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'AIF',                    businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'Direct Equity',          businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'Bonds',                  businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'FD / NCD',               businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'NPS',                    businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'SGB',                    businessLine: 'wealth', stages: WEALTH_STAGES, active: true },
  { name: 'Tax-Saving (ELSS/PPF)',  businessLine: 'wealth', stages: WEALTH_STAGES, active: true },

  // ─── Insurance (11) ─────────────────────────────────────────────────────────
  { name: 'Term Life',         businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Whole Life',        businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Endowment',         businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'ULIP',              businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Pension Plan',      businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Health Insurance',  businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Motor Insurance',   businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Travel Insurance',  businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Home Insurance',    businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Personal Accident', businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
  { name: 'Commercial',        businessLine: 'insurance', stages: INSURANCE_STAGES, active: true },
];

// ─── Providers ────────────────────────────────────────────────────────────────

interface SeedProvider {
  name: string;
  type: ProviderType;
  active: boolean;
  eligibleProducts?: string[];
}

export const SEED_PROVIDERS: SeedProvider[] = [
  // ─── Banks (5 core — updated with eligibleProducts) ───────────────────────
  { name: 'HDFC Bank',  type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan'] },
  { name: 'ICICI Bank', type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan', 'Education Loan'] },
  { name: 'SBI',        type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan', 'Education Loan'] },
  { name: 'Axis Bank',  type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan', 'Education Loan'] },
  { name: 'Kotak Bank', type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan'] },

  // AMCs (5)
  { name: 'HDFC AMC',      type: 'amc', active: true },
  { name: 'ICICI Pru AMC', type: 'amc', active: true },
  { name: 'SBI MF',        type: 'amc', active: true },
  { name: 'Nippon India',  type: 'amc', active: true },
  { name: 'Axis MF',       type: 'amc', active: true },

  // Life insurers (5)
  { name: 'LIC',           type: 'life_insurer', active: true },
  { name: 'HDFC Life',     type: 'life_insurer', active: true },
  { name: 'ICICI Pru Life',type: 'life_insurer', active: true },
  { name: 'SBI Life',      type: 'life_insurer', active: true },
  { name: 'Max Life',      type: 'life_insurer', active: true },

  // General insurers (5)
  { name: 'ICICI Lombard', type: 'general_insurer', active: true },
  { name: 'HDFC Ergo',     type: 'general_insurer', active: true },
  { name: 'Bajaj Allianz', type: 'general_insurer', active: true },
  { name: 'Tata AIG',      type: 'general_insurer', active: true },
  { name: 'Star Health',   type: 'general_insurer', active: true },

  // ─── Housing Finance Companies & NBFCs ────────────────────────────────────
  { name: 'LIC Housing Finance',  type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP'] },
  { name: 'PNB Housing Finance',  type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP'] },
  { name: 'Aditya Birla Housing', type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan (Unsecured)'] },
  { name: 'HDFC Credila',         type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
  { name: 'Avanse',               type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
  { name: 'Auxilo',               type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
  { name: 'Mahindra Finance',     type: 'bank', active: true, eligibleProducts: ['Auto Loan'] },
  { name: 'Sundaram Finance',     type: 'bank', active: true, eligibleProducts: ['Auto Loan'] },
  { name: 'Cholamandalam',        type: 'bank', active: true, eligibleProducts: ['Auto Loan'] },
  { name: 'IIFL Finance',         type: 'bank', active: true, eligibleProducts: ['Business Loan', 'Business Loan (Unsecured)'] },
  { name: 'IDFC First Bank',      type: 'bank', active: true, eligibleProducts: ['Personal Loan', 'Business Loan (Unsecured)', 'Home Loan'] },
  { name: 'IndusInd Bank',        type: 'bank', active: true, eligibleProducts: ['Personal Loan'] },
  { name: 'Bajaj Finserv',        type: 'bank', active: true, eligibleProducts: ['Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'LAP', 'Auto Loan'] },
  { name: 'Tata Capital',         type: 'bank', active: true, eligibleProducts: ['Home Loan', 'LAP', 'Personal Loan', 'Business Loan', 'Business Loan (Unsecured)', 'Auto Loan', 'Education Loan'] },
  { name: 'Canara Bank',          type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
  { name: 'Bank of Baroda',       type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
  { name: 'PNB',                  type: 'bank', active: true, eligibleProducts: ['Education Loan'] },
];
