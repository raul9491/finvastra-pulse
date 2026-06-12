import { describe, it, expect } from 'vitest';
import {
  resolveSlab, findSlabOverlaps, computeExpectedAmounts,
  SlabResolutionError, type SlabForResolution,
} from './slab';

const D = (s: string) => new Date(`${s}T00:00:00`).getTime();

const CTX = { connectorName: 'Starpowerz', lenderName: 'Fedbank', productName: 'LAP' };

function slab(p: Partial<SlabForResolution> & { slabId: string }): SlabForResolution {
  return {
    productIds: ['PRD-001'],
    finvastraPayoutPct: 1.4,
    subDsaDefaultPayoutPct: 0.7,
    tdsPct: null,
    effectiveFromMs: D('2026-04-01'),
    effectiveToMs: null,
    ...p,
  };
}

describe('resolveSlab', () => {
  // Two generations: gen-1 ends 2026-03-31, gen-2 open-ended from 2026-04-01.
  const generations = [
    slab({ slabId: 'gen1', finvastraPayoutPct: 1.2, effectiveFromMs: D('2025-04-01'), effectiveToMs: D('2026-03-31') }),
    slab({ slabId: 'gen2', finvastraPayoutPct: 1.4, effectiveFromMs: D('2026-04-01'), effectiveToMs: null }),
  ];

  it('picks the generation covering the disbursement date', () => {
    expect(resolveSlab(generations, 'PRD-001', D('2026-05-12'), CTX).slabId).toBe('gen2');
    expect(resolveSlab(generations, 'PRD-001', D('2025-12-01'), CTX).slabId).toBe('gen1');
  });

  it('boundary dates are inclusive on both ends', () => {
    expect(resolveSlab(generations, 'PRD-001', D('2026-03-31'), CTX).slabId).toBe('gen1'); // last day of gen1
    expect(resolveSlab(generations, 'PRD-001', D('2026-04-01'), CTX).slabId).toBe('gen2'); // first day of gen2
    expect(resolveSlab(generations, 'PRD-001', D('2025-04-01'), CTX).slabId).toBe('gen1'); // first day of gen1
  });

  it('throws NO_SLAB with a human message when nothing covers the date', () => {
    expect(() => resolveSlab(generations, 'PRD-001', D('2024-01-15'), CTX))
      .toThrowError(/No active payout slab for Starpowerz × Fedbank × LAP on 2024-01-15/);
    try {
      resolveSlab(generations, 'PRD-001', D('2024-01-15'), CTX);
    } catch (e) {
      expect(e).toBeInstanceOf(SlabResolutionError);
      expect((e as SlabResolutionError).kind).toBe('NO_SLAB');
    }
  });

  it('throws NO_SLAB for a product no slab covers', () => {
    expect(() => resolveSlab(generations, 'PRD-999', D('2026-05-12'), CTX))
      .toThrowError(SlabResolutionError);
  });

  it('throws AMBIGUOUS_SLAB when two slabs cover the same date', () => {
    const overlapping = [
      slab({ slabId: 'a', effectiveFromMs: D('2026-01-01'), effectiveToMs: null }),
      slab({ slabId: 'b', effectiveFromMs: D('2026-03-01'), effectiveToMs: null }),
    ];
    try {
      resolveSlab(overlapping, 'PRD-001', D('2026-05-12'), CTX);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SlabResolutionError);
      expect((e as SlabResolutionError).kind).toBe('AMBIGUOUS_SLAB');
      expect((e as SlabResolutionError).matches).toHaveLength(2);
    }
  });

  it('never defaults to 0% — empty slab list throws', () => {
    expect(() => resolveSlab([], 'PRD-001', D('2026-05-12'), CTX)).toThrowError(SlabResolutionError);
  });
});

describe('findSlabOverlaps', () => {
  it('accepts clean generations (end-dated + successor)', () => {
    const ok = [
      slab({ slabId: 'gen1', effectiveFromMs: D('2025-04-01'), effectiveToMs: D('2026-03-31') }),
      slab({ slabId: 'gen2', effectiveFromMs: D('2026-04-01'), effectiveToMs: null }),
    ];
    expect(findSlabOverlaps(ok)).toEqual([]);
  });

  it('rejects two open-ended slabs for the same product', () => {
    const bad = [
      slab({ slabId: 'a', effectiveFromMs: D('2026-01-01') }),
      slab({ slabId: 'b', effectiveFromMs: D('2026-03-01') }),
    ];
    expect(findSlabOverlaps(bad)).toHaveLength(1);
  });

  it('treats a shared boundary day as an overlap (inclusive bounds)', () => {
    const touching = [
      slab({ slabId: 'a', effectiveFromMs: D('2026-01-01'), effectiveToMs: D('2026-04-01') }),
      slab({ slabId: 'b', effectiveFromMs: D('2026-04-01'), effectiveToMs: null }),
    ];
    expect(findSlabOverlaps(touching)).toHaveLength(1);
  });

  it('different products never conflict', () => {
    const disjoint = [
      slab({ slabId: 'a', productIds: ['PRD-001'] }),
      slab({ slabId: 'b', productIds: ['PRD-002'] }),
    ];
    expect(findSlabOverlaps(disjoint)).toEqual([]);
  });
});

describe('computeExpectedAmounts', () => {
  const s = { finvastraPayoutPct: 1.4, subDsaDefaultPayoutPct: 0.7 };

  it('computes gross, sub-DSA share and margin with slab default', () => {
    const r = computeExpectedAmounts(s, 5_000_000, null, true);
    expect(r.expectedGross).toBe(70_000);
    expect(r.subDsaPayoutPct).toBe(0.7);
    expect(r.subDsaExpected).toBe(35_000);
    expect(r.netMarginExpected).toBe(35_000);
  });

  it('case-level sub-DSA % overrides the slab default', () => {
    const r = computeExpectedAmounts(s, 5_000_000, 1.0, true);
    expect(r.subDsaExpected).toBe(50_000);
    expect(r.netMarginExpected).toBe(20_000);
  });

  it('self-sourced case (no sub-DSA): full gross is margin', () => {
    const r = computeExpectedAmounts(s, 5_000_000, null, false);
    expect(r.subDsaPayoutPct).toBeNull();
    expect(r.subDsaExpected).toBeNull();
    expect(r.netMarginExpected).toBe(70_000);
  });

  it('sub-DSA present but no default and no override → no sub-DSA leg', () => {
    const r = computeExpectedAmounts({ finvastraPayoutPct: 1.4, subDsaDefaultPayoutPct: null }, 1_000_000, null, true);
    expect(r.subDsaExpected).toBeNull();
    expect(r.netMarginExpected).toBe(14_000);
  });
});
