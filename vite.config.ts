import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// The data/ folder is served as static files (fetched at runtime, never
// bundled) so a data refresh doesn't require a JS rebuild.
export default defineConfig({
  plugins: [react({})],
  publicDir: 'data',
  build: {outDir: 'dist'},
});
