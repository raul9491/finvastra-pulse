import { describe, it, expect } from 'vitest';
import {
  resolveChannelPartnerRule, computeChannelPartnerPayout, sanitizeChannelPartnerRule,
  type ChannelPartnerPayoutRule,
} from './channelPartnerPayout';

const r = (productId: string, basis: ChannelPartnerPayoutRule['basis'], value: number): ChannelPartnerPayoutRule =>
  ({ productId, basis, value });

describe('resolveChannelPartnerRule', () => {
  it('prefers an exact product match', () => {
    const rules = [r('ALL', 'FLAT', 1000), r('PRD-1', 'DISBURSED_PCT', 0.2)];
    expect(resolveChannelPartnerRule(rules, 'PRD-1')).toEqual(rules[1]);
  });
  it('falls back to ALL when no exact match', () => {
    const rules = [r('ALL', 'FLAT', 1000), r('PRD-1', 'DISBURSED_PCT', 0.2)];
    expect(resolveChannelPartnerRule(rules, 'PRD-9')).toEqual(rules[0]);
  });
  it('returns null when nothing matches and no ALL', () => {
    expect(resolveChannelPartnerRule([r('PRD-1', 'FLAT', 500)], 'PRD-9')).toBeNull();
  });
  it('returns null for empty/undefined rules', () => {
    expect(resolveChannelPartnerRule(undefined, 'PRD-1')).toBeNull();
    expect(resolveChannelPartnerRule([], 'PRD-1')).toBeNull();
  });
});

describe('computeChannelPartnerPayout', () => {
  it('FLAT returns the value regardless of amounts', () => {
    expect(computeChannelPartnerPayout(r('ALL', 'FLAT', 5000), 5_000_000, 70_000)).toBe(5000);
  });
  it('DISBURSED_PCT is a % of the disbursed loan', () => {
    expect(computeChannelPartnerPayout(r('ALL', 'DISBURSED_PCT', 0.2), 5_000_000, 70_000)).toBe(10_000);
  });
  it('FINVASTRA_PCT is a % of Finvastra gross', () => {
    expect(computeChannelPartnerPayout(r('ALL', 'FINVASTRA_PCT', 20), 5_000_000, 70_000)).toBe(14_000);
  });
  it('rounds to 2 decimals', () => {
    expect(computeChannelPartnerPayout(r('ALL', 'DISBURSED_PCT', 0.333), 123_456, 0)).toBe(411.11);
  });
  it('returns null for a null rule or negative value', () => {
    expect(computeChannelPartnerPayout(null, 100, 100)).toBeNull();
    expect(computeChannelPartnerPayout(r('ALL', 'FLAT', -1), 100, 100)).toBeNull();
  });
});

describe('sanitizeChannelPartnerRule', () => {
  it('accepts a well-formed rule', () => {
    expect(sanitizeChannelPartnerRule({ productId: 'PRD-1', basis: 'DISBURSED_PCT', value: 0.25 }))
      .toEqual({ productId: 'PRD-1', basis: 'DISBURSED_PCT', value: 0.25 });
  });
  it('clamps a percentage to 100 but leaves FLAT amounts', () => {
    expect(sanitizeChannelPartnerRule({ productId: 'ALL', basis: 'FINVASTRA_PCT', value: 250 })?.value).toBe(100);
    expect(sanitizeChannelPartnerRule({ productId: 'ALL', basis: 'FLAT', value: 250000 })?.value).toBe(250000);
  });
  it('rejects bad basis / missing product / negative value', () => {
    expect(sanitizeChannelPartnerRule({ productId: 'PRD-1', basis: 'NOPE', value: 1 })).toBeNull();
    expect(sanitizeChannelPartnerRule({ basis: 'FLAT', value: 1 })).toBeNull();
    expect(sanitizeChannelPartnerRule({ productId: 'PRD-1', basis: 'FLAT', value: -5 })).toBeNull();
  });
});
