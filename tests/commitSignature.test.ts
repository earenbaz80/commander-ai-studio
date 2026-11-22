/**
 * El chequeo de firma es la guardia que mantiene «una sola firma» después de
 * haber reescrito el historial. Si sus patrones se aflojan, cualquier trailer
 * vuelve a entrar sin que nada falle; si se endurecen de más, bloquea mensajes
 * legítimos y se termina desactivando. Estos casos fijan las dos orillas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COMMITTER_PLATAFORMA,
  FIRMA,
  commitsDelRango,
  desvioDeIdentidad,
  firmasEnMensaje,
  problemaDe,
} from '../scripts/check-commit-signature';

const leer = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('firma: un mensaje sin trailers pasa', () => {
  const mensaje = [
    'fix(agent): no cierra en rojo si el gate falla',
    '',
    'El cierre por maxSteps dejaba pasar corridas que el gate había marcado.',
  ].join('\n');
  assert.deepEqual(firmasEnMensaje(mensaje), []);
});

test('firma: los trailers de co-autoría fallan', () => {
  for (const linea of [
    'Co-Authored-By: Codebuff <noreply@codebuff.com>',
    'co-authored-by: Otra Persona <otra@example.com>',
    '  Co-Authored-By: Claude <noreply@anthropic.com>',
  ]) {
    const hallazgos = firmasEnMensaje(`feat(x): algo\n\n${linea}`);
    assert.equal(hallazgos.length, 1, `debería fallar: ${linea}`);
    assert.match(hallazgos[0].motivo, /co-autoría/);
  }
});

test('firma: las marcas de herramientas de IA fallan', () => {
  for (const linea of [
    '🤖 Generated with Codebuff',
    'Generated with Codebuff',
    'generated with cursor',
    'Authored by Copilot',
    'Contacto: noreply@codebuff.com',
  ]) {
    const hallazgos = firmasEnMensaje(`feat(x): algo\n\n${linea}`);
    assert.equal(hallazgos.length, 1, `debería fallar: ${linea}`);
  }
});

test('firma: la prosa que nombra co-autoría o herramientas no falla', () => {
  const mensaje = [
    'docs(parity): compara con Freebuff y su SDK',
    '',
    'El co-autor del diseño revisó la tabla; la mención a copilot en la comparación',
    'es una capacidad documentada del producto, no una firma del commit.',
  ].join('\n');
  assert.deepEqual(firmasEnMensaje(mensaje), []);
});

test('firma: autor y committer tienen que ser la única firma', () => {
  assert.equal(desvioDeIdentidad({ ...FIRMA }, { ...FIRMA }), null);

  const otroAutor = desvioDeIdentidad({ nombre: 'Otra Persona', email: FIRMA.email }, { ...FIRMA });
  assert.match(String(otroAutor), /autor/);

  const otraPersona = desvioDeIdentidad({ ...FIRMA }, { nombre: FIRMA.nombre, email: 'x@y.z' });
  assert.match(String(otraPersona), /committer/);

  // El correo se compara sin mayúsculas: `Foo@Bar` y `foo@bar` son la misma.
  assert.equal(
    desvioDeIdentidad({ ...FIRMA, email: FIRMA.email.toUpperCase() }, { ...FIRMA }),
    null
  );

  // GitHub pone su propia identidad como committer en squash y rebase; el
  // autor sigue siendo el del PR, así que la guardia mira ahí.
  assert.equal(
    desvioDeIdentidad({ ...FIRMA }, { nombre: 'GitHub', email: 'noreply@github.com' }),
    null
  );
  assert.match(
    String(desvioDeIdentidad({ ...FIRMA }, { nombre: 'GitHub', email: 'noreply@example.com' })),
    /committer/
  );
  assert.match(
    String(desvioDeIdentidad({ nombre: 'Otra Persona', email: FIRMA.email }, COMMITTER_PLATAFORMA)),
    /autor/,
    'el committer de plataforma no excusa un autor ajeno'
  );
});

test('firma: `.mailmap` y `AGENTS.md` coinciden con la firma del script', () => {
  const mailmap = leer('.mailmap');
  assert.ok(mailmap.includes(FIRMA.email), '.mailmap usa el correo canónico');
  assert.ok(mailmap.includes(FIRMA.nombre), '.mailmap usa el nombre canónico');
  // La regla escrita para agentes es la misma que aplica el script: si una
  // cambia sin la otra, la guardia y la instrucción se contradicen.
  assert.match(leer('AGENTS.md'), /Firma de los commits/, 'AGENTS.md documenta la regla');
});

test('firma: todo el historial del repo pasa el chequeo', (t) => {
  // Un clon superficial no tiene la historia: se omite en vez de mentir.
  const superficial =
    execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() ===
    'true';
  if (superficial) {
    t.skip('clon superficial: sin historia que revisar');
    return;
  }
  const commits = commitsDelRango('HEAD');
  assert.ok(commits.length > 100, `esperaba historia completa, hay ${commits.length} commits`);
  assert.deepEqual(
    commits.map(problemaDe).filter((p) => p !== null),
    []
  );
});

test('firma: los merge commits no se revisan y el resto sigue igual', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-merge-'));
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'earenbaz80']);
    git(['config', 'user.email', 'earenbaz80@users.noreply.github.com']);

    const commit = (archivo: string, mensaje: string): void => {
      fs.writeFileSync(path.join(repo, archivo), `${mensaje}\n`);
      git(['add', archivo]);
      git(['commit', '-q', '-m', mensaje]);
    };

    commit('base.txt', 'base');
    git(['checkout', '-q', '-b', 'lado']);
    commit('lado.txt', 'lado');
    git(['checkout', '-q', 'main']);
    commit('main.txt', 'main');
    git(['merge', '--no-ff', '-q', 'lado', '-m', "Merge branch 'lado'"]);

    const merge = git(['rev-parse', 'HEAD']).trim();
    // El merge de GitHub lleva la identidad del mantenedor, no la del repo:
    // revisarlo hace fallar CI sin que haya nada que corregir en la rama.
    const revisados = commitsDelRango('HEAD', repo);
    assert.equal(revisados.length, 3, 'los tres commits normales, sin el merge');
    assert.ok(!revisados.some((c) => c.hash === merge), 'el merge no se revisa');
    assert.match(git(['log', '-1', '--format=%an', merge]), /earenbaz80/);

    // Ignorar merges no apaga la guardia: los commits normales siguen fallando.
    assert.deepEqual(
      revisados.map(problemaDe).filter((p) => p === null),
      []
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('firma: un squash de GitHub (committer de plataforma) pasa', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-squash-'));
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', FIRMA.nombre]);
    git(['config', 'user.email', FIRMA.email]);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(['add', 'a.txt']);
    // Un squash de GitHub: autor original, committer de la plataforma.
    execFileSync('git', ['commit', '-q', '-m', 'feat(cli): algo'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: COMMITTER_PLATAFORMA.nombre,
        GIT_COMMITTER_EMAIL: COMMITTER_PLATAFORMA.email,
      },
    });

    const [commit] = commitsDelRango('HEAD', repo);
    assert.equal(commit.autor.email, FIRMA.email);
    assert.equal(commit.committer.nombre, COMMITTER_PLATAFORMA.nombre);
    assert.equal(problemaDe(commit), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('firma: un commit con trailer se reporta con su hash y el motivo', () => {
  const problema = problemaDe({
    hash: 'abcdef1234567890',
    autor: { ...FIRMA },
    committer: { ...FIRMA },
    mensaje: 'feat(cli): algo\n\n🤖 Generated with Codebuff',
  });
  assert.match(String(problema), /^ {2}· abcdef1 feat\(cli\): algo → /);
  assert.match(String(problema), /emoji de bot/);
});
