import { describe, it, expect } from 'vitest';
import { classifySlaTier, slaAnchors, evaluateSla, slaConfigFromDoc, toMs, SLA_DEFAULTS } from './sla';

const ist = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;
const MON_10 = ist(2026, 6, 15, 10, 0); // Mon 2026-06-15 10:00 IST

describe('classifySlaTier', () => {
  it('ADS / website / social_meta → WARM (both schemas)', () => {
    expect(classifySlaTier({ source: 'ADS', receivedAt: 1 })).toBe('WARM');
    expect(classifySlaTier({ source: 'WEBSITE', receivedAt: 1 })).toBe('WARM');
    expect(classifySlaTier({ source: 'website' })).toBe('WARM');
    expect(classifySlaTier({ source: 'social_meta' })).toBe('WARM');
  });
  it('import-distributed → COLD', () => {
    expect(classifySlaTier({ source: 'offline_bulk', importBatchId: '2026-06-15-AB' })).toBe('COLD');
    expect(classifySlaTier({ source: 'walkin', distributedAt: 123 })).toBe('COLD');
    expect(classifySlaTier({ source: 'OFFLINE_BULK' })).toBe('COLD');
  });
  it('manual / referral / walkin → MANUAL', () => {
    expect(classifySlaTier({ source: 'walkin' })).toBe('MANUAL');
    expect(classifySlaTier({ source: 'referral' })).toBe('MANUAL');
    expect(classifySlaTier({ source: 'WALKIN', receivedAt: 1 })).toBe('MANUAL');
  });
});

describe('slaAnchors', () => {
  it('CRM2 unassigned vs assigned', () => {
    expect(slaAnchors({ receivedAt: MON_10, assignedRm: null }).isAssigned).toBe(false);
    const a = slaAnchors({ receivedAt: MON_10, assignedRm: 'FAPL-009', assignedAt: MON_10 + 60000 });
    expect(a.isAssigned).toBe(true);
    expect(a.assignedMs).toBe(MON_10 + 60000);
    expect(a.model).toBe('CRM2');
  });
  it('OLD UNASSIGNED sentinel vs real owner', () => {
    expect(slaAnchors({ createdAt: MON_10, primaryOwnerId: 'UNASSIGNED' }).isAssigned).toBe(false);
    const a = slaAnchors({ createdAt: MON_10, primaryOwnerId: 'uid123', assignedToCurrentOwnerAt: MON_10 });
    expect(a.isAssigned).toBe(true);
    expect(a.model).toBe('OLD');
  });
  it('detects terminal states in both schemas', () => {
    expect(slaAnchors({ receivedAt: MON_10, status: 'NOT_INTERESTED' }).isTerminal).toBe(true);
    expect(slaAnchors({ receivedAt: MON_10, converted: true }).isTerminal).toBe(true);
    expect(slaAnchors({ createdAt: MON_10, leadStatus: 'wrong_number' }).isTerminal).toBe(true);
    expect(slaAnchors({ createdAt: MON_10, deleted: true }).isTerminal).toBe(true);
  });
});

describe('evaluateSla — Stage 1 (time-to-assign)', () => {
  it('WARM ADS unassigned breaches after 15 working-min', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: null, status: 'NEW' };
    expect(evaluateSla(lead, ist(2026, 6, 15, 10, 10)).stage1.breached).toBe(false); // 10 min
    expect(evaluateSla(lead, ist(2026, 6, 15, 10, 20)).stage1.breached).toBe(true);  // 20 min
  });
  it('COLD bulk does NOT Stage-1-breach before 48 working-hours', () => {
    const lead = { source: 'offline_bulk', importBatchId: 'B1', createdAt: MON_10, primaryOwnerId: 'UNASSIGNED' };
    // Tue noon ≈ 10.5 working-h elapsed — far under 48h
    expect(evaluateSla(lead, ist(2026, 6, 16, 12, 0)).stage1.breached).toBe(false);
  });
  it('MANUAL self-assigned never has a Stage-1 breach', () => {
    const lead = { source: 'walkin', createdAt: MON_10, primaryOwnerId: 'uid1', assignedToCurrentOwnerAt: MON_10 };
    const e = evaluateSla(lead, ist(2026, 6, 16, 12, 0));
    expect(e.stage1.applicable).toBe(false);
    expect(e.stage1.breached).toBe(false);
  });
});

describe('evaluateSla — Stage 2 (time-to-first-contact)', () => {
  it('WARM lead with no first contact breaches 30 working-min from capture, late-assignment attributed', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: null, status: 'NEW' };
    const at20 = evaluateSla(lead, ist(2026, 6, 15, 10, 20));
    expect(at20.stage2.breached).toBe(false);                 // 20 min < 30
    const at45 = evaluateSla(lead, ist(2026, 6, 15, 10, 45));
    expect(at45.stage2.breached).toBe(true);                  // 45 min > 30
    expect(at45.lateAssignment).toBe(true);                   // never assigned
  });
  it('first contact stops the Stage-2 clock', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: 'FAPL-1', assignedAt: MON_10, firstContactedAt: MON_10 + 5 * 60000, status: 'ATTEMPTED' };
    expect(evaluateSla(lead, ist(2026, 6, 15, 12, 0)).stage2.applicable).toBe(false);
  });
  it('COLD Stage-2 clock anchors on ASSIGNMENT and uses the 24h window', () => {
    const lead = { source: 'offline_bulk', importBatchId: 'B', createdAt: MON_10, primaryOwnerId: 'uid', assignedToCurrentOwnerAt: MON_10, distributedAt: MON_10 };
    expect(evaluateSla(lead, ist(2026, 6, 16, 12, 0)).stage2.breached).toBe(false); // ~10.5 wh < 24
    expect(evaluateSla(lead, ist(2026, 6, 18, 11, 0)).stage2.breached).toBe(true);  // ~26.5 wh > 24
  });
  it('on-time assignment → lateAssignment false', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: 'FAPL-1', assignedAt: MON_10 + 5 * 60000, status: 'NEW' };
    expect(evaluateSla(lead, ist(2026, 6, 15, 10, 45)).lateAssignment).toBe(false); // assigned in 5 min < 15
  });
});

describe('evaluateSla — business-hours pause & config', () => {
  it('a lead captured on an off-Saturday does not breach until hours resume', () => {
    const sat1 = ist(2026, 6, 6, 12, 0); // 1st Saturday (off)
    const lead = { source: 'ADS', receivedAt: sat1, assignedRm: null, status: 'NEW' };
    expect(evaluateSla(lead, ist(2026, 6, 6, 18, 0)).stage1.breached).toBe(false); // 0 working-ms
  });
  it('terminal leads have no applicable stages', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: null, status: 'NOT_INTERESTED' };
    const e = evaluateSla(lead, ist(2026, 6, 20, 12, 0));
    expect(e.stage1.applicable).toBe(false);
    expect(e.stage2.applicable).toBe(false);
  });
  it('windows come from config — tightening makes a previously-OK lead breach', () => {
    const lead = { source: 'ADS', receivedAt: MON_10, assignedRm: null, status: 'NEW' };
    const now = ist(2026, 6, 15, 10, 10); // 10 min
    expect(evaluateSla(lead, now, SLA_DEFAULTS).stage1.breached).toBe(false);   // 10 < 15
    const tight = slaConfigFromDoc({ WARM: { stage1Ms: 5 * 60000, stage2Ms: 30 * 60000 } });
    expect(evaluateSla(lead, now, tight).stage1.breached).toBe(true);            // 10 > 5
  });
});

describe('slaConfigFromDoc / toMs', () => {
  it('falls back to defaults for missing/invalid values', () => {
    const c = slaConfigFromDoc({ WARM: { stage1Ms: 99 } });
    expect(c.WARM.stage1Ms).toBe(99);
    expect(c.WARM.stage2Ms).toBe(SLA_DEFAULTS.WARM.stage2Ms);
    expect(c.COLD.stage1Ms).toBe(SLA_DEFAULTS.COLD.stage1Ms);
    expect(slaConfigFromDoc(null)).toEqual(SLA_DEFAULTS);
  });
  it('toMs handles number, Date, and Firestore-like timestamps', () => {
    expect(toMs(123)).toBe(123);
    expect(toMs(new Date(456))).toBe(456);
    expect(toMs({ toMillis: () => 789 })).toBe(789);
    expect(toMs({ _seconds: 2, _nanoseconds: 0 })).toBe(2000);
    expect(toMs(null)).toBeNull();
  });
});
