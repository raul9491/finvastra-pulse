// Generate PWA icons: the gold knot MARK only (public/favicon.png — transparent
// bg source) on the app's dark-navy gradient. No wordmark — text is unreadable
// at icon size. Mark stays within the central ~62% so maskable crops keep it intact.
// Run: node scripts/generate-pwa-icons.mjs  → public/icons/icon-192.png + icon-512.png
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const MARK = 'public/favicon.png';

mkdirSync('public/icons', { recursive: true });

for (const size of [192, 512]) {
  const markSize = Math.round(size * 0.62);

  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0B1538"/>
          <stop offset="1" stop-color="#050d1f"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
    </svg>`;

  const mark = await sharp(MARK)
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(Buffer.from(svg))
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`✓ public/icons/icon-${size}.png`);
}
