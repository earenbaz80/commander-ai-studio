import { describe, expect, test } from 'vitest';
import { webmSupport } from '../../src/artifacts/webm';

describe('webmSupport', () => {
  test('sin MediaRecorder dice por qué no puede exportar', () => {
    const support = webmSupport();
    expect(typeof MediaRecorder).toBe('undefined');
    expect(support.supported).toBe(false);
    expect(support.mimeType).toBeNull();
    expect(support.reason).toMatch(/encoder|WebM/);
  });
});
