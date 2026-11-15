/**
 * Genera `public/avatars/manifest.json` a partir de los PNG de esa carpeta.
 *
 * El navegador no puede listar un directorio estático, así que el manifiesto
 * hace de índice. Se ejecuta antes de `dev` y de `build`, y también a mano con
 * `npm run avatars:sync`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AVATAR_FILE_RE, slugifyAvatarId } from '../src/features/user/avatarNaming';

interface ManifestAvatar {
  id: string;
  file: string;
  label: string;
}

interface Manifest {
  version: number;
  avatars: ManifestAvatar[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 4 * 1024 * 1024;

const avatarsDir = path.join(process.cwd(), 'public', 'avatars');
const manifestPath = path.join(avatarsDir, 'manifest.json');

function previousLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<Manifest>;
    for (const avatar of Array.isArray(raw.avatars) ? raw.avatars : []) {
      if (
        avatar &&
        typeof avatar.file === 'string' &&
        typeof avatar.label === 'string' &&
        avatar.label.trim()
      ) {
        labels.set(avatar.file, avatar.label.trim());
      }
    }
  } catch {
    /* manifiesto ausente o corrupto: se reconstruye */
  }
  return labels;
}

function fallbackLabel(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pngSize(file: string): { width: number; height: number } | null {
  const buffer = fs.readFileSync(file);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

fs.mkdirSync(avatarsDir, { recursive: true });
const labels = previousLabels();

const files = fs
  .readdirSync(avatarsDir)
  .filter((file) => /\.png$/i.test(file))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const avatars: ManifestAvatar[] = [];
const seen = new Set<string>();

for (const file of files) {
  if (!AVATAR_FILE_RE.test(file)) {
    console.warn(`[avatars] omitido: nombre no válido (${file})`);
    continue;
  }

  const fullPath = path.join(avatarsDir, file);
  const size = pngSize(fullPath);
  if (!size) {
    console.warn(`[avatars] omitido: no es un PNG válido (${file})`);
    continue;
  }
  if (size.width !== size.height) {
    console.warn(`[avatars] ${file} no es cuadrado (${size.width}×${size.height}); se mostrará recortado`);
  }
  if (fs.statSync(fullPath).size > MAX_BYTES) {
    console.warn(`[avatars] ${file} supera 4 MB; conviene reducirlo`);
  }

  const base = file.replace(/\.png$/i, '');
  const id = slugifyAvatarId(base) || `avatar-${avatars.length + 1}`;
  if (seen.has(id)) {
    console.warn(`[avatars] omitido: id duplicado (${file} → ${id})`);
    continue;
  }
  seen.add(id);

  avatars.push({
    id,
    file,
    label: labels.get(file) || fallbackLabel(id),
  });
}

const manifest: Manifest = { version: 1, avatars };
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(
  `[avatars] ${avatars.length} PNG${avatars.length === 1 ? '' : 's'} → ${path.relative(process.cwd(), manifestPath)}`
);
