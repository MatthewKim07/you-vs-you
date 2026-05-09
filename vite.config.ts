import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  resolve: {
    // Prefer TypeScript source when stale JS artifacts exist in src/.
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
});
