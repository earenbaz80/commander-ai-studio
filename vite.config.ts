import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : undefined,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    define: {
      'process.env': {},
    },
    build: {
      target: 'es2020',
      minify: 'esbuild',
      cssMinify: true,
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (normalized.includes('node_modules/react') || normalized.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
            if (normalized.includes('node_modules/lucide-react')) {
              return 'vendor-icons';
            }
            if (normalized.includes('node_modules/firebase')) {
              return 'vendor-firebase';
            }
            if (normalized.includes('node_modules/jszip')) {
              return 'vendor-zip';
            }
            if (normalized.includes('node_modules/motion')) {
              return 'vendor-motion';
            }
            if (normalized.includes('node_modules/@google/genai') || normalized.includes('node_modules/@google/generative-ai')) {
              return 'vendor-genai';
            }
            if (normalized.includes('node_modules/canvas-confetti')) {
              return 'vendor-confetti';
            }
            if (normalized.includes('node_modules/@codemirror') || normalized.includes('node_modules/codemirror')) {
              return 'vendor-codemirror';
            }
            if (normalized.includes('node_modules/@xterm') || normalized.includes('node_modules/xterm')) {
              return 'vendor-xterm';
            }
            if (normalized.includes('node_modules/lodash') || normalized.includes('node_modules/underscore')) {
              return 'vendor-utils';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // En desarrollo, redirige la API y el WebSocket de la terminal al
      // backend Express (puerto 3000). En producción/Electron todo va al
      // mismo origen, así que este proxy solo aplica al `vite dev`.
      proxy: {
        '/api': {
          target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
        '/ws/terminal': {
          target: process.env.WS_PROXY_TARGET || 'ws://localhost:3000',
          ws: true,
        },
      },
    },
  };
});
