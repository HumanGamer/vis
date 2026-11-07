import { execSync } from 'node:child_process';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const gitRevision = execSync('git rev-parse --short HEAD').toString().trim();

// The Tauri CLI sets TAURI_ENV_* when it runs the dev/build commands; the native
// app serves the bundle from its own origin root instead of the GitHub Pages path.
const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

export default defineConfig({
  base: isTauri ? '/' : '/vis/',
  clearScreen: !isTauri,
  server: { strictPort: isTauri },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  root: 'app',
  plugins: [vue()],
  worker: {
    format: 'es',
  },
  define: {
    __GIT_REVISION__: JSON.stringify(gitRevision),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
