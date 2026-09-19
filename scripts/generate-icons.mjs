import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const publicDir = new URL('../public/', import.meta.url);
const icon = await readFile(new URL('ensemble-icon.svg', publicDir), 'utf8');
const wordmark = icon
  .replace('viewBox="0 0 64 64"', 'viewBox="0 0 304 64"')
  .replace(
    '</svg>',
    '<text x="80" y="44" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" letter-spacing="-1.5" fill="#203c2e">ensemble<tspan fill="#63a785">.</tspan></text></svg>',
  );
await writeFile(new URL('ensemble-logo.svg', publicDir), wordmark);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { name, size, square } of [
    { name: 'icon-192.png', size: 192, square: false },
    { name: 'icon-512.png', size: 512, square: false },
    { name: 'maskable-icon-512.png', size: 512, square: true },
    { name: 'apple-touch-icon.png', size: 180, square: true },
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${icon}</body></html>`,
    );
    if (square) await page.locator('#background').evaluate((rect) => rect.setAttribute('rx', '0'));
    await writeFile(new URL(name, publicDir), await page.screenshot({ omitBackground: true }));
    console.log(`Generated ${name} (${size} x ${size})`);
  }
} finally {
  await browser.close();
}
