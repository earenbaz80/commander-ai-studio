/**
 * Guardia del paquete del CLI.
 *
 * `prepack` construye el bundle, pero hasta ahora ningún job de CI empaquetaba:
 * una rotura en el `bin`, en `files` o en el banner del bundle sólo se veía al
 * publicar (o al instalar a mano). Este script cierra esa puerta:
 *
 *   1. corre `npm pack` (que dispara `prepack` → `build:cli`) a un directorio
 *      temporal, sin dejar tarballs en el repo;
 *   2. comprueba que el tarball incluya `cli-dist/commander.mjs` y que `bin`
 *      apunte ahí;
 *   3. ejecuta el bundle con `--version` y `--help` y exige la versión del
 *      paquete y los comandos principales;
 *   4. instala el tarball en un prefijo temporal y corre `commander agent`
 *      contra el proveedor falso del repo (`scripts/check-cli-agent-run.ts`).
 *      Sin eso, `--version`/`--help` sólo prueban que el bundle arranca.
 *
 * No extrae el tarball: `npm pack --json` ya lista sus archivos y la
 * instalación real (paso 4) deja el paquete donde npm lo pondría.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const bundle = 'cli-dist/commander.mjs';
const fallos = [];

function comprobar(condition, message) {
  if (!condition) fallos.push(message);
}

/**
 * Ejecuta npm sin depender del shim de la plataforma.
 *
 * En Windows `npm` es un `.cmd` y Node 22 rechaza lanzarlo con `execFileSync`
 * (`EINVAL`). Se usa el `npm-cli.js` real: el que expone `npm_execpath` cuando
 * el script corre dentro de `npm run`, y si no el que viene con Node.
 */
function npm(args) {
  const fromEnv = process.env.npm_execpath;
  const cli =
    fromEnv && /npm-cli\.js$/.test(fromEnv)
      ? fromEnv
      : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) {
    return execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  }
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
}

function node(args) {
  return execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-pack-'));
try {
  comprobar(pkg.bin?.commander === bundle, `package.json: bin.commander debe ser ${bundle}`);
  comprobar(
    Array.isArray(pkg.files) && pkg.files.includes('cli-dist'),
    'package.json: files debe incluir "cli-dist"'
  );

  const salida = npm(['pack', '--json', '--pack-destination', tmp]);
  // npm antepone avisos al JSON; el manifiesto empieza en el primer `[`.
  const [pack] = JSON.parse(salida.slice(salida.indexOf('[')));

  const rutas = (pack.files ?? []).map((f) => f.path);
  comprobar(rutas.includes(bundle), `el tarball no lleva ${bundle} (lleva: ${rutas.join(', ') || 'nada'})`);
  comprobar(fs.existsSync(path.join(tmp, pack.filename)), `no se escribió el tarball ${pack.filename}`);

  const version = node([bundle, '--version']).trim();
  comprobar(version === pkg.version, `el bundle dice ${JSON.stringify(version)} y el paquete ${pkg.version}`);

  const ayuda = node([bundle, '--help']);
  for (const comando of ['agent', 'repl', 'doctor']) {
    comprobar(ayuda.includes(comando), `el bundle no anuncia el comando ${comando}`);
  }

  // 4) Instalación real y corrida del agente contra el proveedor falso.
  //    `--ignore-scripts`: acá se mide el empaquetado y el bucle, no compilar
  //    nativos (node-pty trae prebuild y no lo necesita esta corrida).
  const prefix = path.join(tmp, 'prefix');
  try {
    npm(['install', '--prefix', prefix, path.join(tmp, pack.filename), '--ignore-scripts', '--no-audit', '--no-fund']);
    const instalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    comprobar(fs.existsSync(instalado), `la instalación no dejó ${bundle}`);
    if (fs.existsSync(instalado)) {
      const corrida = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/check-cli-agent-run.ts', instalado],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180_000 }
      ).trim();
      if (corrida) console.log(corrida);
    }
  } catch (e) {
    const detalle = String(e?.stderr || e?.stdout || e?.message || e).trim().slice(0, 400);
    fallos.push(`la corrida de \`commander agent\` sobre el paquete instalado falló: ${detalle}`);
  }

  if (fallos.length > 0) {
    console.error('[check:cli-package] falló:');
    for (const fallo of fallos) console.error(`  · ${fallo}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[check:cli-package] ok · ${pack.filename} (${pack.size} B, ${rutas.length} archivos) · ${bundle} v${version}`
    );
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
