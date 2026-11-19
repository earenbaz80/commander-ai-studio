import { describe, it, expect } from 'vitest';
import {
  MAX_VERIFY_REFUSALS,
  VerifyGate,
  isCodePath,
  isTestPath,
  isVerificationCommand,
} from '../../src/agent/verifyGate';

/**
 * El gate existe por T4: el modelo edita código y responde «listo» sin correr
 * `node --test` (G1-D1-05), o lo corre en rojo y cierra igual. La regla es una
 * sola: sin una verificación en verde **posterior** a la última edición de
 * código no hay respuesta final.
 */

/** Lo que devuelve `runTool` en verde. */
const green = (exitCode = 0) => ({
  ok: true,
  data: { ok: true, data: { exitCode, stdout: 'ok 2 tests', stderr: '' } },
});

/** Lo mismo, con el test en rojo. */
const red = (exitCode = 1, stderr = 'not ok 1 - descuento del 0%') => ({
  ok: true,
  data: { ok: true, data: { exitCode, stdout: '', stderr } },
});

describe('clasificación de archivos y comandos', () => {
  it('sólo el código obliga a verificar', () => {
    expect(isCodePath('src/a.ts')).toBe(true);
    expect(isCodePath('discount.mjs')).toBe(true);
    expect(isCodePath('tools/x.py')).toBe(true);
    expect(isCodePath('main.go')).toBe(true);
    expect(isCodePath('README.md')).toBe(false);
    expect(isCodePath('package.json')).toBe(false);
    expect(isCodePath('salida.txt')).toBe(false);
    expect(isCodePath(null)).toBe(false);
  });

  it('reconoce archivos de test', () => {
    expect(isTestPath('discount.test.mjs')).toBe(true);
    expect(isTestPath('src/slug.spec.ts')).toBe(true);
    expect(isTestPath('discount.mjs')).toBe(false);
  });

  it('reconoce comandos de verificación', () => {
    expect(isVerificationCommand('node --test')).toBe(true);
    expect(isVerificationCommand('node --test discount.test.mjs')).toBe(true);
    expect(isVerificationCommand('npm test')).toBe(true);
    expect(isVerificationCommand('npm run build')).toBe(true);
    expect(isVerificationCommand('npm run typecheck')).toBe(true);
    expect(isVerificationCommand('npx vitest run tests/unit')).toBe(true);
    expect(isVerificationCommand('tsc --noEmit')).toBe(true);
    expect(isVerificationCommand('pytest -q')).toBe(true);
    expect(isVerificationCommand('go test ./...')).toBe(true);
    expect(isVerificationCommand('ls -la')).toBe(false);
    expect(isVerificationCommand('node server.js')).toBe(false);
    expect(isVerificationCommand(undefined)).toBe(false);
  });
});

describe('estado del gate', () => {
  it('sin ediciones de código no pide nada', () => {
    const gate = new VerifyGate();
    expect(gate.needsVerification()).toBe(false);
    gate.noteEdit('README.md', 1);
    expect(gate.needsVerification()).toBe(false);
  });

  it('una edición de código exige verificación posterior', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 3);
    expect(gate.needsVerification()).toBe(true);
    expect(gate.evidence()).toBe(null);
  });

  it('un verde anterior a la edición no cubre el código nuevo', () => {
    const gate = new VerifyGate();
    gate.noteRun('node --test discount.test.mjs', green(), 2);
    gate.noteEdit('discount.mjs', 3);
    expect(gate.needsVerification()).toBe(true);
  });

  it('un verde posterior desbloquea el cierre', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 3);
    gate.noteRun('node --test discount.test.mjs', green(), 4);
    expect(gate.needsVerification()).toBe(false);
    expect(gate.evidence()?.exitCode).toBe(0);
  });

  it('un rojo posterior bloquea y conserva la salida', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 3);
    gate.noteRun('node --test discount.test.mjs', red(), 4);
    expect(gate.needsVerification()).toBe(true);
    const evidence = gate.evidence();
    expect(evidence?.ok).toBe(false);
    expect(evidence?.exitCode).toBe(1);
    expect(evidence?.output).toMatch(/descuento del 0%/);
  });

  it('un comando denegado cuenta como verificación en rojo', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 1);
    gate.noteRun('node --test discount.test.mjs', { ok: false, error: 'aprobación denegada' }, 2);
    expect(gate.needsVerification()).toBe(true);
    expect(gate.evidence()?.ok).toBe(false);
    expect(gate.evidence()?.exitCode).toBe(null);
  });

  it('ignora comandos que no verifican', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 1);
    gate.noteRun('ls -la', green(), 2);
    expect(gate.needsVerification()).toBe(true);
  });

  it('sugiere el test que el modelo tocó', () => {
    const gate = new VerifyGate();
    gate.noteEdit('src/discount.test.mjs', 1);
    expect(gate.suggestedCommand()).toBe('node --test src/discount.test.mjs');
    const onlySource = new VerifyGate();
    onlySource.noteEdit('discount.mjs', 1);
    expect(onlySource.suggestedCommand()).toBe('node --test discount.test.mjs');
  });

  it('acumula cierres rechazados y el verde los reinicia', () => {
    const gate = new VerifyGate();
    gate.noteEdit('discount.mjs', 1);
    expect(gate.refusal()).toBe(1);
    expect(gate.refusal()).toBe(MAX_VERIFY_REFUSALS);
    expect(gate.refusal()).toBe(MAX_VERIFY_REFUSALS + 1);
    gate.noteRun('node --test discount.test.mjs', green(), 5);
    expect(gate.refusalsSoFar()).toBe(0);
  });
});
