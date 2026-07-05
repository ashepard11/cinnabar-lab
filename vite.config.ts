import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// The data/ folder is served as static files (fetched at runtime, never
// bundled) so a data refresh doesn't require a JS rebuild.
// VITE_BASE is set to "/cinnabar-lab/" by the Pages deploy workflow (project
// pages are served under the repo name); locally it defaults to "/".
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react({})],
  publicDir: 'data',
  build: {outDir: 'dist'},
});
