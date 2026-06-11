// Generate PWA icons from the VastraLogo mark (4 rotated gold squares on navy).
// Run: node scripts/generate-pwa-icons.mjs  → public/icons/icon-192.png + icon-512.png
import sharp from 'sharp';
import { mkdirSync } from 'fs';

// Same geometry as src/components/ui/VastraLogo.tsx, centred in a 100×100 box,
// scaled down slightly (maskable icons need ~80% safe zone) on navy #0B1538.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0B1538"/>
  <g transform="translate(50 50) scale(0.72)">
    <rect x="-15" y="-38" width="30" height="30" rx="6" fill="none" stroke="#C9A961" stroke-width="7" transform="rotate(45 0 -23)"/>
    <rect x="-15" y="8"   width="30" height="30" rx="6" fill="none" stroke="#C9A961" stroke-width="7" transform="rotate(45 0 23)"/>
    <rect x="-38" y="-15" width="30" height="30" rx="6" fill="none" stroke="#C9A961" stroke-width="7" transform="rotate(45 -23 0)"/>
    <rect x="8"   y="-15" width="30" height="30" rx="6" fill="none" stroke="#C9A961" stroke-width="7" transform="rotate(45 23 0)"/>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  console.log(`✓ public/icons/icon-${size}.png`);
}
