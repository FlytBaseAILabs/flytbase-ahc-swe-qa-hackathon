/// <reference types="vitest" />
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// cesium may be hoisted to the workspace root; resolve its real location so the
// plugin can serve/copy Build/Cesium regardless of where node_modules lives.
const require = createRequire(import.meta.url);
const cesiumRoot = path.dirname(require.resolve('cesium/package.json'));
const cesiumBuildRootPath = path.join(cesiumRoot, 'Build');
const cesiumBuildPath = path.join(cesiumBuildRootPath, 'Cesium/');

export default defineConfig({
  plugins: [react(), cesium({ cesiumBuildRootPath, cesiumBuildPath })],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
