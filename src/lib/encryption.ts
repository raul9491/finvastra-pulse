// AES-256-GCM authenticated encryption for PAN and other sensitive fields.
// Key source: process.env.PAN_ENCRYPTION_KEY (32-byte hex string in dev).
// In production Cloud Run: set PAN_ENCRYPTION_KEY env var from Secret Manager.
// Key rotation: keyVersion field enables in-place rotation without re-encrypting all data.
//
// SERVER-SIDE ONLY — do NOT import this file from client (browser) code.
// It depends on Node.js built-in `crypto` which is not available in the browser.

import crypto from 'crypto';

export interface EncryptedField {
  ciphertext: string;  // base64
  iv: string;          // base64, 12 bytes for GCM
  tag: string;         // base64, 16-byte GCM auth tag
  keyVersion: number;  // currently 1; increment when rotating keys
}

function getKey(): Buffer {
  const keyHex = process.env.PAN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'PAN_ENCRYPTION_KEY not set or invalid. Set a 64-char hex string (32 bytes) in .env.local.\n' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptField(plaintext: string): EncryptedField {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion: 1,
  };
}

export function decryptField(field: EncryptedField): string {
  const key = getKey();
  const iv = Buffer.from(field.iv, 'base64');
  const ciphertext = Buffer.from(field.ciphertext, 'base64');
  const tag = Buffer.from(field.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
