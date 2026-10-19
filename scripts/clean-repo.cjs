#!/usr/bin/env node
/**
 * Limpieza del repositorio - P2 #9
 * Elimina archivos temporales, logs, caches y archivos innecesarios
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const CLEAN_PATTERNS = [
  // Cache y build temporales
  'node_modules/.cache',
  '.vite',
  '.turbo',
  '.parcel-cache',
  '.esbuild',
  'dist-electron',
  'dist/**/*.map', // source maps en producción

  // Logs
  '*.log',
  'logs/',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'pnpm-debug.log*',

  // IDE y editor
  '.vscode/',
  '.idea/',
  '*.swp',
  '*.swo',
  '*~',
  '.DS_Store',
  'Thumbs.db',

  // Test coverage y reportes temporales
  'coverage/',
  '.nyc_output/',
  '.vitest/',

  // Electron builder temporales
  'release/**/*.blockmap',
  'release/**/*.yml',
  'release/**/*.blockmap',

  // Archivos temporales
  '*.tmp',
  '*.temp',
  '.tmp/',
  'temp/',

  // Node modules duplicados en subdirectorios
  '**/node_modules/**/node_modules',

  // Backups
  '*.bak',
  '*.backup',
  '*.old',

  // Cobertura de código en node_modules
  'node_modules/.cache',
];

const KEEP_PATTERNS = [
  // Mantener archivos importantes
  '!build/icon.ico',
  '!build/icon.png',
  '!build/icon.icns',
  '!package.json',
  '!package-lock.json',
  '!tsconfig.json',
  '!vite.config.ts',
  '!tsconfig.*.json',
  '!.gitignore',
  '!.gitattributes',
  '!README.md',
  '!LICENSE',
  '!CHANGELOG.md',
  '!.env*',
  '!*.md',
];

function glob(pattern, root = ROOT) {
  const results = [];
  const glob = require('glob');
  return new Promise((resolve, reject) => {
    glob(pattern, { cwd: root, nodir: true, dot: true }, (err, matches) => {
      if (err) reject(err);
      else resolve(matches);
    });
  });
}

async function clean() {
  console.log('🧹 Iniciando limpieza del repositorio...\n');

  let totalRemoved = 0;
  let totalSize = 0;

  for (const pattern of CLEAN_PATTERNS) {
    try {
      const { glob } = require('glob');
      const matches = await new Promise((resolve, reject) => {
        require('glob')(pattern, { cwd: ROOT, nodir: false, dot: true }, (err, matches) => {
          if (err) reject(err);
          else resolve(matches);
        });
      });

      for (const match of matches) {
        const fullPath = path.join(ROOT, match);
        const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
        
        if (stat) {
          if (stat.isDirectory()) {
            const size = getDirSize(fullPath);
            fs.rmSync(fullPath, { recursive: true, force: true });
            totalRemoved++;
            totalSize += size;
            console.log(`  🗑️  Eliminado directorio: ${match} (${formatBytes(size)})`);
          } else {
            const size = stat.size;
            fs.unlinkSync(fullPath);
            totalRemoved++;
            totalSize += size;
            console.log(`  🗑️  Eliminado archivo: ${match} (${formatBytes(size)})`);
          }
        }
      }
    } catch (err) {
      // Ignorar errores de patrones que no coinciden
    }
  }

  console.log(`\n✅ Limpieza completada`);
  console.log(`   Archivos/directorios eliminados: ${totalRemoved}`);
  console.log(`   Espacio liberado: ${formatBytes(totalSize)}`);
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch {
    // Ignorar errores
  }
  return size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Ejecutar si se llama directamente
if (require.main === module) {
  clean().catch(console.error);
}

module.exports = { clean };