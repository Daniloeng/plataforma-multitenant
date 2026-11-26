import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Base pública: '/' localmente e '/plataforma-multitenant/' no GitHub Pages.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      // Em desenvolvimento, /api vai para o status-service (Spring Boot) local.
      '/api': 'http://localhost:8090',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/main.tsx',
        'src/mocks/browser.ts',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.css',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
