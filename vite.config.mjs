import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(() => {
  let env = {};
  try { env = parseEnv(readFileSync(resolve(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {
    root: resolve(root, 'web'),
    plugins: [react(), tailwindcss()],
    build: { outDir: resolve(root, 'dist'), emptyOutDir: true, assetsInlineLimit: 0 },
    server: { port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT || env.PORT || 3000}` } },
  };
});
