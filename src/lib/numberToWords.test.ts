import { describe, it, expect } from 'vitest';
import { formatIndianNumber, digitsOnly, amountInWords, amountInWordsWithOnly } from './numberToWords';

/**
 * These print on things people rely on: the amount-in-words line of an offer or
 * appointment letter, and the sanctioned/requested figures on a bank login.
 * Both were untested until 2026-07-23, and there were TWO implementations —
 * HrLetterGeneratorPage carried its own `ctcToWords` copy which lacked the
 * Math.round below. That is now consolidated here.
 */

describe('formatIndianNumber', () => {
  it('groups in the Indian system (lakh/crore), not thousands', () => {
    expect(formatIndianNumber(1000)).toBe('1,000');
    expect(formatIndianNumber(100000)).toBe('1,00,000');
    expect(formatIndianNumber(30000000)).toBe('3,00,00,000');
  });
  it('handles 0 and small numbers', () => {
    expect(formatIndianNumber(0)).toBe('0');
    expect(formatIndianNumber(7)).toBe('7');
  });
});

describe('digitsOnly', () => {
  it('strips everything that is not a digit', () => {
    expect(digitsOnly('1,25,000')).toBe('125000');
    expect(digitsOnly('Rs. 5,00,000/-')).toBe('500000');
    expect(digitsOnly('abc')).toBe('');
  });
});

describe('amountInWords', () => {
  it('spells the Indian scale', () => {
    expect(amountInWords(1)).toBe('One');
    expect(amountInWords(19)).toBe('Nineteen');
    expect(amountInWords(20)).toBe('Twenty');
    expect(amountInWords(21)).toBe('Twenty One');
    expect(amountInWords(100)).toBe('One Hundred');
    expect(amountInWords(1000)).toBe('One Thousand');
    expect(amountInWords(100000)).toBe('One Lakh');
    expect(amountInWords(10000000)).toBe('One Crore');
  });

  it('composes multi-scale amounts', () => {
    expect(amountInWords(1800000)).toBe('Eighteen Lakh');
    expect(amountInWords(1250000)).toBe('Twelve Lakh Fifty Thousand');
    expect(amountInWords(30000000)).toBe('Three Crore');
    expect(amountInWords(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
  });

  it('ROUNDS a fractional amount instead of emitting "undefined"', () => {
    // This is the bug the HR-letter copy had: without Math.round, a decimal CTC
    // left a fractional remainder, units[0.5] was undefined, and the letter read
    // "... Thousand undefined Only".
    const w = amountInWords(1250000.5);
    expect(w).not.toContain('undefined');
    expect(w).toBe('Twelve Lakh Fifty Thousand One');
    expect(amountInWords(99.6)).toBe('One Hundred');
  });

  it('returns empty for zero, negative and non-numeric input', () => {
    expect(amountInWords(0)).toBe('');
    expect(amountInWords(-5000)).toBe('');
    expect(amountInWords(NaN)).toBe('');
  });
});

describe('amountInWordsWithOnly', () => {
  it('appends the legal "Only" suffix used on letters', () => {
    expect(amountInWordsWithOnly(1800000)).toBe('Eighteen Lakh Only');
  });
  it('never returns a bare " Only" for an empty amount', () => {
    expect(amountInWordsWithOnly(0)).toBe('');
    expect(amountInWordsWithOnly(-1)).toBe('');
  });
  it('is safe on a decimal CTC — the case that used to print "undefined"', () => {
    expect(amountInWordsWithOnly(1250000.5)).toBe('Twelve Lakh Fifty Thousand One Only');
  });
});
