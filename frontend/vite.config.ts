import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiBase = env.VITE_BACKEND_URL || env.VITE_API_BASE || 'http://localhost:5001';

  // In dev, use empty string so all /api/* calls go via the Vite proxy (same-origin).
  // In production, use the absolute backend URL.
  const clientApiBase = mode === 'production' ? apiBase : '';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: false,
        },
        '/tools': {
          target: apiBase,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.BACKEND_URL': JSON.stringify(clientApiBase),
      'process.env.API_BASE': JSON.stringify(clientApiBase),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
  };
});
