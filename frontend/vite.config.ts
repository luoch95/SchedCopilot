import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Keep demo results stable across tab switches and development reconnects.
    // Source changes take effect only after a manual browser refresh.
    hmr: false,
    ws: false,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
});
