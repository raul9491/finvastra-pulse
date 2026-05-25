/**
 * Smoke-test the Resend email route without spinning up Express.
 * Mirrors the exact fetch() pattern used in server.ts.
 *
 *   npm run test:email
 *
 * Requires RESEND_API_KEY to be set — either in .env.local (dev) or
 * already present in the environment (CI / Cloud Run shell).
 */

import dotenv from 'dotenv';

// Load .env.local first (dev), then fall back to .env.
// server.ts calls dotenv.config() which reads .env; locally we only have .env.local.
dotenv.config({ path: '.env.local' });
dotenv.config();                          // picks up .env if it exists

const key = process.env.RESEND_API_KEY;

if (!key) {
  console.error('');
  console.error('❌  RESEND_API_KEY is not set.');
  console.error('');
  console.error('    This key is a production-only Cloud Run env var and is not');
  console.error('    stored in .env.local.  To test locally:');
  console.error('');
  console.error('      1. Go to https://resend.com/api-keys');
  console.error('      2. Copy your API key');
  console.error('      3. Add to .env.local:  RESEND_API_KEY=re_...');
  console.error('      4. Re-run:  npm run test:email');
  console.error('');
  process.exit(1);
}

const timestamp = new Date().toISOString();
const TO        = 'rahulv@finvastra.com';

console.log('');
console.log('📧  Sending test email via Resend...');
console.log(`    To:        ${TO}`);
console.log(`    Timestamp: ${timestamp}`);
console.log('');

try {
  const res  = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      from:    'pulse@finvastra.com',
      to:      [TO],
      subject: 'Finvastra Pulse — Email Test',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#0B1538;margin-bottom:8px">Finvastra Pulse</h2>
          <p style="color:#2A2A2A">Email routing confirmed working.</p>
          <p style="color:#8B8B85;font-size:13px">Sent at: <strong>${timestamp}</strong></p>
        </div>
      `,
    }),
  });

  // Resend returns JSON for both success (201) and errors (4xx/5xx)
  const body = await res.json() as Record<string, unknown>;

  if (res.ok) {
    console.log('✅  Success');
    console.log(`    Message ID : ${body.id as string}`);
    console.log(`    HTTP status: ${res.status}`);
  } else {
    console.error('❌  Resend API returned an error');
    console.error(`    HTTP status : ${res.status}`);
    console.error(`    Error name  : ${body.name as string ?? '—'}`);
    console.error(`    Message     : ${body.message as string ?? JSON.stringify(body)}`);
    process.exit(1);
  }
} catch (err) {
  console.error('❌  Network / fetch error');
  console.error('   ', err);
  process.exit(1);
}
