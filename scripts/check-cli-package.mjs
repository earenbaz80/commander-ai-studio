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
  comprobar(
    rutas.includes('cli-dist/public/manifest.json'),
    'el tarball no lleva cli-dist/public/manifest.json'
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
    // Sin NODE_ENV explícito: se mide el `serve` por defecto del paquete, que
    // resuelve `cli-dist/server.mjs` y arranca en producción sin cargar Vite.
    const env = { ...process.env, HOST: '127.0.0.1', NO_COLOR: '1' };
    delete env.NODE_ENV;
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

  // 6) `commander build` fuera de un checkout. Se prueban los tres cwd que
  //    importan: proyecto ajeno con `build`, proyecto sin `build` y directorio
  //    vacío. El script falso deja un marcador: si aparece, el CLI compiló el
  //    proyecto del cwd en vez de cortar.
  try {
    const cliInstalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    const marcador = (nombre) =>
      `node -e "require('fs').writeFileSync('${nombre}', 'x')"`;

    const conBuild = path.join(tmp, 'otro-proyecto');
    fs.mkdirSync(conBuild, { recursive: true });
    fs.writeFileSync(
      path.join(conBuild, 'package.json'),
      JSON.stringify({
        name: 'otro-proyecto',
        version: '1.0.0',
        scripts: { build: marcador('DELEGATED.txt') },
      })
    );

    const sinBuild = path.join(tmp, 'proyecto-sin-build');
    fs.mkdirSync(sinBuild, { recursive: true });
    fs.writeFileSync(
      path.join(sinBuild, 'package.json'),
      JSON.stringify({ name: 'sin-build', version: '1.0.0' })
    );

    const vacio = path.join(tmp, 'sin-paquete');
    fs.mkdirSync(vacio, { recursive: true });

    for (const caso of [
      { nombre: 'proyecto con build', cwd: conBuild, delegado: 'DELEGATED.txt' },
      { nombre: 'proyecto sin build', cwd: sinBuild, delegado: null },
      { nombre: 'directorio vacío', cwd: vacio, delegado: null },
    ]) {
      let salida = '';
      let status = 0;
      try {
        salida = execFileSync(process.execPath, [cliInstalado, 'build'], {
          cwd: caso.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
        });
      } catch (e) {
        status = Number(e?.status ?? 1);
        salida = `${e?.stdout || ''}${e?.stderr || ''}`.trim();
      }
      comprobar(
        status !== 0,
        `\`commander build\` salió 0 en ${caso.nombre}: ${salida.slice(0, 200)}`
      );
      comprobar(
        /checkout/i.test(salida),
        `el error de \`commander build\` en ${caso.nombre} no explica que necesita un checkout: ${salida.slice(0, 200)}`
      );
      if (caso.delegado) {
        comprobar(
          !fs.existsSync(path.join(caso.cwd, caso.delegado)),
          `\`commander build\` ejecutó el npm run build de ${caso.nombre}`
        );
      }
    }
    console.log('[check:cli-package] build: 3 cwd sin checkout · corta con motivo y no delega');
  } catch (e) {
    const detalle = String(e?.stderr || e?.stdout || e?.message || e).trim().slice(0, 400);
    fallos.push(`la guarda de \`commander build\` falló: ${detalle}`);
  }

  // 7) `serve --dev` tiene la misma guarda que `build`: no ejecuta el script
  //    `dev` del cwd. Si lo hiciera, dejaría DELEGATED_DEV.txt.
  try {
    const cliInstalado = path.join(prefix, 'node_modules', 'commander-ai-studio', bundle);
    const marcadorDev = (nombre) =>
      `node -e "require('fs').writeFileSync('${nombre}', 'x')"`;

    const conDev = path.join(tmp, 'proyecto-con-dev');
    fs.mkdirSync(conDev, { recursive: true });
    fs.writeFileSync(
      path.join(conDev, 'package.json'),
      JSON.stringify({
        name: 'proyecto-con-dev',
        version: '1.0.0',
        scripts: { dev: marcadorDev('DELEGATED_DEV.txt') },
      })
    );

    const sinDev = path.join(tmp, 'proyecto-sin-dev');
    fs.mkdirSync(sinDev, { recursive: true });
    fs.writeFileSync(
      path.join(sinDev, 'package.json'),
      JSON.stringify({ name: 'proyecto-sin-dev', version: '1.0.0' })
    );

    const vacioDev = path.join(tmp, 'sin-paquete-dev');
    fs.mkdirSync(vacioDev, { recursive: true });

    for (const caso of [
      { nombre: 'proyecto con dev', cwd: conDev, delegado: 'DELEGATED_DEV.txt' },
      { nombre: 'proyecto sin dev', cwd: sinDev, delegado: null },
      { nombre: 'directorio vacío', cwd: vacioDev, delegado: null },
    ]) {
      let salida = '';
      let status = 0;
      try {
        salida = execFileSync(process.execPath, [cliInstalado, 'serve', '--dev'], {
          cwd: caso.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
        });
      } catch (e) {
        status = Number(e?.status ?? 1);
        salida = `${e?.stdout || ''}${e?.stderr || ''}`.trim();
      }
      comprobar(
        status !== 0,
        `\`commander serve --dev\` salió 0 en ${caso.nombre}: ${salida.slice(0, 200)}`
      );
      comprobar(
        /checkout/i.test(salida),
        `el error de \`commander serve --dev\` en ${caso.nombre} no explica que necesita un checkout: ${salida.slice(0, 200)}`
      );
      if (caso.delegado) {
        comprobar(
          !fs.existsSync(path.join(caso.cwd, caso.delegado)),
          `\`commander serve --dev\` ejecutó el npm run dev de ${caso.nombre}`
        );
      }
    }
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
