import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Group vendor dependencies into named chunks. Vite 8 (Rolldown) only accepts
// the function form of manualChunks, so we resolve each module's package name
// and map it to a chunk.
const vendorChunks: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom', 'react-router'],
  'vendor-query': ['@tanstack/react-query'],
  'vendor-amplify': ['aws-amplify'],
  'vendor-charts': ['recharts'],
  'vendor-maps': ['leaflet', 'react-leaflet'],
  'vendor-ui': ['radix-ui', 'class-variance-authority', 'lucide-react'],
  'vendor-zod': ['zod'],
};

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  const afterModules = id.split('node_modules/').pop() ?? '';
  const parts = afterModules.split('/');
  const pkg = afterModules.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  for (const [chunk, pkgs] of Object.entries(vendorChunks)) {
    if (pkgs.includes(pkg)) return chunk;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Fonts stay files: the CSP's font-src 'self' blocks data: URIs
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 3000,
  },
});
