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
 *   5. con el paquete instalado, levanta `commander serve` y exige
 *      `/api/health` 200, `/` 200 con el HTML de la UI y un asset real
 *      servido desde `cli-dist/dist`.
 *   6. comprueba que `commander build` no compile el proyecto del cwd: fuera
 *      de un checkout tiene que cortar con un motivo.
 *   7. lo mismo para `serve --dev`: no ejecuta el script `dev` del cwd.
 *
 * No extrae el tarball: `npm pack --json` ya lista sus archivos y la
 * instalación real (paso 4) deja el paquete donde npm lo pondría.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const bundle = 'cli-dist/commander.mjs';
const bundleServer = 'cli-dist/server.mjs';
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

/** Puerto loopback libre elegido por el SO, para no chocar con :3280/:3283. */
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-pack-'));
try {
  comprobar(pkg.bin?.commander === bundle, `package.json: bin.commander debe ser ${bundle}`);
  comprobar(
    Array.isArray(pkg.files) && pkg.files.includes('cli-dist'),
    'package.json: files debe incluir "cli-dist"'
  );
  // La UI se construye antes de empaquetar y `build:cli` la copia dentro de
  // `cli-dist`; sin eso el tarball instala pero `serve` contesta 404.
  npm(['run', 'build']);
  comprobar(fs.existsSync('dist/index.html'), 'falta dist/index.html: `npm run build` no lo generó');

  const salida = npm(['pack', '--json', '--pack-destination', tmp]);
  // `prepack` (build:cli) escribe progreso en stdout antes del JSON. El
  // manifiesto es el último bloque que arranca con `[` en su propia línea.
  const inicio = salida.lastIndexOf('\n[');
  const json = inicio >= 0 ? salida.slice(inicio + 1) : salida.slice(salida.indexOf('['));
  const [pack] = JSON.parse(json);

  const rutas = (pack.files ?? []).map((f) => f.path);
  comprobar(rutas.includes(bundle), `el tarball no lleva ${bundle} (lleva: ${rutas.join(', ') || 'nada'})`);
  comprobar(
    rutas.includes(bundleServer),
    `el tarball no lleva ${bundleServer} (lleva: ${rutas.join(', ') || 'nada'})`
  );
  comprobar(
    rutas.includes('cli-dist/dist/index.html'),
    `el tarball no lleva cli-dist/dist/index.html (lleva: ${rutas.slice(0, 12).join(', ') || 'nada'})`
  );
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

  // 5) Servidor del paquete instalado. Se ejecuta el CLI instalado, no
  //    `server.mjs` directamente: lo que se guarda es que `serve` resuelva el
  //    bundle desde el paquete y arranque fuera del repo.
  try {
    const cliInstalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    const cwdServe = path.join(tmp, 'serve-cwd');
    fs.mkdirSync(cwdServe, { recursive: true });
    const port = await puertoLibre();
    // NODE_ENV=development heredado: `serve` no-dev tiene que forzarlo a
    // producción. Si lo respetara, el server intentaría importar Vite, que no
    // viaja en el paquete, y este smoke no llegaría a /api/health.
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      NO_COLOR: '1',
      NODE_ENV: 'development',
    };
    const child = spawn(process.execPath, [cliInstalado, 'serve', '--port', String(port)], {
      cwd: cwdServe,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let salida = '';
    let cerrado = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      salida = `${salida}${chunk}`.slice(-4000);
    });
    child.stdout.resume();
    child.once('exit', () => {
      cerrado = true;
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      const limite = Date.now() + 60_000;
      let health = null;
      while (Date.now() < limite && !health) {
        if (cerrado) throw new Error(`el servidor salió antes de responder: ${salida.trim().slice(-400)}`);
        try {
          const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2_000) });
          if (res.ok) health = await res.json();
        } catch {
          /* todavía no escucha */
        }
        if (!health) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!health) throw new Error(`/api/health no respondió en 60 s: ${salida.trim().slice(-400)}`);
      comprobar(health.status === 'ok', `/api/health devolvió status ${JSON.stringify(health.status)}`);
      const raiz = await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) });
      const html = await raiz.text();
      comprobar(raiz.status === 200, `GET / devolvió ${raiz.status} y se esperaba 200 con la UI`);
      comprobar(
        /text\/html/i.test(raiz.headers.get('content-type') || ''),
        `GET / no devolvió HTML (content-type: ${raiz.headers.get('content-type')})`
      );
      comprobar(html.includes('Commander AI Studio'), 'GET / no devolvió el HTML del Studio');

      // Un asset real del build: si `dist/` no viajó, el HTML puede ser 200 y
      // el JS dar 404 (la app queda en blanco).
      const asset = /src="\.\/(assets\/[^"]+)"/.exec(html)?.[1] || 'manifest.json';
      const assetRes = await fetch(`${base}/${asset}`, { signal: AbortSignal.timeout(5_000) });
      comprobar(assetRes.status === 200, `GET /${asset} devolvió ${assetRes.status}`);
      console.log(
        `[check:cli-package] serve instalado · health 200 · GET / 200 (${html.length} B) · /${asset} ${assetRes.status}`
      );
    } finally {
      if (!cerrado) {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              /* ya cerró */
            }
            resolve();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }
  } catch (e) {
    const detalle = String(e?.stderr || e?.stdout || e?.message || e).trim().slice(0, 400);
    fallos.push(`\`commander serve\` sobre el paquete instalado falló: ${detalle}`);
  }

  /** Script npm que deja un marcador si el CLI lo ejecuta en el cwd. */
  function scriptMarcador(nombre) {
    return `node -e "require('fs').writeFileSync('${nombre}', 'x')"`;
  }

  /** Proyecto falso con `package.json`; sin `scripts`, un directorio vacío. */
  function crearProyecto(nombre, scripts) {
    const dir = path.join(tmp, nombre);
    fs.mkdirSync(dir, { recursive: true });
    if (scripts) {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: nombre, version: '1.0.0', scripts })
      );
    }
    return dir;
  }

  /** Corre el CLI instalado en `cwd` y devuelve status + salida sin lanzar. */
  function correrCli(cliInstalado, args, cwd) {
    try {
      const salida = execFileSync(process.execPath, [cliInstalado, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      return { status: 0, salida };
    } catch (e) {
      return {
        status: Number(e?.status ?? 1),
        salida: `${e?.stdout || ''}${e?.stderr || ''}`.trim(),
      };
    }
  }

  /**
   * Fuera de un checkout el comando tiene que salir ≠ 0, explicar que necesita
   * un checkout y no dejar el marcador del script del cwd.
   */
  function probarGuarda(cliInstalado, args, casos) {
    const comando = `commander ${args.join(' ')}`;
    for (const caso of casos) {
      const { status, salida } = correrCli(cliInstalado, args, caso.cwd);
      comprobar(
        status !== 0,
        `\`${comando}\` salió 0 en ${caso.nombre}: ${salida.slice(0, 200)}`
      );
      comprobar(
        /checkout/i.test(salida),
        `el error de \`${comando}\` en ${caso.nombre} no explica que necesita un checkout: ${salida.slice(0, 200)}`
      );
      if (caso.delegado) {
        comprobar(
          !fs.existsSync(path.join(caso.cwd, caso.delegado)),
          `\`${comando}\` ejecutó el script de ${caso.nombre}`
        );
      }
    }
  }

  // 6) `commander build` fuera de un checkout: corta con motivo y no delega.
  try {
    const cliInstalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    probarGuarda(cliInstalado, ['build'], [
      {
        nombre: 'proyecto con build',
        cwd: crearProyecto('otro-proyecto', { build: scriptMarcador('DELEGATED.txt') }),
        delegado: 'DELEGATED.txt',
      },
      { nombre: 'proyecto sin build', cwd: crearProyecto('proyecto-sin-build'), delegado: null },
      { nombre: 'directorio vacío', cwd: crearProyecto('sin-paquete'), delegado: null },
    ]);
    console.log('[check:cli-package] build: 3 cwd sin checkout · corta con motivo y no delega');
  } catch (e) {
    const detalle = String(e?.stderr || e?.stdout || e?.message || e).trim().slice(0, 400);
    fallos.push(`la guarda de \`commander build\` falló: ${detalle}`);
  }

  // 7) `serve --dev` tiene la misma guarda que `build`: tampoco ejecuta el
  //    script `dev` del cwd.
  try {
    const cliInstalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    probarGuarda(cliInstalado, ['serve', '--dev'], [
      {
        nombre: 'proyecto con dev',
        cwd: crearProyecto('proyecto-con-dev', { dev: scriptMarcador('DELEGATED_DEV.txt') }),
        delegado: 'DELEGATED_DEV.txt',
      },
      { nombre: 'proyecto sin dev', cwd: crearProyecto('proyecto-sin-dev'), delegado: null },
      { nombre: 'directorio vacío', cwd: crearProyecto('sin-paquete-dev'), delegado: null },
    ]);
    console.log('[check:cli-package] serve --dev: 3 cwd sin checkout · corta con motivo y no delega');
  } catch (e) {
    const detalle = String(e?.stderr || e?.stdout || e?.message || e).trim().slice(0, 400);
    fallos.push(`la guarda de \`commander serve --dev\` falló: ${detalle}`);
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
