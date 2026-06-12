// Generate PWA icons from the official Finvastra logo MARK only (public/favicon.png,
// the gold knot — the full lockup's wordmark is unreadable at icon size).
// White background; mark scaled to ~78% so maskable crops keep it intact.
// Run: node scripts/generate-pwa-icons.mjs  → public/icons/icon-192.png + icon-512.png
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const MARK = 'public/favicon.png';

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.78);
  const mark = await sharp(MARK)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`✓ public/icons/icon-${size}.png`);
}
