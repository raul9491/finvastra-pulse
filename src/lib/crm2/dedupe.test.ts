import { describe, it, expect } from 'vitest';
import { normaliseMobile, normaliseEmail, buildDupeKeys } from './dedupe';

describe('normaliseMobile', () => {
  it('accepts a clean 10-digit Indian mobile', () => {
    expect(normaliseMobile('9701097333')).toBe('9701097333');
  });
  it('strips +91, spaces, dashes', () => {
    expect(normaliseMobile('+91 97010 97333')).toBe('9701097333');
    expect(normaliseMobile('91-9701097333')).toBe('9701097333');
    expect(normaliseMobile('09701097333')).toBe('9701097333');
  });
  it('rejects landlines, short numbers, junk', () => {
    expect(normaliseMobile('04023456789')).toBeNull();   // starts with 4 after 0-strip
    expect(normaliseMobile('12345')).toBeNull();
    expect(normaliseMobile('')).toBeNull();
    expect(normaliseMobile(null)).toBeNull();
    expect(normaliseMobile('not a phone')).toBeNull();
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
  it('rejects invalid emails', () => {
    expect(normaliseEmail('nope')).toBeNull();
    expect(normaliseEmail('a@b')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
  });
});

describe('buildDupeKeys', () => {
  it('builds both keys when valid', () => {
    expect(buildDupeKeys('+91 9701097333', 'X@Y.com')).toEqual(['m:9701097333', 'e:x@y.com']);
  });
  it('skips invalid parts instead of failing', () => {
    expect(buildDupeKeys('junk', 'x@y.com')).toEqual(['e:x@y.com']);
    expect(buildDupeKeys('9701097333', 'junk')).toEqual(['m:9701097333']);
    expect(buildDupeKeys(null, null)).toEqual([]);
  });
});
