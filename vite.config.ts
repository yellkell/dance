import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// IWSDK's dev plugin injects the IWER WebXR emulator so the game can be
// danced in a desktop browser (WASD + mouse) without a headset. On a real
// Quest browser it stays out of the way and the native WebXR session is used.
export default defineConfig({
  base: './',
  plugins: [
    iwsdkDev({
      emulator: { device: 'metaQuest3' },
    }),
  ],
  // The music masters ride along as static assets (Vite fingerprints and
  // copies them); .m4a isn't in every Vite version's default asset list.
  assetsInclude: ['**/*.m4a'],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'esnext',
    // Never inline a track — they must stay separate files so the browser
    // can stream and cache them.
    assetsInlineLimit: 4096,
  },
});
