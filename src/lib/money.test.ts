import { describe, it, expect } from 'vitest';
import { inr, inrRound, inrPaise } from './money';

describe('money.inr — exact, null → dash', () => {
  it('formats with Indian grouping', () => {
    expect(inr(100000)).toBe('₹1,00,000');
    expect(inr(12345678)).toBe('₹1,23,45,678');
    expect(inr(0)).toBe('₹0');
  });
  it('null/undefined → dash', () => {
    expect(inr(null)).toBe('—');
    expect(inr(undefined)).toBe('—');
  });
  it('keeps decimals when present (exact)', () => {
    expect(inr(1234.5)).toBe('₹1,234.5');
  });
});

describe('money.inrRound — whole rupees, null/NaN → ₹0', () => {
  it('rounds', () => {
    expect(inrRound(1234.4)).toBe('₹1,234');
    expect(inrRound(1234.6)).toBe('₹1,235');
    expect(inrRound(100000)).toBe('₹1,00,000');
  });
  it('null/undefined/NaN → ₹0', () => {
    expect(inrRound(null)).toBe('₹0');
    expect(inrRound(undefined)).toBe('₹0');
    expect(inrRound(NaN)).toBe('₹0');
  });
});

describe('money.inrPaise — 2 decimals', () => {
  it('always shows paise', () => {
    expect(inrPaise(1000)).toBe('₹1,000.00');
    expect(inrPaise(1234.5)).toBe('₹1,234.50');
    expect(inrPaise(null)).toBe('₹0.00');
  });
});
