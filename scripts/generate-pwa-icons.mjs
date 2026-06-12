// Generate PWA icons matching the in-app VideoLogo lockup: the gold knot mark
// (public/favicon.png — transparent bg) with the "Finvastra / PULSE" wordmark
// beneath, on the app's dark-navy gradient (same look as the launcher).
// Content stays within the central ~78% so maskable crops keep it intact.
// Run: node scripts/generate-pwa-icons.mjs  → public/icons/icon-192.png + icon-512.png
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const MARK = 'public/favicon.png';

mkdirSync('public/icons', { recursive: true });

for (const size of [192, 512]) {
  const u = size / 512; // scale unit — layout designed at 512

  // Lockup geometry (designed at 512, mirrors the VideoLogo proportions)
  const markSize = Math.round(220 * u);
  const markTop  = Math.round(86 * u);
  const nameY    = Math.round(388 * u);  // "Finvastra" baseline
  const nameSize = Math.round(72 * u);
  const labelY   = Math.round(436 * u);  // "PULSE" baseline
  const labelSize = Math.round(24 * u);

  // Background + wordmark as SVG (text rendered with a serif close to Fraunces).
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0B1538"/>
          <stop offset="1" stop-color="#050d1f"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
      <text x="50%" y="${nameY}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-weight="bold"
        font-size="${nameSize}" letter-spacing="${-1.5 * u}">
        <tspan fill="#FFFFFF">Fin</tspan><tspan fill="#C9A961">vastra</tspan>
      </text>
      <text x="50%" y="${labelY}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-weight="bold"
        font-size="${labelSize}" letter-spacing="${7 * u}" fill="#9A7E3F">PULSE</text>
    </svg>`;

  const mark = await sharp(MARK)
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(Buffer.from(svg))
    .composite([{ input: mark, top: markTop, left: Math.round((size - markSize) / 2) }])
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`✓ public/icons/icon-${size}.png`);
}
