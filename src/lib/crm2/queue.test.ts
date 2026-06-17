import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUEUES, queueConfigFromDoc, leadQueueCategory, queueMatchesLead,
  eligibleQueues, leadEligibleForSkills, queueForLead, isQueueableLead,
} from './queue';

const loanLead = { source: 'ADS', receivedAt: 1, category: 'LOAN' };
const wealthLead = { source: 'WEBSITE', receivedAt: 1, category: 'WEALTH' };
const generalSip = { source: 'ADS', receivedAt: 1, category: 'GENERAL', sourceMeta: { productInterest: 'SIP / Mutual Fund' } };

describe('queueConfigFromDoc', () => {
  it('falls back to defaults when absent/empty/invalid', () => {
    expect(queueConfigFromDoc(null)).toEqual(DEFAULT_QUEUES);
    expect(queueConfigFromDoc({ queues: [] })).toEqual(DEFAULT_QUEUES);
    expect(queueConfigFromDoc({ queues: [{ name: 'x' }] })).toEqual(DEFAULT_QUEUES); // no id/skill
  });
  it('parses a valid config + defaults productFilter to wildcard', () => {
    const c = queueConfigFromDoc({ queues: [{ id: 'all', name: 'All', skill: 'GEN' }] });
    expect(c).toEqual([{ id: 'all', name: 'All', productFilter: ['*'], skill: 'GEN' }]);
  });
  it('accepts the doc as a bare array too', () => {
    const c = queueConfigFromDoc([{ id: 'l', skill: 'LOANS', productFilter: ['LOAN'] }]);
    expect(c[0].id).toBe('l');
  });
});

describe('leadQueueCategory', () => {
  it('uses explicit category', () => {
    expect(leadQueueCategory(loanLead)).toBe('LOAN');
  });
  it('infers from productInterest when GENERAL', () => {
    expect(leadQueueCategory(generalSip)).toBe('WEALTH');
  });
  it('falls back to GENERAL', () => {
    expect(leadQueueCategory({ category: 'GENERAL' })).toBe('GENERAL');
  });
});

describe('queueMatchesLead', () => {
  it('wildcard matches everything', () => {
    expect(queueMatchesLead({ id: 'a', name: 'A', productFilter: ['*'], skill: 'X' }, loanLead)).toBe(true);
    expect(queueMatchesLead({ id: 'a', name: 'A', productFilter: ['*'], skill: 'X' }, wealthLead)).toBe(true);
  });
  it('category-specific matches only its category', () => {
    const loans = DEFAULT_QUEUES[0];
    expect(queueMatchesLead(loans, loanLead)).toBe(true);
    expect(queueMatchesLead(loans, wealthLead)).toBe(false);
  });
});

describe('eligibleQueues / leadEligibleForSkills', () => {
  it('empty/unset skills → eligible for ALL queues', () => {
    expect(eligibleQueues(DEFAULT_QUEUES, [])).toEqual(DEFAULT_QUEUES);
    expect(eligibleQueues(DEFAULT_QUEUES, null)).toEqual(DEFAULT_QUEUES);
    expect(leadEligibleForSkills(DEFAULT_QUEUES, [], wealthLead)).toBe(true);
  });
  it('skill gating: a LOANS-only telecaller cannot pull WEALTH leads', () => {
    expect(eligibleQueues(DEFAULT_QUEUES, ['LOANS']).map((q) => q.id)).toEqual(['loans']);
    expect(leadEligibleForSkills(DEFAULT_QUEUES, ['LOANS'], loanLead)).toBe(true);
    expect(leadEligibleForSkills(DEFAULT_QUEUES, ['LOANS'], wealthLead)).toBe(false);
    expect(leadEligibleForSkills(DEFAULT_QUEUES, ['SIP'], wealthLead)).toBe(true);
  });
  it('skill match is case-insensitive', () => {
    expect(eligibleQueues(DEFAULT_QUEUES, ['loans']).map((q) => q.id)).toEqual(['loans']);
  });
  it('single shared ["*"] queue serves every skill', () => {
    const single = [{ id: 'q', name: 'Shared', productFilter: ['*'], skill: 'ALL' }];
    expect(leadEligibleForSkills(single, [], loanLead)).toBe(true);
    expect(leadEligibleForSkills(single, ['ALL'], wealthLead)).toBe(true);
  });
});

describe('queueForLead / isQueueableLead', () => {
  it('buckets a lead into its first matching queue', () => {
    expect(queueForLead(DEFAULT_QUEUES, loanLead)?.id).toBe('loans');
    expect(queueForLead(DEFAULT_QUEUES, generalSip)?.id).toBe('sip');
  });
  it('only warm-inbound CRM 2.0 leads are queueable', () => {
    expect(isQueueableLead(loanLead)).toBe(true);                              // ADS + receivedAt
    expect(isQueueableLead(wealthLead)).toBe(true);                            // WEBSITE + receivedAt
    expect(isQueueableLead({ source: 'offline_bulk', receivedAt: 1 })).toBe(false);   // cold bulk
    expect(isQueueableLead({ source: 'ADS' })).toBe(false);                    // no receivedAt (old-model)
    expect(isQueueableLead({ source: 'WALKIN', receivedAt: 1 })).toBe(false);  // manual
  });
});
