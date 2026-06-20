// Indian-format number helpers — comma grouping (1,23,45,678) + words
// (Three Crore …). Used for money inputs so large amounts are readable.

/** "30000000" | 30000000 → "3,00,00,000" (Indian grouping). Empty for invalid. */
export function formatIndianNumber(n: number | string): string {
  const num = typeof n === 'string' ? Number(n.replace(/,/g, '')) : n;
  if (!isFinite(num) || num === 0) return num === 0 ? '0' : '';
  return Math.round(num).toLocaleString('en-IN');
}

/** Strip everything but digits (for parsing a comma-formatted amount input). */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/** 30000000 → "Three Crore". Indian lakh/crore system. '' for 0 / invalid. */
export function amountInWords(n: number): string {
  if (!n || isNaN(n) || n < 0) return '';
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below100 = (num: number): string =>
    num < 20 ? units[num] : tens[Math.floor(num / 10)] + (num % 10 ? ' ' + units[num % 10] : '');
  const below1000 = (num: number): string =>
    num < 100 ? below100(num) : units[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + below100(num % 100) : '');
  let out = '';
  let rem = Math.round(n);
  if (rem >= 10000000) { out += below1000(Math.floor(rem / 10000000)) + ' Crore '; rem %= 10000000; }
  if (rem >= 100000) { out += below1000(Math.floor(rem / 100000)) + ' Lakh '; rem %= 100000; }
  if (rem >= 1000) { out += below1000(Math.floor(rem / 1000)) + ' Thousand '; rem %= 1000; }
  if (rem > 0) { out += below1000(rem); }
  return out.trim();
}
