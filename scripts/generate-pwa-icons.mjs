// Generate PWA icons from the REAL Finvastra logo (public/images/logo-finvastra.png:
// gold mark + navy FINVASTRA wordmark + gold tagline). White background because
// the wordmark is navy; logo scaled to ~64% so maskable crops keep the full mark.
// Run: node scripts/generate-pwa-icons.mjs  → public/icons/icon-192.png + icon-512.png
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const LOGO = 'public/images/logo-finvastra.png';

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.64);
  const logo = await sharp(LOGO)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`✓ public/icons/icon-${size}.png`);
}
