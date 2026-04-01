import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiBase = env.VITE_BACKEND_URL || env.VITE_API_BASE || 'http://localhost:5001';

  const clientApiBase = ''; // Force relative URLs for client so it uses the same origin (works for both Vite dev proxy and Nginx prod proxy)

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
