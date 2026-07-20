import { describe, it, expect } from 'vitest';
import {
  isCrm2Lead, isLeadDeleted, leadBucket, isLeadConverted, isLeadTerminal, isLeadOpen,
  leadOwner, leadName, leadMobile, leadCreatedMs, leadAttempted, LEAD_TERMINAL, LEAD_BUCKETS,
} from './leadModel';

const ts = (m: number) => ({ toMillis: () => m });

describe('leadModel — model discrimination', () => {
  it('CRM 2.0 lead has receivedAt', () => {
    expect(isCrm2Lead({ receivedAt: ts(1) })).toBe(true);
    expect(isCrm2Lead({ createdAt: ts(1) })).toBe(false);
    expect(isCrm2Lead({})).toBe(false);
  });
});

describe('leadModel — deleted trap', () => {
  it('only deleted===true counts as deleted (missing field is NOT deleted)', () => {
    expect(isLeadDeleted({ deleted: true })).toBe(true);
    expect(isLeadDeleted({ deleted: false })).toBe(false);
    expect(isLeadDeleted({})).toBe(false);              // CRM 2.0 omits the field
    expect(isLeadDeleted({ receivedAt: ts(1) })).toBe(false);
  });
});

describe('leadModel — unified status buckets', () => {
  it('old-model leadStatus passes through, unknown → new', () => {
    expect(leadBucket({ leadStatus: 'interested' })).toBe('interested');
    expect(leadBucket({ leadStatus: 'not_eligible' })).toBe('not_eligible');
    expect(leadBucket({ leadStatus: 'zzz' })).toBe('new');
    expect(leadBucket({})).toBe('new');
  });
  it('CRM 2.0 status maps into the same buckets', () => {
    expect(leadBucket({ receivedAt: ts(1), status: 'NEW' })).toBe('new');
    expect(leadBucket({ receivedAt: ts(1), status: 'ATTEMPTED' })).toBe('new');
    expect(leadBucket({ receivedAt: ts(1), status: 'CONTACTED' })).toBe('interested');
    expect(leadBucket({ receivedAt: ts(1), status: 'QUALIFIED' })).toBe('interested');
    expect(leadBucket({ receivedAt: ts(1), status: 'NOT_INTERESTED' })).toBe('not_interested');
    expect(leadBucket({ receivedAt: ts(1), status: 'NOT_ELIGIBLE' })).toBe('not_eligible');
    expect(leadBucket({ receivedAt: ts(1), status: 'DROPPED' })).toBe('no_response');
    expect(leadBucket({ receivedAt: ts(1), status: 'JUNK_DUPLICATE' })).toBe('wrong_number');
  });
  it('converted wins on both models', () => {
    expect(leadBucket({ receivedAt: ts(1), status: 'CONVERTED' })).toBe('converted');
    expect(leadBucket({ receivedAt: ts(1), converted: true, status: 'CONTACTED' })).toBe('converted');
    expect(leadBucket({ leadStatus: 'converted' })).toBe('converted');
  });
});

describe('leadModel — terminal / open / converted', () => {
  it('terminal set is the 5 closed buckets', () => {
    expect([...LEAD_TERMINAL].sort()).toEqual(
      ['converted', 'no_response', 'not_eligible', 'not_interested', 'wrong_number']);
    expect(LEAD_BUCKETS).toHaveLength(8);
  });
  it('open = not deleted and not terminal', () => {
    expect(isLeadOpen({ leadStatus: 'interested' })).toBe(true);
    expect(isLeadOpen({ leadStatus: 'not_interested' })).toBe(false);
    expect(isLeadOpen({ leadStatus: 'interested', deleted: true })).toBe(false);
    expect(isLeadOpen({ receivedAt: ts(1), status: 'CONTACTED' })).toBe(true);
    expect(isLeadOpen({ receivedAt: ts(1), status: 'CONVERTED' })).toBe(false);
  });
  it('converted / terminal flags', () => {
    expect(isLeadConverted({ receivedAt: ts(1), status: 'CONVERTED' })).toBe(true);
    expect(isLeadTerminal({ leadStatus: 'wrong_number' })).toBe(true);
    expect(isLeadTerminal({ leadStatus: 'new' })).toBe(false);
  });
});

describe('leadModel — owner (uid vs FAPL)', () => {
  it('old-model owner is a uid', () => {
    expect(leadOwner({ primaryOwnerId: 'abc123' })).toEqual({ kind: 'uid', value: 'abc123' });
    expect(leadOwner({ primaryOwnerId: 'UNASSIGNED' })).toEqual({ kind: 'uid', value: null });
    expect(leadOwner({})).toEqual({ kind: 'uid', value: null });
  });
  it('CRM 2.0 owner is a FAPL code', () => {
    expect(leadOwner({ receivedAt: ts(1), assignedRm: 'FAPL-022' })).toEqual({ kind: 'fapl', value: 'FAPL-022' });
    expect(leadOwner({ receivedAt: ts(1), assignedRm: null })).toEqual({ kind: 'fapl', value: null });
  });
});

describe('leadModel — name / mobile / timestamps', () => {
  it('name + mobile pick the right field per model', () => {
    expect(leadName({ displayName: 'Cold Cust' })).toBe('Cold Cust');
    expect(leadName({ receivedAt: ts(1), name: 'Qualified' })).toBe('Qualified');
    expect(leadName({ receivedAt: ts(1), leadCode: 'LD-1' })).toBe('LD-1');
    expect(leadMobile({ phone: '9999900000' })).toBe('9999900000');
    expect(leadMobile({ receivedAt: ts(1), mobile: '8888800000' })).toBe('8888800000');
  });
  it('createdMs uses receivedAt for CRM 2.0, createdAt for old', () => {
    expect(leadCreatedMs({ createdAt: ts(100) })).toBe(100);
    expect(leadCreatedMs({ receivedAt: ts(200), createdAt: ts(100) })).toBe(200);
    expect(leadAttempted({ firstContactedAt: ts(5) })).toBe(true);
    expect(leadAttempted({})).toBe(false);
  });
});
