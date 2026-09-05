import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  // The site is served from https://<user>.github.io/apoc-data/, not from a
  // domain root. Everything (including the parquet files, see src/config.ts)
  // is looked up relative to this.
  base: '/apoc-data/',
  plugins: [react(), tailwindcss()],
});
