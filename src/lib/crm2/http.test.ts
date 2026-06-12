import { describe, it, expect } from 'vitest';
import { extractClientIp } from './http';

describe('extractClientIp (Cloud Run appends the real IP LAST)', () => {
  it('takes the last XFF entry — the one Cloud Run appended', () => {
    expect(extractClientIp('203.0.113.7', undefined)).toBe('203.0.113.7');
    expect(extractClientIp('spoofed.example, 203.0.113.7', undefined)).toBe('203.0.113.7');
  });
  it('is not fooled by client-supplied XFF prefixes (spoof attempt)', () => {
    expect(extractClientIp('1.1.1.1, 2.2.2.2, 203.0.113.7', undefined)).toBe('203.0.113.7');
  });
  it('handles array headers and whitespace', () => {
    expect(extractClientIp(['1.1.1.1, 203.0.113.7'], undefined)).toBe('203.0.113.7');
    expect(extractClientIp('  203.0.113.7  ', undefined)).toBe('203.0.113.7');
  });
  it('falls back to req.ip, then "unknown"', () => {
    expect(extractClientIp(undefined, '10.0.0.5')).toBe('10.0.0.5');
    expect(extractClientIp('', undefined)).toBe('unknown');
  });
});
