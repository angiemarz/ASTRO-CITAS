// Genera los íconos PNG de la PWA a partir de public/icons/icon.svg usando Chromium (Playwright).
// Uso: npm run icons  (reemplaza icon.svg por tu logotipo cuadrado para usar tu propia imagen)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Requiere Playwright instalado (npm i -D playwright && npx playwright install chromium)
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const sizes = [
  ['apple-touch-icon.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.1],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#74428a;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false });
  console.log('✓', name);
}
await browser.close();
