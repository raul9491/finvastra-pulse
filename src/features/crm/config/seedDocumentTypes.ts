import { collection, getDocs, writeBatch, doc, query, limit } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

interface SeedDocumentType {
  id: string;  // used as the Firestore document ID for stable, predictable lookups
  label: string;
}

const DOCUMENT_TYPES: SeedDocumentType[] = [
  { id: 'pan_applicant',               label: 'PAN Card (Applicant)' },
  { id: 'aadhaar_applicant',           label: 'Aadhaar Card (Applicant)' },
  { id: 'photo_applicant',             label: 'Passport Photo (Applicant)' },
  { id: 'address_proof',               label: 'Address Proof' },
  { id: 'income_proof',                label: 'Income Proof' },
  { id: 'salary_slips_3m',             label: 'Salary Slips (3 months)' },
  { id: 'form_16',                     label: 'Form 16' },
  { id: 'bank_statement_3m',           label: 'Bank Statement (3 months)' },
  { id: 'bank_statement_6m',           label: 'Bank Statement (6 months)' },
  { id: 'bank_statement_12m',          label: 'Bank Statement (12 months)' },
  { id: 'employment_letter',           label: 'Employment Letter' },
  { id: 'itr_3y',                      label: 'ITR (3 years)' },
  { id: 'gst_certificate',             label: 'GST Certificate' },
  { id: 'gst_returns_12m',             label: 'GST Returns (12 months)' },
  { id: 'audited_financials',          label: 'Audited Financials' },
  { id: 'business_pan',                label: 'Business PAN' },
  { id: 'business_registration',       label: 'Business Registration Certificate' },
  { id: 'sale_agreement',              label: 'Sale Agreement' },
  { id: 'title_deed',                  label: 'Title Deed' },
  { id: 'encumbrance_certificate',     label: 'Encumbrance Certificate' },
  { id: 'khata_extract',               label: 'Khata Extract' },
  { id: 'approved_building_plan',      label: 'Approved Building Plan' },
  { id: 'noc_builder',                 label: 'NOC from Builder' },
  { id: 'property_tax_receipts',       label: 'Property Tax Receipts' },
  { id: 'collateral_docs',             label: 'Collateral Documents' },
  { id: 'collateral_valuation_report', label: 'Collateral Valuation Report' },
  { id: 'marksheets_10_12',            label: 'Marksheets (10th / 12th)' },
  { id: 'graduation_degree',           label: 'Graduation Degree Certificate' },
  { id: 'admission_letter',            label: 'Admission Letter' },
  { id: 'fee_structure',               label: 'Fee Structure' },
  { id: 'entrance_test_score',         label: 'Entrance Test Score Card' },
  { id: 'student_visa_docs',           label: 'Student Visa Documents' },
  { id: 'coborrower_pan',              label: 'PAN Card (Co-Borrower)' },
  { id: 'coborrower_aadhaar',          label: 'Aadhaar (Co-Borrower)' },
  { id: 'coborrower_income_proof',     label: 'Income Proof (Co-Borrower)' },
  { id: 'coborrower_bank_statement',   label: 'Bank Statement (Co-Borrower)' },
  { id: 'vehicle_quotation',           label: 'Vehicle Quotation' },
  { id: 'rc_book_copy',                label: 'RC Book Copy' },
  { id: 'vehicle_valuation_cert',      label: 'Vehicle Valuation Certificate' },
];

export async function seedDocumentTypes(): Promise<number> {
  const existing = await getDocs(query(collection(db, 'document_types'), limit(1)));
  if (!existing.empty) return 0;

  const batch = writeBatch(db);
  for (const dt of DOCUMENT_TYPES) {
    // Use the stable string ID so other collections can reference doc type IDs
    // without needing a lookup. The batch.set call with an explicit doc ref is safe
    // here because all IDs are lowercase_snake_case and guaranteed unique in this array.
    batch.set(doc(db, 'document_types', dt.id), { label: dt.label });
  }
  await batch.commit();
  return DOCUMENT_TYPES.length;
}
