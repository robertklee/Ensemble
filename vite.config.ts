import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ensemble-offline-shell',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const staticAssets = [
          '/ensemble-icon.svg',
          '/ensemble-logo.svg',
          '/icon-192.png',
          '/icon-512.png',
          '/maskable-icon-512.png',
          '/apple-touch-icon.png',
          '/manifest.webmanifest',
        ];
        const assets = [
          '/',
          ...staticAssets,
          ...Object.keys(bundle)
            .filter((name) => /\.(js|css)$/.test(name))
            .map((name) => `/${name}`),
        ];
        const hash = createHash('sha256').update(assets.join(','));
        for (const asset of staticAssets) {
          hash.update(readFileSync(new URL(`./public${asset}`, import.meta.url)));
        }
        const version = hash.digest('hex').slice(0, 16);
        const template = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: template
            .replace(/(['"])__PRECACHE_ASSETS__\1/, JSON.stringify(assets))
            .replace('__CACHE_VERSION__', version),
        });
      },
    },
  ],
  server: { proxy: { '/api': 'http://localhost:8788' } },
  build: { target: 'es2022' },
});
