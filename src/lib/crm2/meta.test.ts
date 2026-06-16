import { describe, it, expect } from 'vitest';
import {
  verifyMetaSignature, signMetaPayload, extractLeadgenEvents, mapMetaFields, inferCategory,
} from './meta';

const SECRET = 'test_app_secret_value';

describe('verifyMetaSignature', () => {
  const raw = Buffer.from(JSON.stringify({ object: 'page', entry: [] }), 'utf8');

  it('accepts a correctly signed payload', () => {
    const sig = signMetaPayload(raw, SECRET);
    expect(verifyMetaSignature(raw, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body (same length)', () => {
    const sig = signMetaPayload(raw, SECRET);
    const tampered = Buffer.from(raw); tampered[0] = tampered[0] ^ 0xff;
    expect(verifyMetaSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const sig = signMetaPayload(raw, 'other_secret');
    expect(verifyMetaSignature(raw, sig, SECRET)).toBe(false);
  });

  it('fails closed when the secret is empty', () => {
    expect(verifyMetaSignature(raw, signMetaPayload(raw, SECRET), '')).toBe(false);
  });

  it('rejects missing / malformed headers', () => {
    expect(verifyMetaSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, 'md5=abcd', SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=zzzz', SECRET)).toBe(false); // non-hex
    expect(verifyMetaSignature(raw, 'sha256=ab', SECRET)).toBe(false);    // length mismatch
  });

  it('rejects an empty / missing body', () => {
    const sig = signMetaPayload(raw, SECRET);
    expect(verifyMetaSignature(undefined, sig, SECRET)).toBe(false);
    expect(verifyMetaSignature(Buffer.alloc(0), sig, SECRET)).toBe(false);
  });

  it('accepts a header passed as a one-element array (Node header shape)', () => {
    const sig = signMetaPayload(raw, SECRET);
    expect(verifyMetaSignature(raw, [sig], SECRET)).toBe(true);
  });
});

describe('extractLeadgenEvents', () => {
  it('pulls a leadgen_id out of the page envelope', () => {
    const body = {
      object: 'page',
      entry: [{
        id: '111', time: 1700000000,
        changes: [{ field: 'leadgen', value: {
          leadgen_id: 'LG-1', page_id: '111', form_id: 'F-9', ad_id: 'A-3', created_time: 1700000000,
        } }],
      }],
    };
    expect(extractLeadgenEvents(body)).toEqual([
      { leadgenId: 'LG-1', pageId: '111', formId: 'F-9', adId: 'A-3', createdTime: '1700000000' },
    ]);
  });

  it('falls back to entry.id for pageId when value.page_id is absent', () => {
    const body = { object: 'page', entry: [{ id: '222', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG-2' } }] }] };
    expect(extractLeadgenEvents(body)[0]).toMatchObject({ leadgenId: 'LG-2', pageId: '222', formId: null });
  });

  it('handles multiple entries / changes', () => {
    const body = {
      object: 'page',
      entry: [
        { id: '1', changes: [{ field: 'leadgen', value: { leadgen_id: 'A' } }, { field: 'feed', value: {} }] },
        { id: '2', changes: [{ field: 'leadgen', value: { leadgen_id: 'B' } }] },
      ],
    };
    expect(extractLeadgenEvents(body).map((e) => e.leadgenId)).toEqual(['A', 'B']);
  });

  it('ignores non-page objects, non-leadgen changes, and missing ids', () => {
    expect(extractLeadgenEvents({ object: 'user', entry: [] })).toEqual([]);
    expect(extractLeadgenEvents({ object: 'page', entry: [{ id: '1', changes: [{ field: 'feed', value: {} }] }] })).toEqual([]);
    expect(extractLeadgenEvents({ object: 'page', entry: [{ id: '1', changes: [{ field: 'leadgen', value: {} }] }] })).toEqual([]);
    expect(extractLeadgenEvents(null)).toEqual([]);
    expect(extractLeadgenEvents('nope')).toEqual([]);
  });
});

describe('mapMetaFields', () => {
  const fd = (name: string, value: string) => ({ name, values: [value] });

  it('maps standard full_name / phone / email / city', () => {
    const m = mapMetaFields([
      fd('full_name', '  Asha Rao '), fd('phone_number', '+91 97010 97333'),
      fd('email', 'ASHA@Example.com'), fd('city', 'Hyderabad'),
    ]);
    expect(m).toEqual({
      name: 'Asha Rao', mobile: '9701097333', email: 'ASHA@Example.com', city: 'Hyderabad',
      productInterest: null, category: null,
    });
  });

  it('joins first_name + last_name when full_name is absent', () => {
    const m = mapMetaFields([fd('first_name', 'Asha'), fd('last_name', 'Rao'), fd('phone', '9701097333')]);
    expect(m.name).toBe('Asha Rao');
  });

  it('normalises the phone and returns null for an invalid one', () => {
    expect(mapMetaFields([fd('phone', '12345')]).mobile).toBeNull();
    expect(mapMetaFields([fd('mobile_number', '919701097333')]).mobile).toBe('9701097333');
  });

  it('matches alias field names and is case-insensitive', () => {
    const m = mapMetaFields([fd('Your_Name', 'Ravi'), fd('contact_number', '9876543210'), fd('work_email', 'r@x.io')]);
    expect(m).toMatchObject({ name: 'Ravi', mobile: '9876543210', email: 'r@x.io' });
  });

  it('returns nulls (incl. product/category) for empty / missing data', () => {
    const empty = { name: null, mobile: null, email: null, city: null, productInterest: null, category: null };
    expect(mapMetaFields([])).toEqual(empty);
    expect(mapMetaFields(null)).toEqual(empty);
  });

  it('captures the product answer + infers the vertical', () => {
    const m = mapMetaFields([fd('full_name', 'A'), fd('phone', '9701097333'), fd('loan_type', 'Home Loan')]);
    expect(m.productInterest).toBe('Home Loan');
    expect(m.category).toBe('LOAN');
  });

  it('matches product aliases (interested_in / which_loan / select_product)', () => {
    expect(mapMetaFields([fd('interested_in', 'SIP / Mutual Funds')]).category).toBe('WEALTH');
    expect(mapMetaFields([fd('which_loan', 'LAP')]).category).toBe('LOAN');
    expect(mapMetaFields([fd('select_product', 'Term Insurance')]).category).toBe('INSURANCE');
  });

  it('leaves product null when the form asked no product question', () => {
    const m = mapMetaFields([fd('full_name', 'A'), fd('phone', '9701097333')]);
    expect(m.productInterest).toBeNull();
    expect(m.category).toBeNull();
  });
});

describe('inferCategory', () => {
  it('infers LOAN / WEALTH / INSURANCE from keywords', () => {
    expect(inferCategory('Home Loan')).toBe('LOAN');
    expect(inferCategory('Loan Against Property')).toBe('LOAN');
    expect(inferCategory('Balance Transfer')).toBe('LOAN');
    expect(inferCategory('SIP')).toBe('WEALTH');
    expect(inferCategory('Mutual Fund investment')).toBe('WEALTH');
    expect(inferCategory('Term Insurance')).toBe('INSURANCE');
    expect(inferCategory('Health cover / mediclaim')).toBe('INSURANCE');
  });
  it('prefers INSURANCE when "term"/"health" would otherwise mislead', () => {
    expect(inferCategory('term plan')).toBe('INSURANCE');
  });
  it('returns null for nothing / unknown', () => {
    expect(inferCategory(null)).toBeNull();
    expect(inferCategory('')).toBeNull();
    expect(inferCategory('just curious')).toBeNull();
  });
});
