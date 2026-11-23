/**
 * `/api/mcp/health` devuelve un fragmento del stdout del servidor MCP. Ese
 * arranque puede imprimir variables de entorno, así que se sanea completo y
 * sólo después se recorta.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mcpHealthOutput } from '../../src/mcp/index';

const previousSecret = process.env.MCP_HEALTH_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.MCP_HEALTH_SECRET;
  else process.env.MCP_HEALTH_SECRET = previousSecret;
});

describe('mcpHealthOutput', () => {
  it('redacta secretos del arranque sin perder el diagnóstico', () => {
    const secret = 'secreto-de-arranque-123456';
    process.env.MCP_HEALTH_SECRET = secret;

    const output = mcpHealthOutput(
      Buffer.from(`servidor MCP listo\n${secret}\nsbp_ABCDEFGH12345678\npuerto 3000`)
    );

    expect(output).toContain('servidor MCP listo');
    expect(output).toContain('puerto 3000');
    expect(output).toContain('[redactado]');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('sbp_ABCDEFGH12345678');
  });

  it('sanea antes de recortar para no dejar media credencial en el corte', () => {
    const secret = 'secreto-que-cruza-el-corte';
    process.env.MCP_HEALTH_SECRET = secret;

    // El secreto empieza en el carácter 190: si se recortara primero, sus
    // primeros 10 caracteres viajarían en la respuesta.
    const output = mcpHealthOutput(Buffer.from(`${'a'.repeat(190)}${secret}cola`));

    expect(output).toHaveLength(200);
    expect(output).toContain('a'.repeat(190));
    expect(output).not.toContain(secret.slice(0, 10));
  });

  it('acota el stdout a 200 caracteres y mantiene el prefijo útil', () => {
    const output = mcpHealthOutput(Buffer.from('inicio\n' + 'x'.repeat(500)));

    expect(output).toHaveLength(200);
    expect(output?.startsWith('inicio\n')).toBe(true);
  });

  it('sin stdout no inventa contenido', () => {
    expect(mcpHealthOutput(null)).toBeNull();
    expect(mcpHealthOutput(undefined)).toBeNull();
    expect(mcpHealthOutput('')).toBeNull();
  });
});
